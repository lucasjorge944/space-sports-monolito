import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DEFAULT_TIME_ZONE } from '@space-sports/shared';
import { type Job, Queue, Worker } from 'bullmq';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { bullConnection } from '../recurring/recurring.jobs.js';
import { ClassSessionLifecycleService } from './class-session-lifecycle.service.js';
import { PartialClassJobFailure } from './class-sessions.jobs.js';

export const CLASS_ATTENDANCE_QUEUE = 'class-attendance';

/** Nomes dos jobs da fila `class-attendance`. */
export const CLASS_ATTENDANCE_JOBS = {
  /** Abre/fecha as listas do modo AUTOMATIC e leva a DONE as aulas que terminaram (RN-CLASS-04). */
  tick: 'attendance-tick',
} as const;

/** Executa o job pelo nome; separado do Worker para ser testado sem Redis. */
export async function runClassAttendanceJob(
  name: string,
  services: { lifecycle: ClassSessionLifecycleService },
  now: Date = new Date(),
): Promise<object> {
  switch (name) {
    case CLASS_ATTENDANCE_JOBS.tick: {
      const summary = await services.lifecycle.tick(now);
      if (summary.failures > 0) throw new PartialClassJobFailure(name, summary);
      return summary;
    }
    default:
      throw new Error(`Job de presença desconhecido: ${name}`);
  }
}

/**
 * Job de 1 minuto da lista de presença (BullMQ, fila própria). Só liga com `JOBS_ENABLED`; o
 * agendamento fica no Redis (`upsertJobScheduler`), então várias instâncias não duplicam a
 * rodada, e cada transição trava a sessão e confere o status, então uma rodada repetida (retry)
 * não repete nada.
 */
@Injectable()
export class ClassAttendanceJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ClassAttendanceJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly lifecycle: ClassSessionLifecycleService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(CLASS_ATTENDANCE_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        // A próxima rodada vem em 1 minuto: o retry é rápido.
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de presença'));
    await this.queue.upsertJobScheduler(
      'class-attendance-tick',
      { pattern: '* * * * *', tz: DEFAULT_TIME_ZONE },
      { name: CLASS_ATTENDANCE_JOBS.tick },
    );
    this.worker = new Worker(CLASS_ATTENDANCE_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de presença'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        {
          err,
          job: job?.name,
          attempt: job?.attemptsMade,
          ...(err instanceof PartialClassJobFailure ? err.summary : {}),
        },
        'Job de presença falhou',
      ),
    );
    this.logger.log('Job da lista de presença agendado');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<object> {
    const result = await runClassAttendanceJob(job.name, { lifecycle: this.lifecycle });
    const { opened, closed, done } = result as { opened: number; closed: number; done: number };
    // Uma rodada por minuto: só registra quando algo mudou.
    if (opened || closed || done)
      this.logger.log({ job: job.name, ...result }, 'Lista de presença');
    return result;
  }
}

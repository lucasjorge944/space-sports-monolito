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
import { ClassSessionsService } from './class-sessions.service.js';

export const CLASS_SESSIONS_QUEUE = 'class-sessions';

/** Nomes dos jobs da fila `class-sessions`. */
export const CLASS_SESSIONS_JOBS = {
  /** Gera as sessões das turmas ativas das próximas 4 semanas (RF-CLASS-02). */
  generateSessions: 'generate-sessions',
} as const;

/**
 * Agendamento (cron no fuso padrão dos espaços), depois do job de mensalistas das 03:00. O job é
 * idempotente: rodar todo dia (e repetir o que falhou em parte, até 3 tentativas) só completa o
 * que falta.
 */
const SCHEDULES = [
  {
    id: 'class-sessions-generate',
    name: CLASS_SESSIONS_JOBS.generateSessions,
    pattern: '15 3 * * *',
  },
] as const;

/**
 * Parte das turmas falhou. O resto já foi gravado; o job falha para o BullMQ tentar de novo, e a
 * nova rodada só completa o que faltou.
 */
export class PartialClassJobFailure extends Error {
  constructor(
    readonly job: string,
    readonly summary: { failures: number },
  ) {
    super(`Job de aulas ${job} com ${summary.failures} falha(s).`);
    this.name = 'PartialClassJobFailure';
  }
}

/** Executa o job pelo nome; separado do Worker para ser testado sem Redis. */
export async function runClassSessionsJob(
  name: string,
  services: { sessions: ClassSessionsService },
  now: Date = new Date(),
): Promise<object> {
  let summary: { failures: number };
  switch (name) {
    case CLASS_SESSIONS_JOBS.generateSessions:
      summary = await services.sessions.generateAll(now);
      break;
    default:
      throw new Error(`Job de aulas desconhecido: ${name}`);
  }
  if (summary.failures > 0) throw new PartialClassJobFailure(name, summary);
  return summary;
}

/**
 * Jobs agendados das aulas (BullMQ, fila própria). Só liga com `JOBS_ENABLED`; o agendamento é
 * gravado no Redis (`upsertJobScheduler`), então várias instâncias da API não duplicam execuções.
 */
@Injectable()
export class ClassSessionsJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ClassSessionsJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: ClassSessionsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(CLASS_SESSIONS_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de aulas'));
    for (const { id, name, pattern } of SCHEDULES) {
      await this.queue.upsertJobScheduler(id, { pattern, tz: DEFAULT_TIME_ZONE }, { name });
    }
    this.worker = new Worker(CLASS_SESSIONS_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de aulas'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        {
          err,
          job: job?.name,
          attempt: job?.attemptsMade,
          ...(err instanceof PartialClassJobFailure ? err.summary : {}),
        },
        'Job de aulas falhou',
      ),
    );
    this.logger.log('Jobs de aulas agendados');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<object> {
    const result = await runClassSessionsJob(job.name, { sessions: this.sessions });
    this.logger.log({ job: job.name, ...result }, 'Job de aulas concluído');
    return result;
  }
}

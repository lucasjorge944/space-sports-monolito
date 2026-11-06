import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DEFAULT_TIME_ZONE } from '@space-sports/shared';
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { OccurrencesService } from './occurrences.service.js';

export const RECURRING_QUEUE = 'recurring';

/** Nomes dos jobs da fila `recurring`. */
export const RECURRING_JOBS = {
  /** Gera as ocorrências semanais das próximas 4 semanas (RN-BOOK-08). */
  generateOccurrences: 'generate-occurrences',
} as const;

/**
 * Agendamentos (cron no fuso padrão dos espaços). O job é idempotente, então rodar todo dia (e
 * repetir o job que falhou em parte, até 3 tentativas) é seguro e cobre uma falha pontual: as
 * ocorrências olham 4 semanas à frente.
 */
const SCHEDULES = [
  {
    id: 'recurring-generate-occurrences',
    name: RECURRING_JOBS.generateOccurrences,
    pattern: '0 3 * * *',
  },
] as const;

/**
 * Agendamentos que já existiram e ficam gravados no Redis: removidos na subida. O
 * `generate-charges` gerava a mensalidade do mensalista, que deixou de existir (decisão 27); um
 * job dele que ainda esteja na fila é descartado sem erro.
 */
export const RETIRED_SCHEDULE_IDS = ['recurring-generate-charges'] as const;
export const RETIRED_JOBS: readonly string[] = ['generate-charges'];

/** Conexão do BullMQ a partir do REDIS_URL (os workers exigem `maxRetriesPerRequest: null`). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/**
 * Parte dos mensalistas falhou. O resto já foi gravado; o job falha para o BullMQ tentar de
 * novo, e a nova rodada só completa o que faltou (o job é idempotente).
 */
export class PartialJobFailure extends Error {
  constructor(
    readonly job: string,
    readonly summary: { failures: number },
  ) {
    super(`Job de mensalista ${job} com ${summary.failures} falha(s).`);
    this.name = 'PartialJobFailure';
  }
}

/** Executa o job pelo nome; separado do Worker para ser testado sem Redis. */
export async function runRecurringJob(
  name: string,
  services: { occurrences: OccurrencesService },
  now: Date = new Date(),
): Promise<object> {
  if (RETIRED_JOBS.includes(name)) return { retired: true };
  let summary: { failures: number };
  switch (name) {
    case RECURRING_JOBS.generateOccurrences:
      summary = await services.occurrences.generateAll(now);
      break;
    default:
      throw new Error(`Job de mensalista desconhecido: ${name}`);
  }
  if (summary.failures > 0) throw new PartialJobFailure(name, summary);
  return summary;
}

/**
 * Jobs agendados do mensalista (BullMQ). Só liga com `JOBS_ENABLED`; o agendamento é gravado no
 * Redis (`upsertJobScheduler`), então várias instâncias da API não duplicam execuções.
 */
@Injectable()
export class RecurringJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecurringJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly occurrences: OccurrencesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(RECURRING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de mensalistas'));
    for (const id of RETIRED_SCHEDULE_IDS) await this.queue.removeJobScheduler(id);
    for (const { id, name, pattern } of SCHEDULES) {
      await this.queue.upsertJobScheduler(id, { pattern, tz: DEFAULT_TIME_ZONE }, { name });
    }
    this.worker = new Worker(RECURRING_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de mensalistas'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        {
          err,
          job: job?.name,
          attempt: job?.attemptsMade,
          ...(err instanceof PartialJobFailure ? err.summary : {}),
        },
        'Job de mensalistas falhou',
      ),
    );
    this.logger.log('Jobs de mensalistas agendados');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<object> {
    const result = await runRecurringJob(job.name, { occurrences: this.occurrences });
    this.logger.log({ job: job.name, ...result }, 'Job de mensalistas concluído');
    return result;
  }
}

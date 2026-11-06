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
import { AdEventsService } from './events.service.js';

export const ADS_QUEUE = 'ads-maintenance';

/** Nomes dos jobs da fila `ads-maintenance`. */
export const ADS_JOBS = {
  /** Apaga os recibos dos tokens de entrega vencidos (RN-ADS-04). */
  purgeReceipts: 'purge-event-receipts',
} as const;

/** Executa o job pelo nome; separado do Worker para ser testado sem Redis. */
export async function runAdsJob(
  name: string,
  services: { events: AdEventsService },
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  switch (name) {
    case ADS_JOBS.purgeReceipts:
      return { deleted: await services.events.purgeExpiredReceipts(now) };
    default:
      throw new Error(`Job de anúncios desconhecido: ${name}`);
  }
}

/**
 * Manutenção diária dos anúncios (BullMQ, fila própria), às 04:00 de `America/Sao_Paulo`. Só liga
 * com `JOBS_ENABLED`; o agendamento fica no Redis (`upsertJobScheduler`), sem duplicar entre
 * instâncias, e apagar de novo o que já saiu não muda nada.
 */
@Injectable()
export class AdsJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AdsJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly events: AdEventsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(ADS_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de anúncios'));
    await this.queue.upsertJobScheduler(
      'ads-purge-event-receipts',
      { pattern: '0 4 * * *', tz: DEFAULT_TIME_ZONE },
      { name: ADS_JOBS.purgeReceipts },
    );
    this.worker = new Worker(ADS_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de anúncios'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        { err, job: job?.name, attempt: job?.attemptsMade },
        'Job de anúncios falhou',
      ),
    );
    this.logger.log('Limpeza diária dos recibos de anúncios agendada');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<object> {
    const result = await runAdsJob(job.name, { events: this.events });
    this.logger.log({ job: job.name, ...result }, 'Recibos de anúncios vencidos apagados');
    return result;
  }
}

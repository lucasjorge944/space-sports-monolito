import { Logger } from '@nestjs/common';
import { DEFAULT_TIME_ZONE } from '@space-sports/shared';
import { type Job, Queue, Worker } from 'bullmq';
import type { Env } from '../config/env.js';
import { bullConnection } from '../recurring/recurring.jobs.js';
import { PAYMENTS_QUEUE } from './payment-jobs.names.js';
import { type PaymentJob, PaymentsQueue } from './payments-queue.js';

/** Agendamento recorrente: cron (fuso dos espaços) ou intervalo fixo. */
export interface PaymentSchedule {
  id: string;
  name: string;
  pattern?: string;
  everyMs?: number;
}

/**
 * Fila `payments` no BullMQ (com `JOBS_ENABLED`): webhooks a processar, entregas do fake e os
 * jobs agendados. Retry com backoff exponencial; o Redis evita execução duplicada entre instâncias.
 */
export class BullPaymentsQueue extends PaymentsQueue {
  private readonly logger = new Logger('PaymentsQueue');
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(private readonly env: Env) {
    super();
    this.queue = new Queue(PAYMENTS_QUEUE, {
      connection: bullConnection(env.REDIS_URL),
      defaultJobOptions: {
        attempts: 6,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de pagamentos'));
  }

  async enqueue(job: PaymentJob): Promise<void> {
    await this.queue.add(job.name, job.data, {
      ...(job.delayMs ? { delay: job.delayMs } : {}),
      ...(job.jobId ? { jobId: job.jobId } : {}),
    });
  }

  async start(schedules: PaymentSchedule[]): Promise<void> {
    for (const schedule of schedules) {
      await this.queue.upsertJobScheduler(
        schedule.id,
        schedule.pattern
          ? { pattern: schedule.pattern, tz: DEFAULT_TIME_ZONE }
          : { every: schedule.everyMs ?? 60_000 },
        { name: schedule.name },
      );
    }
    this.worker = new Worker(
      PAYMENTS_QUEUE,
      async (job: Job) => {
        if (!this.handler) throw new Error('Fila de pagamentos sem executor.');
        return this.handler({ name: job.name, data: job.data as Record<string, unknown> });
      },
      { connection: bullConnection(this.env.REDIS_URL), concurrency: 4 },
    );
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de pagamentos'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        { err, job: job?.name, attempt: job?.attemptsMade },
        'Job de pagamentos falhou',
      ),
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

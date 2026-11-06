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
import { PartialClassJobFailure } from './class-sessions.jobs.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';

export const SUBSCRIPTIONS_QUEUE = 'subscriptions';

/** Nomes dos jobs da fila `subscriptions`. */
export const SUBSCRIPTIONS_JOBS = {
  /**
   * Cancelamentos que chegaram ao último dia, mensalidade do mês, vencidas e regra de atraso
   * (RF-CLASS-11, RN-CLASS-06/08).
   */
  processBilling: 'process-billing',
  /** Avisos de mensalidade próxima do vencimento e vencida (RF-NOTIF-01). */
  sendChargeReminders: 'send-charge-reminders',
} as const;

/**
 * Agendamentos (cron no fuso padrão dos espaços). A cobrança roda de hora em hora e cada
 * assinatura é processada na primeira rodada depois da meia-noite do fuso do espaço (o status do
 * dia vale cedo em qualquer fuso); os avisos de manhã, depois dela. Os dois são idempotentes.
 */
const SCHEDULES = [
  {
    id: 'subscriptions-process-billing',
    name: SUBSCRIPTIONS_JOBS.processBilling,
    pattern: '20 * * * *',
  },
  {
    id: 'subscriptions-charge-reminders',
    name: SUBSCRIPTIONS_JOBS.sendChargeReminders,
    pattern: '0 9 * * *',
  },
] as const;

/** Executa o job pelo nome; separado do Worker para ser testado sem Redis. */
export async function runSubscriptionsJob(
  name: string,
  services: { charges: SubscriptionChargesService },
  now: Date = new Date(),
): Promise<object> {
  switch (name) {
    case SUBSCRIPTIONS_JOBS.processBilling: {
      const summary = await services.charges.processBilling(now);
      // Parte falhou: o resto já foi gravado e a nova tentativa só completa o que faltou.
      if (summary.failures > 0) throw new PartialClassJobFailure(name, summary);
      return summary;
    }
    case SUBSCRIPTIONS_JOBS.sendChargeReminders:
      return services.charges.sendReminders(now);
    default:
      throw new Error(`Job de assinaturas desconhecido: ${name}`);
  }
}

/**
 * Jobs agendados das assinaturas (BullMQ, fila própria, 3 tentativas com backoff). Só liga com
 * `JOBS_ENABLED`; o agendamento fica no Redis (`upsertJobScheduler`), sem duplicar entre
 * instâncias.
 */
@Injectable()
export class SubscriptionsJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SubscriptionsJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly charges: SubscriptionChargesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(SUBSCRIPTIONS_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
      },
    });
    this.queue.on('error', (err) => this.logger.error({ err }, 'Erro na fila de assinaturas'));
    for (const { id, name, pattern } of SCHEDULES) {
      await this.queue.upsertJobScheduler(id, { pattern, tz: DEFAULT_TIME_ZONE }, { name });
    }
    this.worker = new Worker(SUBSCRIPTIONS_QUEUE, (job) => this.process(job), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => this.logger.error({ err }, 'Erro no worker de assinaturas'));
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        {
          err,
          job: job?.name,
          attempt: job?.attemptsMade,
          ...(err instanceof PartialClassJobFailure ? err.summary : {}),
        },
        'Job de assinaturas falhou',
      ),
    );
    this.logger.log('Jobs de assinaturas agendados');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(job: Job): Promise<object> {
    const result = await runSubscriptionsJob(job.name, { charges: this.charges });
    this.logger.log({ job: job.name, ...result }, 'Job de assinaturas concluído');
    return result;
  }
}

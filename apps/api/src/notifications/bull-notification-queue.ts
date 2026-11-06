import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { BookingRemindersService } from './booking-reminders.service.js';
import { NotificationQueue, type PushJob, type ReceiptsJob } from './notification-queue.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { ReviewRequestsService } from './review-requests.service.js';

/** Push e recibos: jobs independentes, processados em paralelo. */
const PUSH_QUEUE = 'notifications';
/** Jobs agendados (lembretes e limpeza), um de cada vez, sem esperar a fila de push. */
const SCHEDULE_QUEUE = 'notification-schedules';
const JOB_PUSH = 'push';
const JOB_RECEIPTS = 'push-receipts';
const JOB_REMINDERS = 'booking-reminders';
const JOB_PRUNE = 'push-deliveries-prune';
const JOB_REVIEW_REQUESTS = 'review-requests';

/** Tentativas do envio de push; o intervalo dobra a cada falha (5s, 10s, 20s…). */
const PUSH_ATTEMPTS = 5;
const PUSH_BACKOFF_MS = 5_000;
/** Pushes enviados ao mesmo tempo por instância (cada um é uma chamada HTTP ao Expo). */
const PUSH_CONCURRENCY = 10;
const REMINDERS_EVERY_MS = 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;
/** Pedidos de avaliação (RN-REVIEW-02): ~2 h depois do uso, com folga de 5 min. */
const REVIEW_REQUESTS_EVERY_MS = 5 * 60_000;
const RETRY_SCHEDULE_MS = 5_000;
const ENQUEUE_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT_MS = 3_000;
const DAY_S = 24 * 60 * 60;

/**
 * Filas BullMQ (Redis) das notificações. `notifications`: envio de push com retry e backoff
 * exponencial e consulta de recibos do Expo, com concorrência. `notification-schedules`: o job
 * de lembretes (a cada minuto), o de pedidos de avaliação (a cada 5 min, RN-REVIEW-02) e a
 * limpeza das chaves de idempotência do push, em schedulers
 * únicos mesmo com várias instâncias da API e com concorrência 1 — um push lento não atrasa o
 * lembrete. Um lembrete por reserva continua garantido pelo banco (`reminder_sent_at`), não pela
 * concorrência. Os workers rodam neste processo.
 */
export class BullNotificationQueue
  extends NotificationQueue
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(BullNotificationQueue.name);
  /** O BullMQ exige `maxRetriesPerRequest: null` (comandos bloqueantes do worker). */
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly schedules: Queue;
  private workers: Worker[] = [];
  private closed = false;

  constructor(
    env: Pick<Env, 'REDIS_URL'>,
    private readonly moduleRef: Pick<ModuleRef, 'get'>,
    private readonly timing: {
      pushBackoffMs?: number;
      pushConcurrency?: number;
      remindersEveryMs?: number;
    } = {},
  ) {
    super();
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    // Loga só a transição para erro, para não inundar o log a cada tentativa de reconexão.
    let healthy = true;
    this.connection.on('ready', () => {
      healthy = true;
    });
    this.connection.on('error', (err) => {
      if (healthy) this.logger.warn({ err }, 'Falha na conexão do BullMQ');
      healthy = false;
    });
    this.queue = new Queue(PUSH_QUEUE, { connection: this.connection });
    this.schedules = new Queue(SCHEDULE_QUEUE, { connection: this.connection });
  }

  onModuleInit(): void {
    this.workers = [
      new Worker(PUSH_QUEUE, (job) => this.process(job), {
        connection: this.connection,
        concurrency: this.timing.pushConcurrency ?? PUSH_CONCURRENCY,
      }),
      new Worker(SCHEDULE_QUEUE, (job) => this.process(job), {
        connection: this.connection,
        concurrency: 1,
      }),
    ];
    for (const worker of this.workers) {
      worker.on('error', () => {}); // já logado na conexão
      worker.on('failed', (job, err) =>
        this.logger.warn({ err, job: job?.name, attempt: job?.attemptsMade }, 'Job falhou'),
      );
    }
    // Sem await: o boot da API não espera (nem falha) com o Redis fora do ar.
    void this.schedule();
  }

  /** Registra os jobs recorrentes; tenta de novo até o Redis responder. */
  private async schedule(): Promise<void> {
    const once = { removeOnComplete: true, removeOnFail: true };
    while (!this.closed) {
      try {
        await this.schedules.upsertJobScheduler(
          JOB_REMINDERS,
          { every: this.timing.remindersEveryMs ?? REMINDERS_EVERY_MS },
          { name: JOB_REMINDERS, opts: once },
        );
        await this.schedules.upsertJobScheduler(
          JOB_PRUNE,
          { every: PRUNE_EVERY_MS },
          { name: JOB_PRUNE, opts: once },
        );
        await this.schedules.upsertJobScheduler(
          JOB_REVIEW_REQUESTS,
          { every: REVIEW_REQUESTS_EVERY_MS },
          { name: JOB_REVIEW_REQUESTS, opts: once },
        );
        // Versões anteriores agendavam os lembretes na fila de push.
        await this.queue.removeJobScheduler(JOB_REMINDERS);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RETRY_SCHEDULE_MS));
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closed = true;
    // Com o Redis fora do ar o close() esperaria a conexão: desiste depois de um tempo.
    await Promise.race([
      Promise.all([
        ...this.workers.map((worker) => worker.close()),
        this.queue.close(),
        this.schedules.close(),
      ]),
      new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref()),
    ]);
    this.connection.disconnect();
  }

  /**
   * Com o Redis fora do ar o `add` ficaria esperando a conexão (e a requisição que publicou o
   * evento junto): falha depois de um tempo, e quem chamou só loga.
   */
  private async add(...args: Parameters<Queue['add']>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis indisponível.')), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.queue.add(...args), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async enqueuePush(job: PushJob): Promise<void> {
    // O id do job é a chave de idempotência: enfileirar duas vezes o mesmo push vira um só job.
    await this.add(JOB_PUSH, job, {
      ...(job.id ? { jobId: job.id } : {}),
      attempts: PUSH_ATTEMPTS,
      backoff: { type: 'exponential', delay: this.timing.pushBackoffMs ?? PUSH_BACKOFF_MS },
      removeOnComplete: { age: DAY_S },
      removeOnFail: { age: 7 * DAY_S },
    });
  }

  async enqueueReceipts(job: ReceiptsJob, delayMs: number): Promise<void> {
    await this.add(JOB_RECEIPTS, job, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: PUSH_BACKOFF_MS },
      removeOnComplete: true,
      removeOnFail: { age: DAY_S },
    });
  }

  // Os serviços são resolvidos na hora: eles dependem desta fila (ciclo na injeção).
  private async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PUSH:
        return this.moduleRef.get(PushDeliveryService).deliver(job.data as PushJob);
      case JOB_RECEIPTS:
        return this.moduleRef.get(PushDeliveryService).checkReceipts(job.data as ReceiptsJob);
      case JOB_REMINDERS: {
        const reminded = await this.moduleRef.get(BookingRemindersService).run();
        if (reminded) this.logger.log({ reminded }, 'Lembretes de reserva enviados');
        return;
      }
      case JOB_REVIEW_REQUESTS: {
        const requested = await this.moduleRef.get(ReviewRequestsService).run();
        if (requested) this.logger.log({ requested }, 'Pedidos de avaliação enviados');
        return;
      }
      case JOB_PRUNE: {
        const pruned = await this.moduleRef.get(PushDeliveryService).prune();
        if (pruned) this.logger.log({ pruned }, 'Chaves de idempotência do push apagadas');
        return;
      }
      default:
        this.logger.warn({ job: job.name }, 'Job desconhecido');
    }
  }
}

import type { Type } from '@nestjs/common';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingRemindersService } from '../../src/notifications/booking-reminders.service.js';
import { BullNotificationQueue } from '../../src/notifications/bull-notification-queue.js';
import type { PushJob, ReceiptsJob } from '../../src/notifications/notification-queue.js';
import { PushDeliveryService } from '../../src/notifications/push-delivery.service.js';
import { ReviewRequestsService } from '../../src/notifications/review-requests.service.js';

/** Redis de verdade (Testcontainers): o retry e o agendamento são do BullMQ, não do nosso código. */
describe('fila BullMQ das notificações', () => {
  let redis: StartedTestContainer;
  let queue: BullNotificationQueue;
  const delivered: PushJob[] = [];
  const checked: ReceiptsJob[] = [];
  let failuresLeft = 0;
  let reminderRuns = 0;
  let reviewRequestRuns = 0;
  /** Pushes "lentos" (Expo demorando) ficam presos até `release` ser chamado. */
  let inFlight = 0;
  let maxInFlight = 0;
  let release: () => void = () => {};
  let gate = Promise.resolve();

  const services = new Map<Type, unknown>([
    [
      PushDeliveryService,
      {
        deliver: async (job: PushJob) => {
          if (job.title === 'lento') {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await gate;
            inFlight--;
          }
          if (failuresLeft-- > 0) throw new Error('Expo Push respondeu 503.');
          delivered.push(job);
        },
        checkReceipts: async (job: ReceiptsJob) => {
          checked.push(job);
        },
      },
    ],
    [
      BookingRemindersService,
      {
        run: async () => {
          reminderRuns++;
          return 0;
        },
      },
    ],
    [
      ReviewRequestsService,
      {
        run: async () => {
          reviewRequestRuns++;
          return 0;
        },
      },
    ],
  ]);

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    queue = new BullNotificationQueue(
      { REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}` },
      { get: ((token: Type) => services.get(token)) as never },
      { pushBackoffMs: 50, remindersEveryMs: 200 },
    );
    queue.onModuleInit();
  }, 120_000);
  afterAll(async () => {
    await queue.onApplicationShutdown();
    await redis.stop();
  });

  const until = async (done: () => boolean, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!done()) {
      if (Date.now() > deadline) throw new Error('Tempo esgotado esperando o job.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it('processa o push', async () => {
    await queue.enqueuePush({ userId: 'u1', title: 'T', body: 'B' });
    await until(() => delivered.length === 1);
    expect(delivered[0]).toMatchObject({ userId: 'u1' });
  });

  it('repete o push quando o envio falha (retry com backoff)', async () => {
    delivered.length = 0;
    failuresLeft = 2;
    await queue.enqueuePush({ userId: 'u2', title: 'T', body: 'B' });
    await until(() => delivered.length === 1);
    expect(failuresLeft).toBe(-1);
  });

  it('consulta os recibos depois do atraso', async () => {
    const startedAt = Date.now();
    await queue.enqueueReceipts({ tickets: [{ id: 't1', token: 'x' }] }, 300);
    await until(() => checked.length === 1);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
  });

  it('agenda o job de lembretes de forma recorrente', async () => {
    await until(() => reminderRuns >= 2);
  });

  it('agenda o job de pedidos de avaliação (RN-REVIEW-02) na fila de agendados', async () => {
    await until(() => reviewRequestRuns >= 1);
  });

  it('pushes rodam em paralelo e não atrasam os lembretes (filas separadas)', async () => {
    delivered.length = 0;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const userId of ['p1', 'p2', 'p3']) {
      await queue.enqueuePush({ userId, title: 'lento', body: 'B' });
    }
    await until(() => inFlight === 3);
    // Com os três pushes presos, o lembrete continua rodando.
    const runs = reminderRuns;
    await until(() => reminderRuns >= runs + 2);

    release();
    await until(() => delivered.length === 3);
    expect(maxInFlight).toBe(3);
  });

  it('o mesmo push enfileirado duas vezes (mesma chave) vira um job só', async () => {
    delivered.length = 0;
    const push = {
      id: '0190f3a0-0000-7000-8000-000000000001',
      userId: 'u3',
      title: 'T',
      body: 'B',
    };
    await queue.enqueuePush(push);
    await queue.enqueuePush(push);
    await queue.enqueuePush({ userId: 'u4', title: 'T', body: 'B' });
    await until(() => delivered.some((job) => job.userId === 'u4'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(delivered.filter((job) => job.userId === 'u3')).toHaveLength(1);
  });
});

describe('fila BullMQ com o Redis fora do ar', () => {
  it('o envio falha em poucos segundos (não trava a requisição) e o boot não espera', async () => {
    const queue = new BullNotificationQueue(
      { REDIS_URL: 'redis://127.0.0.1:1' },
      { get: (() => undefined) as never },
    );
    const startedAt = Date.now();
    queue.onModuleInit();
    await expect(queue.enqueuePush({ userId: 'u', title: 'T', body: 'B' })).rejects.toThrow(
      'Redis indisponível',
    );
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    await queue.onApplicationShutdown();
  });
});

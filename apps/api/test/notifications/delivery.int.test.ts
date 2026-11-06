import { randomUUID } from 'node:crypto';
import { addMinutes } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { devices, pushDeliveries } from '../../src/db/schema/index.js';
import { NotificationsService } from '../../src/notifications/notifications.service.js';
import {
  PUSH_DELIVERY_RETENTION_MIN,
  PushDeliveryService,
} from '../../src/notifications/push-delivery.service.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { createNotificationsApp, type NotificationsTestApp } from './fakes.js';
import { registerDevice } from './helpers.js';

describe('entrega do push e limpeza de tokens (RF-NOTIF-01)', () => {
  let t: NotificationsTestApp;
  let user: SignedUp;
  let other: SignedUp;
  let delivery: PushDeliveryService;

  const tokensOf = async (userId: string) =>
    (await t.db.select().from(devices).where(eq(devices.userId, userId)))
      .map((d) => d.expoPushToken)
      .sort();

  beforeAll(async () => {
    t = await createNotificationsApp();
    delivery = t.app.get(PushDeliveryService);
    user = await signUp(t, 'usuario@exemplo.com');
    other = await signUp(t, 'outro@exemplo.com');
  });
  afterAll(() => t.close());

  const job = (userId: string) => ({ userId, title: 'Oi', body: 'corpo', data: { a: 1 } });

  it('envia para todos os aparelhos do usuário e agenda a consulta dos recibos', async () => {
    await registerDevice(t, user, 'ExponentPushToken[ios]', 'IOS');
    await registerDevice(t, user, 'ExponentPushToken[android]', 'ANDROID');
    await registerDevice(t, other, 'ExponentPushToken[outro]');

    await delivery.deliver(job(user.id));

    expect(t.push.sent.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[android]',
      'ExponentPushToken[ios]',
    ]);
    expect(t.push.sent[0]).toMatchObject({ title: 'Oi', body: 'corpo', data: { a: 1 } });
    expect(t.queue.receipts).toHaveLength(1);
    expect(t.queue.receipts[0]?.tickets.map((x) => x.token).sort()).toEqual([
      'ExponentPushToken[android]',
      'ExponentPushToken[ios]',
    ]);
  });

  it('remove o token que o Expo recusa com DeviceNotRegistered (e só ele)', async () => {
    t.push.ticketErrors.set('ExponentPushToken[ios]', 'DeviceNotRegistered');
    t.queue.receipts.length = 0;

    await delivery.deliver(job(user.id));

    expect(await tokensOf(user.id)).toEqual(['ExponentPushToken[android]']);
    expect(await tokensOf(other.id)).toEqual(['ExponentPushToken[outro]']);
    // Só o ticket ok vira consulta de recibo.
    expect(t.queue.receipts[0]?.tickets.map((x) => x.token)).toEqual([
      'ExponentPushToken[android]',
    ]);
  });

  it('outros erros do ticket não apagam o token', async () => {
    t.push.ticketErrors.set('ExponentPushToken[android]', 'MessageRateExceeded');
    await delivery.deliver(job(user.id));
    expect(await tokensOf(user.id)).toEqual(['ExponentPushToken[android]']);
    t.push.ticketErrors.clear();
  });

  it('remove o token cujo recibo diz DeviceNotRegistered', async () => {
    await registerDevice(t, user, 'ExponentPushToken[desinstalado]');
    t.queue.receipts.length = 0;
    await delivery.deliver(job(user.id));
    const receiptsJob = t.queue.receipts[0];
    expect(receiptsJob?.tickets).toHaveLength(2);

    t.push.receiptErrors.set('ExponentPushToken[desinstalado]', 'DeviceNotRegistered');
    await delivery.checkReceipts(receiptsJob ?? { tickets: [] });

    expect(await tokensOf(user.id)).toEqual(['ExponentPushToken[android]']);
  });

  it('falha de transporte lança (o BullMQ repete) e não mexe nos tokens', async () => {
    t.push.failTransport = true;
    await expect(delivery.deliver(job(user.id))).rejects.toThrow('503');
    t.push.failTransport = false;
    expect(await tokensOf(user.id)).toEqual(['ExponentPushToken[android]']);
  });

  it('usuário sem aparelho: nada é enviado', async () => {
    const lonely = await signUp(t, 'sozinho@exemplo.com');
    t.push.sent.length = 0;
    await delivery.deliver(job(lonely.id));
    expect(t.push.sent).toHaveLength(0);
  });

  it('notify enfileira o push com o tipo e o id da notificação', async () => {
    t.queue.pushes.length = 0;
    await t.app.get(NotificationsService).notify({
      userId: user.id,
      type: 'BOOKING_CONFIRMED',
      title: 'T',
      body: 'B',
      data: { bookingId: 'b1' },
    });
    expect(t.queue.pushes).toEqual([
      {
        id: expect.any(String),
        userId: user.id,
        title: 'T',
        body: 'B',
        data: { bookingId: 'b1', type: 'BOOKING_CONFIRMED', notificationId: expect.any(String) },
      },
    ]);
  });

  describe('sem push duplicado quando o job roda de novo', () => {
    let target: SignedUp;
    beforeAll(async () => {
      target = await signUp(t, 'idempotente@exemplo.com');
      await registerDevice(t, target, 'ExponentPushToken[idem]');
    });
    afterEach(() => vi.restoreAllMocks());

    const keyed = () => ({ ...job(target.id), id: randomUUID() });
    const sentTo = () => t.push.sent.filter((m) => m.to === 'ExponentPushToken[idem]').length;

    it('o mesmo job entregue duas vezes (Redis caiu antes de marcar o job) envia uma vez só', async () => {
      const push = keyed();
      const before = sentTo();
      await delivery.deliver(push);
      await delivery.deliver(push);
      expect(sentTo()).toBe(before + 1);
    });

    it('falha ao agendar os recibos (Redis fora do ar) depois do envio não faz o job falhar nem reenviar', async () => {
      const push = keyed();
      const before = sentTo();
      vi.spyOn(t.queue, 'enqueueReceipts').mockRejectedValueOnce(new Error('Redis indisponível.'));
      await expect(delivery.deliver(push)).resolves.toBeUndefined();
      // Mesmo que o BullMQ rode o job de novo, o push não sai outra vez.
      await delivery.deliver(push);
      expect(sentTo()).toBe(before + 1);
    });

    it('falha no envio libera a chave: o retry do BullMQ envia', async () => {
      const push = keyed();
      const before = sentTo();
      t.push.failTransport = true;
      await expect(delivery.deliver(push)).rejects.toThrow('503');
      t.push.failTransport = false;
      expect(
        await t.db.select().from(pushDeliveries).where(eq(pushDeliveries.id, push.id)),
      ).toEqual([]);

      await delivery.deliver(push);
      expect(sentTo()).toBe(before + 1);
    });

    it('a limpeza apaga só as chaves mais antigas que a retenção', async () => {
      const recent = keyed();
      await delivery.deliver(recent);
      const old = randomUUID();
      await t.db.insert(pushDeliveries).values({
        id: old,
        userId: target.id,
        createdAt: addMinutes(new Date(), -PUSH_DELIVERY_RETENTION_MIN - 1),
      });

      expect(await delivery.prune()).toBeGreaterThanOrEqual(1);
      const left = (await t.db.select({ id: pushDeliveries.id }).from(pushDeliveries)).map(
        (r) => r.id,
      );
      expect(left).toContain(recent.id);
      expect(left).not.toContain(old);
    });
  });
});

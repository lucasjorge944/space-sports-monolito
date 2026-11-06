import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  merchantAccounts,
  notifications,
  onlineCharges,
  onlineRefunds,
  spaceSettings,
} from '../../src/db/schema/index.js';
import { PAYMENT_GATEWAY } from '../../src/payments/gateway/gateway.registry.js';
import { FakePaymentGateway } from '../../src/payments/gateways/fake/fake-gateway.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import {
  approveMerchant,
  bookingRow,
  CARD_APPROVE,
  CARD_CHARGEBACK,
  chargeRow,
  drain,
  jobsOf,
  ledgerOf,
  onlinePath,
  queueOf,
  type Row,
  setModes,
} from './fixtures.js';

// Correções da revisão da PG.2: contestação ganha seguida de cancelamento, criação com resultado
// desconhecido (timeout) e webhook sem dono, estorno sem gateway, estornos pendentes no saldo,
// "O Pix venceu" ausente no hold, edição com Pix aberto, dois toques no cartão, Idempotency-Key por
// pagador, validação antes do gateway, prazo do hold e a receita por mês fechado.

useMiddayClock();

const PRICE = 10_000;
const HOUR = 60 * 60_000;

describe('correções da revisão do pagamento online', () => {
  let t: TestApp;
  let space: Space;
  let required: Space;
  let owner: SignedUp;
  let ownerReq: SignedUp;
  let ana: SignedUp;
  let bia: SignedUp;
  let sup: SignedUp;
  let gateway: FakePaymentGateway;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'revisao-pg');
    required = await createSpace(t.db, 'revisao-obrigatorio-pg');
    // Sem antecedência mínima: dá para reservar em cima da hora (item 12).
    await t.db
      .update(spaceSettings)
      .set({ bookingMinAdvanceMin: 0 })
      .where(eq(spaceSettings.spaceId, required.id));
    owner = await member(t, 'dono@revisao.test', space.id, 'OWNER');
    ownerReq = await member(t, 'dono@revisao-req.test', required.id, 'OWNER');
    ana = await signUp(t, 'ana@revisao.test', 'Ana Revisão');
    bia = await signUp(t, 'bia@revisao.test', 'Bia Revisão');
    sup = await superUser(t, 'super@revisao.test');
    await approveMerchant(t, owner, space.id);
    await approveMerchant(t, ownerReq, required.id);
    await setModes(t, owner, space.id, 'ONLINE_OPTIONAL');
    await setModes(t, ownerReq, required.id, 'ONLINE_REQUIRED');
    gateway = t.app.get(PAYMENT_GATEWAY) as FakePaymentGateway;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await t.close();
  });

  const book = (user: SignedUp, target: Space, minutes: number, extra: Row = {}) =>
    t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user))
      .send({
        spaceId: target.id,
        courtId: target.courtA,
        sportId: target.sportId,
        startsAt: slotIn(minutes).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        ...extra,
      });

  const pay = (user: SignedUp, bookingId: string, body: Row, key?: string) => {
    const req = t
      .http()
      .post(`/v1/bookings/${bookingId}/payment`)
      .set(...bearer(user));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const simulate = (chargeId: string, action: string, body: Row = {}) =>
    t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${chargeId}/${action}`)
      .set(...bearer(sup))
      .send(body)
      .expect(200);

  const refundsOf = (chargeId: string) =>
    t.db.select().from(onlineRefunds).where(eq(onlineRefunds.chargeId, chargeId));

  it('contestação ganha: o cancelamento no prazo estorna e o estorno manual funciona (item 2)', async () => {
    const a = (
      await book(ana, space, 240, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_CHARGEBACK,
      }).expect(201)
    ).body;
    await drain(t, { withChargebacks: true });
    await simulate(a.onlinePayment.id, 'dispute-result', { outcome: 'WON' });
    await drain(t);
    expect((await chargeRow(t, a.onlinePayment.id)).refundedCents).toBe(0);
    await t
      .http()
      .post(`/v1/bookings/${a.id}/cancel`)
      .set(...bearer(ana))
      .send({})
      .expect(200);
    await drain(t);
    const charge = await chargeRow(t, a.onlinePayment.id);
    expect(charge).toMatchObject({
      status: 'REFUNDED',
      refundedCents: PRICE,
      feeRefundedCents: 600,
    });
    const refunds = await refundsOf(charge.id);
    expect(refunds.map((r) => r.reasonCode).sort()).toEqual([
      'BOOKING_CANCELLED_BY_PLAYER',
      'CHARGEBACK',
    ]);
    const net = (await ledgerOf(t, space.id, charge.id)).reduce((s, e) => s + e.amountCents, 0);
    expect(net).toBe(0);

    // Manual depois da contestação ganha.
    const b = (
      await book(bia, space, 300, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_CHARGEBACK,
      }).expect(201)
    ).body;
    await drain(t, { withChargebacks: true });
    await simulate(b.onlinePayment.id, 'dispute-result', { outcome: 'WON' });
    await drain(t);
    const view = await t
      .http()
      .get(onlinePath(space.id, `charges/${b.onlinePayment.id}`))
      .set(...bearer(owner))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'CHARGEBACK', refundableCents: PRICE });
    await t
      .http()
      .post(onlinePath(space.id, `charges/${b.onlinePayment.id}/refunds`))
      .set(...bearer(owner))
      .send({ amountCents: 2_000, reason: 'Acordo com o cliente' })
      .expect(201);
  });

  it('criação com timeout: confere pela chave e vale o que o gateway tem (item 4)', async () => {
    const booking = (await book(ana, space, 360).expect(201)).body;
    const original = FakePaymentGateway.prototype.createCardCharge;
    vi.spyOn(gateway, 'createCardCharge').mockImplementationOnce(async function (
      this: FakePaymentGateway,
      input,
    ) {
      await original.call(gateway, input);
      throw new Error('timeout');
    });
    const res = await pay(ana, booking.id, { method: 'CARD', cardToken: CARD_APPROVE }).expect(201);
    expect(res.body.status).toBe('PAID');
    expect((await bookingRow(t, booking.id)).paymentStatus).toBe('PAID');
  });

  it('timeout sem como conferir: pendente de verificação; a reconciliação resolve (item 4)', async () => {
    const booking = (await book(bia, space, 420).expect(201)).body;
    const original = FakePaymentGateway.prototype.createCardCharge;
    vi.spyOn(gateway, 'createCardCharge').mockImplementationOnce(async function (
      this: FakePaymentGateway,
      input,
    ) {
      await original.call(gateway, input);
      throw new Error('timeout');
    });
    vi.spyOn(gateway, 'findChargeByIdempotencyKey').mockRejectedValueOnce(new Error('fora do ar'));
    const res = await pay(bia, booking.id, { method: 'CARD', cardToken: CARD_APPROVE }).expect(502);
    expect(res.body.error).toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
      details: { verification: 'PENDING' },
    });
    const chargeId = res.body.error.details.chargeId as string;
    expect(await chargeRow(t, chargeId)).toMatchObject({
      status: 'PENDING',
      providerChargeId: null,
    });
    vi.restoreAllMocks();
    // Sem os webhooks do fake: a reconciliação acha pela chave e aplica o pagamento sozinha.
    queueOf(t).clear();
    // `created_at` vem do relógio do banco (o real), não do relógio falso do teste.
    await jobsOf(t).reconcile(new Date(vi.getRealSystemTime() + 2 * 60_000));
    expect((await chargeRow(t, chargeId)).status).toBe('PAID');
    expect((await bookingRow(t, booking.id)).paymentStatus).toBe('PAID');
  });

  it('webhook de cobrança sem id local casa pela chave; sem dono, o pagamento é estornado (item 4)', async () => {
    const booking = (await book(ana, space, 480).expect(201)).body;
    const original = FakePaymentGateway.prototype.createCardCharge;
    vi.spyOn(gateway, 'createCardCharge').mockImplementationOnce(async function (
      this: FakePaymentGateway,
      input,
    ) {
      await original.call(gateway, input);
      throw new Error('timeout');
    });
    vi.spyOn(gateway, 'findChargeByIdempotencyKey').mockRejectedValueOnce(new Error('fora do ar'));
    const res = await pay(ana, booking.id, { method: 'CARD', cardToken: CARD_APPROVE }).expect(502);
    vi.restoreAllMocks();
    await drain(t);
    expect((await chargeRow(t, res.body.error.details.chargeId)).status).toBe('PAID');

    // Cobrança paga no gateway sem nenhuma linha aqui: estornada inteira.
    const [account] = await t.db
      .select({ id: merchantAccounts.providerAccountId })
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, space.id));
    const orphan = await gateway.createPixCharge({
      idempotencyKey: randomUUID(),
      amountCents: 5_000,
      split: { providerAccountId: account?.id ?? '', platformFeeCents: 200 },
      description: 'Sem dono',
      payer: { name: 'Sem dono', email: null },
      expiresAt: new Date(Date.now() + HOUR),
    });
    await gateway.simulatePixPaid(orphan.providerChargeId);
    await drain(t);
    const after = await gateway.getCharge(orphan.providerChargeId);
    expect(after.refunds.reduce((s, r) => s + r.amountCents, 0)).toBe(5_000);
    expect(after.refunds.reduce((s, r) => s + r.platformFeeRefundCents, 0)).toBe(200);
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'payment.online.orphan'));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('estorno com o gateway fora: o cancelamento segue e o estorno fica pendente no saldo (itens 5 e 6)', async () => {
    const a = (
      await book(bia, space, 540, { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE }).expect(
        201,
      )
    ).body;
    vi.spyOn(gateway, 'refundCharge').mockRejectedValueOnce(new Error('fora do ar'));
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings/${a.id}/cancel`)
      .set(...bearer(owner))
      .send({})
      .expect(200);
    expect((await bookingRow(t, a.id)).status).toBe('CANCELLED');
    const [pending] = await refundsOf(a.onlinePayment.id);
    expect(pending).toMatchObject({
      status: 'PENDING',
      providerRefundId: null,
      reasonCode: 'BOOKING_CANCELLED_BY_SPACE',
    });
    // O pendente sai do saldo reembolsável.
    const view = await t
      .http()
      .get(onlinePath(space.id, `charges/${a.onlinePayment.id}`))
      .set(...bearer(owner))
      .expect(200);
    expect(view.body).toMatchObject({ status: 'PAID', refundableCents: 0 });
    const over = await t
      .http()
      .post(onlinePath(space.id, `charges/${a.onlinePayment.id}/refunds`))
      .set(...bearer(owner))
      .send({ amountCents: 100, reason: 'De novo' })
      .expect(422);
    expect(over.body.error).toMatchObject({
      code: 'REFUND_EXCEEDS_BALANCE',
      details: { refundableCents: 0 },
    });
    // Estorno manual com o gateway fora: 502, nada gravado.
    const b = (
      await book(ana, space, 600, { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE }).expect(
        201,
      )
    ).body;
    vi.spyOn(gateway, 'refundCharge').mockRejectedValueOnce(new Error('fora do ar'));
    await t
      .http()
      .post(onlinePath(space.id, `charges/${b.onlinePayment.id}/refunds`))
      .set(...bearer(owner))
      .send({ amountCents: 1_000, reason: 'Teste' })
      .expect(502);
    expect(await refundsOf(b.onlinePayment.id)).toHaveLength(0);
    // A reconciliação conclui o pendente.
    await jobsOf(t).reconcile();
    await drain(t);
    expect((await chargeRow(t, a.onlinePayment.id)).status).toBe('REFUNDED');
    expect((await refundsOf(a.onlinePayment.id))[0]?.status).toBe('SUCCEEDED');

    // Cobrança de um provedor que não está ligado: segue o cancelamento, estorno pendente.
    const c = (
      await book(bia, space, 660, { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE }).expect(
        201,
      )
    ).body;
    await t.db
      .update(onlineCharges)
      .set({ provider: 'outro' })
      .where(eq(onlineCharges.id, c.onlinePayment.id));
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings/${c.id}/cancel`)
      .set(...bearer(owner))
      .send({})
      .expect(200);
    const [deferred] = await refundsOf(c.onlinePayment.id);
    expect(deferred).toMatchObject({ status: 'PENDING', providerRefundId: null });
    await jobsOf(t).reconcile();
    expect((await refundsOf(c.onlinePayment.id))[0]?.status).toBe('PENDING');
  });

  it('hold vencido: só "Reserva cancelada", sem "O Pix venceu" (item 7)', async () => {
    const res = await book(bia, required, 600, { paymentOption: 'ONLINE_PIX' }).expect(201);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await jobsOf(t).expire();
    await drain(t);
    vi.setSystemTime(Date.now() - 16 * 60_000);
    expect((await bookingRow(t, res.body.id)).cancelReason).toBe('PAYMENT_EXPIRED');
    const titles = (
      await t.db.select().from(notifications).where(eq(notifications.userId, bia.id))
    ).map((n) => n.title);
    expect(titles).toContain('Reserva cancelada');
    expect(titles).not.toContain('O Pix venceu');
  });

  it('edição com Pix aberto cancela a cobrança no gateway antes; paga, a edição é barrada (item 8)', async () => {
    const a = (await book(ana, space, 720, { paymentOption: 'ONLINE_PIX' }).expect(201)).body;
    await t
      .http()
      .patch(`/v1/bookings/${a.id}`)
      .set(...bearer(ana))
      .send({ durationMin: 90 })
      .expect(200);
    const charge = await chargeRow(t, a.onlinePayment.id);
    expect(charge).toMatchObject({ status: 'CANCELLED', closedReason: 'BOOKING_CHANGED' });
    expect((await gateway.getCharge(charge.providerChargeId as string)).status).toBe('CANCELLED');

    const b = (await book(bia, space, 840, { paymentOption: 'ONLINE_PIX' }).expect(201)).body;
    // Pago no banco, webhook ainda na fila.
    await gateway.simulatePixPaid(
      (await chargeRow(t, b.onlinePayment.id)).providerChargeId as string,
    );
    const blocked = await t
      .http()
      .patch(`/v1/bookings/${b.id}`)
      .set(...bearer(bia))
      .send({ durationMin: 90 })
      .expect(422);
    expect(blocked.body.error.code).toBe('BOOKING_HAS_PAYMENT');
    expect((await bookingRow(t, b.id)).paymentStatus).toBe('PAID');
    await drain(t);
  });

  it('dois toques no cartão: uma cobrança só (item 9)', async () => {
    const booking = (await book(ana, space, 900).expect(201)).body;
    const results = await Promise.all([
      pay(ana, booking.id, { method: 'CARD', cardToken: CARD_APPROVE }),
      pay(ana, booking.id, { method: 'CARD', cardToken: CARD_APPROVE }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const charges = await t.db
      .select()
      .from(onlineCharges)
      .where(eq(onlineCharges.payableId, booking.id));
    expect(charges.filter((c) => c.status === 'PAID')).toHaveLength(1);
    expect(charges).toHaveLength(1);
    await drain(t);
  });

  it('a mesma Idempotency-Key de outro pagador não devolve a cobrança dele (item 10)', async () => {
    const a = (await book(ana, space, 960).expect(201)).body;
    const b = (await book(bia, space, 1020).expect(201)).body;
    const fromAna = await pay(ana, a.id, { method: 'PIX' }, 'mesma-chave-0001').expect(201);
    const fromBia = await pay(bia, b.id, { method: 'PIX' }, 'mesma-chave-0001').expect(201);
    expect(fromBia.body.id).not.toBe(fromAna.body.id);
    expect(fromBia.body.payableId).toBe(b.id);
  });

  it('validações antes do gateway: prazo do cancelamento e valor do registro manual (item 11)', async () => {
    const a = (await book(ana, space, 90, { paymentOption: 'ONLINE_PIX' }).expect(201)).body;
    const providerId = (await chargeRow(t, a.onlinePayment.id)).providerChargeId as string;
    const tooBig = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments`)
      .set(...bearer(owner))
      .send({ payableType: 'BOOKING', payableId: a.id, amountCents: PRICE + 1, method: 'CASH' })
      .expect(422);
    expect(tooBig.body.error.code).toBe('PAYMENT_EXCEEDS_DUE');
    expect((await gateway.getCharge(providerId)).status).toBe('PENDING');
    // Prazo de cancelamento maior que a antecedência: já passou.
    await t.db
      .update(spaceSettings)
      .set({ cancellationDeadlineMin: 24 * 60 })
      .where(eq(spaceSettings.spaceId, space.id));
    try {
      const late = await t
        .http()
        .post(`/v1/bookings/${a.id}/cancel`)
        .set(...bearer(ana))
        .send({})
        .expect(422);
      expect(late.body.error.code).toBe('CANCELLATION_DEADLINE_PASSED');
    } finally {
      await t.db
        .update(spaceSettings)
        .set({ cancellationDeadlineMin: 60 })
        .where(eq(spaceSettings.spaceId, space.id));
    }
    expect((await gateway.getCharge(providerId)).status).toBe('PENDING');
    expect((await chargeRow(t, a.onlinePayment.id)).status).toBe('PENDING');
  });

  it('hold = min(início, agora + 15 min); a menos de 5 min do início, erro claro (item 12)', async () => {
    const base = Date.now();
    const holdBody = (user: SignedUp, court: string, startsAt: Date) =>
      t
        .http()
        .post('/v1/bookings')
        .set(...bearer(user))
        .send({
          spaceId: required.id,
          courtId: court,
          sportId: required.sportId,
          startsAt: startsAt.toISOString(),
          durationMin: 60,
          peopleCount: 2,
          paymentOption: 'ONLINE_PIX',
        });
    try {
      // 12:10 no relógio do teste: o horário das 12:30 começa em 20 min → prazo 12:25.
      const slot = slotIn(1);
      const first = await holdBody(ana, required.courtA, slot).expect(201);
      expect(new Date(first.body.paymentDueAt).getTime()).toBe(base + 15 * 60_000);
      // 12:20: o das 12:30 começa em 10 min → o prazo é o início.
      vi.setSystemTime(base + 10 * 60_000);
      const soon = await holdBody(bia, required.courtB, slot).expect(201);
      expect(new Date(soon.body.paymentDueAt).getTime()).toBe(slot.getTime());
      // 12:27: começa em 3 min → recusado com o erro próprio.
      vi.setSystemTime(base + 17 * 60_000);
      const blocked = await holdBody(ana, required.courtA, slot).expect(422);
      expect(blocked.body.error).toMatchObject({
        code: 'BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT',
        details: { minLeadMin: 5 },
      });
    } finally {
      vi.setSystemTime(base);
    }
  });

  it('estorno de venda ainda a liberar sai do "a liberar", sem disponível negativo', async () => {
    const isolated = await createSpace(t.db, 'liberar-pg');
    const isolatedOwner = await member(t, 'dono@liberar.test', isolated.id, 'OWNER');
    await approveMerchant(t, isolatedOwner, isolated.id);
    await setModes(t, isolatedOwner, isolated.id, 'ONLINE_OPTIONAL');
    const a = (
      await book(ana, isolated, 240, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      }).expect(201)
    ).body;
    await t
      .http()
      .post(onlinePath(isolated.id, `charges/${a.onlinePayment.id}/refunds`))
      .set(...bearer(isolatedOwner))
      .send({ amountCents: 4_000, reason: 'Parte' })
      .expect(201);
    const wallet = await t
      .http()
      .get(onlinePath(isolated.id, 'wallet'))
      .set(...bearer(isolatedOwner))
      .expect(200);
    // Cartão: venda 10.000 − taxa 600 − estorno 4.000 + taxa devolvida 240, tudo a liberar em D+30.
    expect(wallet.body).toMatchObject({
      availableCents: 0,
      pendingCents: 5_640,
      balanceCents: 5_640,
    });
  });

  it('receita pela data do lançamento: o mês fechado não muda com um estorno depois (item 3)', async () => {
    const isolated = await createSpace(t.db, 'receita-pg');
    const isolatedOwner = await member(t, 'dono@receita.test', isolated.id, 'OWNER');
    await approveMerchant(t, isolatedOwner, isolated.id);
    await setModes(t, isolatedOwner, isolated.id, 'ONLINE_OPTIONAL');
    const now = Date.now();
    // Pago no mês anterior.
    vi.setSystemTime(now - 35 * 24 * HOUR);
    const a = (
      await book(ana, isolated, 240, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      }).expect(201)
    ).body;
    const lastMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const before = await t
      .http()
      .get('/v1/super/online-payments/reports/monthly')
      .query({ month: lastMonth })
      .set(...bearer(sup))
      .expect(200);
    vi.setSystemTime(now);
    // Estorno total no mês corrente.
    await t
      .http()
      .post(onlinePath(isolated.id, `charges/${a.onlinePayment.id}/refunds`))
      .set(...bearer(isolatedOwner))
      .send({ amountCents: 10_000, reason: 'Tudo' })
      .expect(201);
    const after = await t
      .http()
      .get('/v1/super/online-payments/reports/monthly')
      .query({ month: lastMonth })
      .set(...bearer(sup))
      .expect(200);
    const pick = (body: { items: Row[] }) => body.items.find((i) => i.spaceId === isolated.id);
    expect(pick(after.body)).toEqual(pick(before.body));
    expect(pick(before.body)).toMatchObject({
      grossFeeCents: 600,
      feeRefundedCents: 0,
      invoiceBaseCents: 600,
    });
    const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const current = await t
      .http()
      .get('/v1/super/online-payments/reports/monthly')
      .query({ month: thisMonth })
      .set(...bearer(sup))
      .expect(200);
    expect(pick(current.body)).toMatchObject({ grossFeeCents: 0, feeRefundedCents: 600 });
    const charges = await t.db
      .select()
      .from(onlineCharges)
      .where(and(eq(onlineCharges.spaceId, isolated.id), eq(onlineCharges.status, 'REFUNDED')));
    expect(charges).toHaveLength(1);
  });
});

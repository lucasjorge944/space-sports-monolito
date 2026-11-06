import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  bookings,
  fakeGatewayObjects,
  gatewayEvents,
  merchantAccounts,
  notifications,
  onlineCharges,
  payouts,
  plans,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { signFakeWebhook } from '../../src/payments/gateways/fake/fake-signature.js';
import { createTestApp, PASSWORD, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { superUser } from '../super/fixtures.js';
import {
  APPROVED_CPF,
  approveMerchant,
  bookingRow,
  CARD_APPROVE,
  CARD_CHARGEBACK,
  chargeRow,
  drain,
  ledgerOf,
  merchantBody,
  onlinePath,
  queueOf,
  type Row,
  recordsOf,
  setModes,
} from './fixtures.js';

// RN-ONPAY-02, 03, 05, 07, 10 e 11; RF-AUTH-03; decisões 95 a 98: casos de borda de dinheiro e
// concorrência que a PG.2 não cobriu.

const SECRET = 'segredo-dos-webhooks-de-teste-com-mais-de-32-chars';
const PRICE = 10_000;

useMiddayClock();

describe('casos de borda do pagamento online', () => {
  let t: TestApp;
  let required: Space;
  let optional: Space;
  let ownerReq: SignedUp;
  let ownerOpt: SignedUp;
  let adminOpt: SignedUp;
  let ana: SignedUp;
  let bia: SignedUp;
  let student: SignedUp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({ env: { PAYMENTS_FAKE_WEBHOOK_SECRET: SECRET } });
    required = await createSpace(t.db, 'borda-obrigatorio');
    optional = await createSpace(t.db, 'borda-opcional');
    ownerReq = await member(t, 'dono@borda-req.test', required.id, 'OWNER');
    ownerOpt = await member(t, 'dono@borda-opt.test', optional.id, 'OWNER');
    adminOpt = await member(t, 'admin@borda-opt.test', optional.id, 'ADMIN');
    ana = await signUp(t, 'ana@borda.test', 'Ana Jogadora');
    bia = await signUp(t, 'bia@borda.test', 'Bia Jogadora');
    student = await signUp(t, 'aluno@borda.test', 'Aluno Borda');
    sup = await superUser(t, 'super@borda.test');
    await approveMerchant(t, ownerReq, required.id);
    await approveMerchant(t, ownerOpt, optional.id);
    await setModes(t, ownerReq, required.id, 'ONLINE_REQUIRED');
    await setModes(t, ownerOpt, optional.id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
  });

  afterAll(async () => {
    await t.close();
  });

  const body = (space: Space, startsAt: Date, courtId = space.courtA): Row => ({
    spaceId: space.id,
    courtId,
    sportId: space.sportId,
    startsAt: startsAt.toISOString(),
    durationMin: 60,
    peopleCount: 2,
  });

  const book = (user: SignedUp, payload: Row, key?: string) => {
    const req = t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user));
    if (key) req.set('Idempotency-Key', key);
    return req.send(payload);
  };

  const simulate = (chargeId: string, action: string, payload: Row = {}) =>
    t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${chargeId}/${action}`)
      .set(...bearer(sup))
      .send(payload)
      .expect(200);

  const ledgerSum = async (spaceId: string, chargeId?: string) =>
    (await ledgerOf(t, spaceId, chargeId)).reduce((sum, e) => sum + e.amountCents, 0);

  describe('hold disputado por duas reservas (RN-ONPAY-02, decisão 96)', () => {
    it('o hold vence, a outra pessoa pega o horário e o Pix tardio da primeira é estornado sem tocar na segunda', async () => {
      const startsAt = slotIn(600);
      const first1 = await book(ana, {
        ...body(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      // Dentro do hold, ninguém mais pega o horário.
      await book(bia, { ...body(required, startsAt), paymentOption: 'ONLINE_PIX' }).expect(409);

      vi.setSystemTime(Date.now() + 16 * 60_000);
      try {
        // Cobrar a reserva vencida (antes do job): 409, e nenhuma cobrança nova no gateway.
        const before = (await t.db.select().from(onlineCharges)).length;
        const retry = await t
          .http()
          .post(`/v1/bookings/${first1.body.id}/payment`)
          .set(...bearer(ana))
          .send({ method: 'CARD', cardToken: CARD_APPROVE });
        expect(retry.status).toBe(409);
        expect((await t.db.select().from(onlineCharges)).length).toBe(before);

        const second = await book(bia, {
          ...body(required, startsAt),
          paymentOption: 'ONLINE_PIX',
        }).expect(201);
        expect(second.body.status).toBe('PENDING_PAYMENT');
        expect(await bookingRow(t, first1.body.id)).toMatchObject({
          status: 'CANCELLED',
          cancelReason: 'PAYMENT_EXPIRED',
        });

        // O banco liquida o Pix atrasado da Ana: estorno automático, sem mexer na reserva da Bia.
        await simulate(first1.body.onlinePayment.id, 'pay');
        await drain(t);
        const late = await chargeRow(t, first1.body.onlinePayment.id);
        expect(late).toMatchObject({ refundedCents: PRICE, feeRefundedCents: 400 });
        expect(late.status).not.toBe('PAID');
        expect(await bookingRow(t, second.body.id)).toMatchObject({
          status: 'PENDING_PAYMENT',
        });
        expect(await recordsOf(t, first1.body.onlinePayment.id)).toHaveLength(0);
        expect(await ledgerSum(required.id, first1.body.onlinePayment.id)).toBe(0);

        // A Bia paga e fica com o horário.
        await simulate(second.body.onlinePayment.id, 'pay');
        await drain(t);
        expect(await bookingRow(t, second.body.id)).toMatchObject({
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
        });
        expect(await bookingRow(t, first1.body.id)).toMatchObject({ status: 'CANCELLED' });
      } finally {
        vi.setSystemTime(Date.now() - 16 * 60_000);
      }
    });

    it('duas pessoas disputam o horário logo depois do vencimento: só uma segura e a vencida não volta', async () => {
      const startsAt = slotIn(720);
      const held = await book(ana, {
        ...body(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      vi.setSystemTime(Date.now() + 16 * 60_000);
      try {
        const results = await Promise.all([
          book(bia, { ...body(required, startsAt), paymentOption: 'ONLINE_PIX' }),
          book(student, { ...body(required, startsAt), paymentOption: 'ONLINE_PIX' }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        const active = await t.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.courtId, required.courtA), eq(bookings.startsAt, startsAt)));
        expect(active.filter((b) => b.status !== 'CANCELLED')).toHaveLength(1);
        expect((await bookingRow(t, held.body.id)).status).toBe('CANCELLED');
      } finally {
        vi.setSystemTime(Date.now() - 16 * 60_000);
      }
    });
  });

  describe('webhooks (RN-ONPAY-07)', () => {
    const sign = (raw: string, secret = SECRET, at = new Date()) => {
      const ts = Math.floor(at.getTime() / 1000);
      return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
    };
    const deliver = (raw: string, signature: string | null, contentType = 'application/json') => {
      const req = t.http().post('/v1/webhooks/payments/fake').set('content-type', contentType);
      if (signature) req.set('x-fake-signature', signature);
      return req.send(raw);
    };
    const evt = (id: string, objectId: string, type = 'charge.updated') =>
      JSON.stringify({ id, type, objectId, createdAt: new Date().toISOString() });

    let chargeId: string;
    let providerId: string;

    beforeAll(async () => {
      const res = await book(ana, {
        ...body(optional, slotIn(900)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      chargeId = res.body.onlinePayment.id;
      await simulate(chargeId, 'pay');
      await drain(t);
      providerId = (await chargeRow(t, chargeId)).providerChargeId as string;
    });

    it('assinatura: ausente, errada, com outro segredo, de outro corpo e com carimbo velho ou futuro: 401', async () => {
      const raw = evt('evt_sig_1', providerId);
      expect((await deliver(raw, null)).status).toBe(401);
      expect(
        (await deliver(raw, sign(raw, 'outro-segredo-qualquer-com-mais-de-32-chars'))).status,
      ).toBe(401);
      expect((await deliver(raw, sign(evt('evt_outro', providerId)))).status).toBe(401);
      expect(
        (await deliver(raw, sign(raw, SECRET, new Date(Date.now() - 10 * 60_000)))).status,
      ).toBe(401);
      expect(
        (await deliver(raw, sign(raw, SECRET, new Date(Date.now() + 10 * 60_000)))).status,
      ).toBe(401);
      expect((await deliver(raw, 'lixo')).status).toBe(401);
      expect((await deliver(raw, `t=abc,v1=${'0'.repeat(64)}`)).status).toBe(401);
      // Nada foi gravado por nenhuma tentativa recusada.
      const stored = await t.db
        .select()
        .from(gatewayEvents)
        .where(eq(gatewayEvents.eventId, 'evt_sig_1'));
      expect(stored).toHaveLength(0);
    });

    it('provedor desconhecido responde 404 mesmo com assinatura válida', async () => {
      const raw = evt('evt_prov_1', providerId);
      const res = await t
        .http()
        .post('/v1/webhooks/payments/asaas')
        .set('content-type', 'application/json')
        .set('x-fake-signature', sign(raw))
        .send(raw);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WEBHOOK_PROVIDER_NOT_FOUND');
      expect(
        (await t.db.select().from(gatewayEvents).where(eq(gatewayEvents.eventId, 'evt_prov_1')))
          .length,
      ).toBe(0);
    });

    it('corpo JSON sem os campos do evento (assinado): aceito e ignorado, nada gravado', async () => {
      for (const raw of ['{"id": 1}', '[]', JSON.stringify({ type: 'x' })]) {
        const res = await deliver(raw, sign(raw));
        expect(res.status, `corpo ${raw}`).toBe(200);
        expect(res.body).toEqual({ received: 0 });
      }
    });

    // Corpo que não é JSON, com assinatura válida: o adaptador lança InvalidWebhookPayload e o
    // WebhooksService responde 400 INVALID_WEBHOOK_PAYLOAD (antes era 500, achado da PG.5).
    it('corpo que não é JSON, com assinatura válida: 400 INVALID_WEBHOOK_PAYLOAD, nunca 500', async () => {
      const before = await t.db.select().from(gatewayEvents);
      for (const raw of ['', 'isto não é json', '{"id": "evt_cortado"']) {
        const res = await deliver(raw, sign(raw));
        expect(res.status, `corpo ${JSON.stringify(raw)}`).toBe(400);
        expect(res.body.error.code).toBe('INVALID_WEBHOOK_PAYLOAD');
      }
      // JSON válido sem o formato de evento (nulo, número) segue 200 sem receber nada.
      for (const raw of ['null', '42']) {
        const res = await deliver(raw, sign(raw));
        expect(res.status, `corpo ${raw}`).toBe(200);
        expect(res.body).toEqual({ received: 0 });
      }
      expect(await t.db.select().from(gatewayEvents)).toHaveLength(before.length);
    });

    it('o mesmo evento entregue 8 vezes ao mesmo tempo é gravado e processado uma vez só', async () => {
      const raw = evt('evt_paralelo_1', providerId);
      const results = await Promise.all(Array.from({ length: 8 }, () => deliver(raw, sign(raw))));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.reduce((sum, r) => sum + (r.body.received as number), 0)).toBe(1);
      const stored = await t.db
        .select()
        .from(gatewayEvents)
        .where(eq(gatewayEvents.eventId, 'evt_paralelo_1'));
      expect(stored).toHaveLength(1);
      await drain(t);
      expect(await recordsOf(t, chargeId)).toHaveLength(1);
      expect(
        (await ledgerOf(t, optional.id, chargeId)).filter((e) => e.kind === 'SALE'),
      ).toHaveLength(1);
    });

    it('evento de tipo desconhecido e de objeto que ninguém conhece: não mudam dinheiro nem status', async () => {
      const before = await ledgerSum(optional.id);
      const chargesBefore = JSON.stringify(await t.db.select().from(onlineCharges));
      for (const [id, type, objectId] of [
        ['evt_tipo_novo', 'billing.exploded', providerId],
        ['evt_objeto_ninguem', 'charge.updated', 'ch_que_nao_existe_em_lugar_nenhum'],
        ['evt_conta_ninguem', 'account.updated', 'acc_que_nao_existe'],
        ['evt_repasse_ninguem', 'payout.updated', 'po_que_nao_existe'],
      ] as const) {
        const raw = evt(id, objectId, type);
        expect((await deliver(raw, sign(raw))).status, id).toBe(200);
      }
      // O tipo desconhecido nem entra; os de objeto desconhecido falham no job (a fila real tenta de
      // novo até 10 vezes). Na fila em memória o erro sobe: engolir um a um.
      for (let guard = 0; guard < 10 && queueOf(t).jobs.length; guard++) {
        await drain(t).catch(() => undefined);
      }
      expect(await ledgerSum(optional.id)).toBe(before);
      expect(JSON.stringify(await t.db.select().from(onlineCharges))).toBe(chargesBefore);
      const stored = await t.db
        .select()
        .from(gatewayEvents)
        .where(eq(gatewayEvents.eventId, 'evt_objeto_ninguem'));
      expect(stored[0]?.processedAt).toBeNull();
      expect(
        await t.db.select().from(gatewayEvents).where(eq(gatewayEvents.eventId, 'evt_tipo_novo')),
      ).toHaveLength(0);
    });

    it('evento antigo de "pago" depois do estorno não ressuscita a venda nem duplica o livro-razão', async () => {
      const refund = await t
        .http()
        .post(`${onlinePath(optional.id, `charges/${chargeId}/refunds`)}`)
        .set(...bearer(adminOpt))
        .send({ amountCents: 4_000, reason: 'Estorno antes do reenvio' })
        .expect(201);
      expect(refund.body.amountCents).toBe(4_000);
      const snapshot = JSON.stringify(
        (await ledgerOf(t, optional.id, chargeId)).map((e) => [e.kind, e.amountCents]).sort(),
      );
      const stale = JSON.stringify({
        id: 'evt_pago_velho',
        type: 'charge.updated',
        objectId: providerId,
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
      expect((await deliver(stale, sign(stale))).status).toBe(200);
      await drain(t);
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 4_000 });
      expect(
        JSON.stringify(
          (await ledgerOf(t, optional.id, chargeId)).map((e) => [e.kind, e.amountCents]).sort(),
        ),
      ).toBe(snapshot);
      expect(await recordsOf(t, chargeId)).toHaveLength(1);
    });

    it('vencer uma cobrança já paga no simulador não a faz voltar atrás', async () => {
      await t
        .http()
        .post(`/v1/super/online-payments/simulator/charges/${chargeId}/expire`)
        .set(...bearer(sup))
        .send({});
      await drain(t);
      const charge = await chargeRow(t, chargeId);
      expect(['PARTIALLY_REFUNDED', 'PAID']).toContain(charge.status);
      expect(charge.paidAt).not.toBeNull();
    });

    it('o assinante do fake com o segredo certo usando o helper de produção também é aceito (consistência)', async () => {
      const raw = evt('evt_helper_ok', providerId);
      const res = await deliver(raw, signFakeWebhook(SECRET, raw));
      expect(res.status).toBe(200);
    });
  });

  describe('mensalidade (RF-ONPAY-05, RN-ONPAY-03 e 04)', () => {
    let subId: string;
    let chargeId: string;
    let monthly: string;

    beforeAll(async () => {
      const plan = first(
        await t.db
          .insert(plans)
          .values({
            spaceId: optional.id,
            sportId: optional.sportId,
            name: 'Plano borda',
            weeklyFrequency: 1,
            priceCents: 15_000,
            billingDay: 1,
          })
          .returning(),
      );
      const sub = first(
        await t.db
          .insert(subscriptions)
          .values({
            userId: student.id,
            planId: plan.id,
            spaceId: optional.id,
            status: 'PAST_DUE',
            priceCents: 15_000,
            startsOn: '2020-01-01',
            currentPeriodStart: '2020-02-01',
            currentPeriodEnd: '2020-02-28',
          })
          .returning(),
      );
      subId = sub.id;
      chargeId = first(
        await t.db
          .insert(subscriptionCharges)
          .values({
            subscriptionId: sub.id,
            periodStart: '2020-01-01',
            periodEnd: '2020-01-31',
            dueDate: '2020-01-01',
            amountCents: 15_000,
            status: 'OVERDUE',
          })
          .returning(),
      ).id;
      monthly = `/v1/me/subscriptions/${subId}/charges/${chargeId}/payment`;
    });

    const state = async () => {
      const [sub] = await t.db.select().from(subscriptions).where(eq(subscriptions.id, subId));
      const [charge] = await t.db
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.id, chargeId));
      return { sub: sub?.status, charge: charge?.status };
    };

    it('Idempotency-Key da mensalidade: mesmo pedido devolve a cobrança; outro meio, 422; a chave de outro aluno não vaza', async () => {
      const key = 'mensalidade-chave-01';
      const pix = await t
        .http()
        .post(monthly)
        .set(...bearer(student))
        .set('Idempotency-Key', key)
        .send({ method: 'PIX' })
        .expect(201);
      const again = await t
        .http()
        .post(monthly)
        .set(...bearer(student))
        .set('Idempotency-Key', key)
        .send({ method: 'PIX' })
        .expect(201);
      expect(again.body.id).toBe(pix.body.id);
      const reused = await t
        .http()
        .post(monthly)
        .set(...bearer(student))
        .set('Idempotency-Key', key)
        .send({ method: 'CARD', cardToken: CARD_APPROVE })
        .expect(422);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      // Outro usuário com a mesma chave não recebe a cobrança do aluno.
      const foreign = await t
        .http()
        .post(monthly)
        .set(...bearer(ana))
        .set('Idempotency-Key', key)
        .send({ method: 'PIX' });
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain(pix.body.id);
    });

    it('pago online sai de PAST_DUE; estorno total volta a mensalidade para em aberto e a assinatura para PAST_DUE', async () => {
      const card = await t
        .http()
        .post(monthly)
        .set(...bearer(student))
        .send({ method: 'CARD', cardToken: CARD_APPROVE })
        .expect(201);
      expect(await state()).toEqual({ sub: 'ACTIVE', charge: 'PAID' });
      // Estorno total com "voltar a cobrar": a mensalidade volta a ficar em aberto (vencida).
      await t
        .http()
        .post(onlinePath(optional.id, `charges/${card.body.id}/refunds`))
        .set(...bearer(ownerOpt))
        .send({ amountCents: 15_000, reason: 'Devolução total', chargeAgain: true })
        .expect(201);
      const after = await state();
      expect(after.charge).not.toBe('PAID');
      expect(after.sub).toBe('PAST_DUE');
      expect(await ledgerSum(optional.id, card.body.id)).toBe(0);
    });

    it('estorno parcial com abatimento deixa a mensalidade paga e o saldo em aberto zerado', async () => {
      const card = await t
        .http()
        .post(monthly)
        .set(...bearer(student))
        .send({ method: 'CARD', cardToken: CARD_APPROVE })
        .expect(201);
      expect((await state()).charge).toBe('PAID');
      await t
        .http()
        .post(onlinePath(optional.id, `charges/${card.body.id}/refunds`))
        .set(...bearer(adminOpt))
        .send({ amountCents: 3_000, reason: 'Desconto por falta de aula' })
        .expect(201);
      const [row] = await t.db
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.id, chargeId));
      expect(row?.status).toBe('PAID');
      expect(row?.discountCents).toBe(3_000);
      expect((await state()).sub).toBe('ACTIVE');
    });
  });

  describe('troca de conta e repasses (RN-ONPAY-11, decisão 98)', () => {
    it('durante a troca em análise nenhum repasse sai; recusada, o repasse retoma com todo o saldo', async () => {
      const space = await createSpace(t.db, 'borda-repasse');
      const owner = await member(t, 'dono@borda-repasse.test', space.id, 'OWNER');
      await approveMerchant(t, owner, space.id);
      await setModes(t, owner, space.id, 'ONLINE_OPTIONAL');
      const res = await book(ana, {
        ...body(space, slotIn(1_000)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      await simulate(res.body.onlinePayment.id, 'pay');
      await drain(t);

      await t
        .http()
        .put(onlinePath(space.id, 'merchant-account/payout'))
        .set(...bearer(owner))
        .send({
          payout: { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'novo@example.com' },
          acceptTerms: true,
        })
        .expect(200);
      // Sem drenar a fila: a decisão automática do fake ainda não rodou (troca em análise).
      const settle = () =>
        t
          .http()
          .post('/v1/super/online-payments/simulator/settle')
          .set(...bearer(sup))
          .send({ spaceId: space.id })
          .expect(200);
      await settle();
      const gatewayPayouts = async () =>
        (await t.db.select().from(fakeGatewayObjects)).filter((o) => o.kind === 'payout');
      expect(
        await gatewayPayouts(),
        'repasse saiu para a conta nova enquanto a troca estava em análise',
      ).toHaveLength(0);
      expect(await t.db.select().from(payouts).where(eq(payouts.spaceId, space.id))).toHaveLength(
        0,
      );

      // Recusa: volta a conta anterior e o repasse retoma com o saldo.
      await t
        .http()
        .post(`/v1/super/online-payments/simulator/merchant-accounts/${space.id}/reject`)
        .set(...bearer(sup))
        .send({ reason: 'Chave Pix de outro titular.' })
        .expect(200);
      await drain(t);
      await settle();
      await drain(t);
      const paid = await t.db.select().from(payouts).where(eq(payouts.spaceId, space.id));
      expect(paid).toHaveLength(1);
      expect(paid[0]?.amountCents).toBe(PRICE - 400);
      expect(await ledgerSum(space.id)).toBe(0);
    });

    it('trocar a conta sem cadastro (404) ou com o cadastro ainda em análise (422 MERCHANT_NOT_APPROVED)', async () => {
      const space = await createSpace(t.db, 'borda-nao-aprovado');
      const owner = await member(t, 'dono@borda-na.test', space.id, 'OWNER');
      const change = () =>
        t
          .http()
          .put(onlinePath(space.id, 'merchant-account/payout'))
          .set(...bearer(owner))
          .send({ payout: merchantBody().payout, acceptTerms: true });
      const none = await change();
      expect(none.status).toBe(404);
      // Cadastro enviado e ainda não decidido (a fila não rodou).
      await t
        .http()
        .put(onlinePath(space.id, 'merchant-account'))
        .set(...bearer(owner))
        .send(merchantBody())
        .expect(200);
      const pending = await change();
      expect(pending.status).toBe(422);
      expect(pending.body.error.code).toBe('MERCHANT_NOT_APPROVED');
      queueOf(t).clear();
    });
  });

  describe('documento cifrado só no relatório fiscal (RN-ONPAY-10, decisão 97)', () => {
    const FORMATTED = '529.982.247-25';

    it('no banco o documento nunca está em texto claro, nem mascarado por engano', async () => {
      const [row] = await t.db
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, optional.id));
      expect(row?.documentEncrypted).toMatch(/^v1\./);
      expect(row?.documentEncrypted).not.toContain(APPROVED_CPF);
      expect(row?.documentMasked).not.toContain(APPROVED_CPF);
      expect(row?.documentMasked).toContain('*');
    });

    it('nenhuma resposta, notificação, auditoria ou evento fora do relatório fiscal contém o documento', async () => {
      const seen: [string, string][] = [];
      const get = async (label: string, url: string, user?: SignedUp) => {
        const req = t.http().get(url);
        if (user) req.set(...bearer(user));
        const res = await req;
        seen.push([label, JSON.stringify(res.body) + (res.text ?? '')]);
      };
      const manage = (p: string) => onlinePath(optional.id, p);
      for (const user of [ownerOpt, adminOpt]) {
        for (const p of [
          'merchant-account',
          'settings',
          'wallet',
          'wallet/entries',
          'wallet/entries.csv',
          'wallet/payouts',
          'charges',
          'chargebacks',
        ]) {
          await get(`${p} (${user.id})`, manage(p), user);
        }
      }
      await get('espaço público', '/v1/spaces/borda-opcional');
      await get('me/payments', '/v1/me/payments', ana);
      for (const url of [
        '/v1/super/online-payments/merchant-accounts',
        '/v1/super/online-payments/fees',
        '/v1/super/online-payments/revenue',
        '/v1/super/online-payments/revenue.csv',
        '/v1/super/online-payments/simulator/charges',
        '/v1/super/spaces',
      ]) {
        await get(url, url, sup);
      }
      // Dados guardados pelo próprio sistema (fora do cadastro cifrado).
      seen.push(['notifications', JSON.stringify(await t.db.select().from(notifications))]);
      seen.push(['audit_logs', JSON.stringify(await t.db.select().from(auditLogs))]);
      seen.push(['gateway_events', JSON.stringify(await t.db.select().from(gatewayEvents))]);
      seen.push(['online_charges', JSON.stringify(await t.db.select().from(onlineCharges))]);
      for (const [label, text] of seen) {
        expect(text, label).not.toContain(APPROVED_CPF);
        expect(text, label).not.toContain(FORMATTED);
      }
      // E o Super lê o completo só no relatório (auditado).
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
        .format(new Date())
        .slice(0, 7);
      const report = await t
        .http()
        .get('/v1/super/online-payments/reports/monthly')
        .query({ month })
        .set(...bearer(sup))
        .expect(200);
      const item = report.body.items.find((i: Row) => i.spaceId === optional.id);
      expect(item?.document).toBe(APPROVED_CPF);
    });

    it('o texto cifrado de um espaço não abre em outro (o space_id entra como dado associado)', async () => {
      const [src] = await t.db
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, optional.id));
      const [dst] = await t.db
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, required.id));
      const original = dst?.documentEncrypted as string;
      // Pagamento no espaço de destino para ele entrar no relatório.
      const res = await book(bia, {
        ...body(required, slotIn(1_300)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      await simulate(res.body.onlinePayment.id, 'pay');
      await drain(t);
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
        .format(new Date())
        .slice(0, 7);
      const read = async () =>
        (
          await t
            .http()
            .get('/v1/super/online-payments/reports/monthly')
            .query({ month })
            .set(...bearer(sup))
            .expect(200)
        ).body.items.find((i: Row) => i.spaceId === required.id) as Row;
      expect((await read()).document).toBe(APPROVED_CPF);
      try {
        // Cifrado de outro espaço copiado para este: não pode abrir (nem 500).
        await t.db
          .update(merchantAccounts)
          .set({ documentEncrypted: src?.documentEncrypted as string })
          .where(eq(merchantAccounts.spaceId, required.id));
        const swapped = await read();
        expect(swapped.document ?? null).toBeNull();
        // Texto adulterado também não abre.
        const tampered = original.slice(0, -3) + (original.endsWith('AAA') ? 'BBB' : 'AAA');
        await t.db
          .update(merchantAccounts)
          .set({ documentEncrypted: tampered })
          .where(eq(merchantAccounts.spaceId, required.id));
        expect((await read()).document ?? null).toBeNull();
      } finally {
        await t.db
          .update(merchantAccounts)
          .set({ documentEncrypted: original })
          .where(eq(merchantAccounts.spaceId, required.id));
      }
      expect((await read()).document).toBe(APPROVED_CPF);
    });
  });

  describe('exclusão de conta com pagamentos online (RF-AUTH-03, RN-ONPAY-05)', () => {
    it('estorno parcial anterior: a exclusão devolve só o que restava; contestada não é estornada de novo; o espaço não guarda o nome', async () => {
      const space = await createSpace(t.db, 'borda-exclusao');
      const owner = await member(t, 'dono@borda-excl.test', space.id, 'OWNER');
      const titular = await signUp(t, 'titular@borda-excl.test', 'Titular Sumido');
      await approveMerchant(t, owner, space.id);
      await setModes(t, owner, space.id, 'ONLINE_OPTIONAL');
      const partial = await book(titular, {
        ...body(space, slotIn(1_500)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      }).expect(201);
      const disputed = await book(titular, {
        ...body(space, slotIn(1_700)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_CHARGEBACK,
      }).expect(201);
      await drain(t, { withChargebacks: true });
      await t
        .http()
        .post(onlinePath(space.id, `charges/${partial.body.onlinePayment.id}/refunds`))
        .set(...bearer(owner))
        .send({ amountCents: 2_500, reason: 'Desconto antes da exclusão' })
        .expect(201);
      const disputedBefore = await chargeRow(t, disputed.body.onlinePayment.id);
      expect(disputedBefore.status).toBe('CHARGEBACK');

      const request = await t
        .http()
        .post('/v1/me/deletion-request')
        .set(...bearer(titular))
        .send({ password: PASSWORD })
        .expect(201);
      await t
        .http()
        .post(`/v1/super/deletion-requests/${request.body.requestId}/fulfill`)
        .set(...bearer(sup))
        .send({})
        .expect(200);
      await drain(t);

      const settled = await chargeRow(t, partial.body.onlinePayment.id);
      expect(settled).toMatchObject({
        status: 'REFUNDED',
        refundedCents: PRICE,
        feeRefundedCents: settled.platformFeeCents,
      });
      // Contestada: nada novo foi estornado (o banco já tirou o valor).
      expect(await chargeRow(t, disputed.body.onlinePayment.id)).toMatchObject({
        status: 'CHARGEBACK',
        refundedCents: disputedBefore.refundedCents,
        feeRefundedCents: disputedBefore.feeRefundedCents,
      });
      expect(await ledgerSum(space.id)).toBe(0);
      // O histórico do espaço não guarda dados pessoais do titular excluído.
      const entries = await t
        .http()
        .get(onlinePath(space.id, 'wallet/entries'))
        .query({ limit: 100 })
        .set(...bearer(owner))
        .expect(200);
      const csv = await t
        .http()
        .get(onlinePath(space.id, 'wallet/entries.csv'))
        .set(...bearer(owner))
        .expect(200);
      const charges = await t
        .http()
        .get(onlinePath(space.id, 'charges'))
        .set(...bearer(owner))
        .expect(200);
      const chargebacks = await t
        .http()
        .get(onlinePath(space.id, 'chargebacks'))
        .set(...bearer(owner))
        .expect(200);
      for (const [label, text] of [
        ['wallet/entries', JSON.stringify(entries.body)],
        ['wallet/entries.csv', csv.text],
        ['charges', JSON.stringify(charges.body)],
        ['chargebacks', JSON.stringify(chargebacks.body)],
      ] as const) {
        expect(text, label).not.toContain('Titular Sumido');
        expect(text, label).not.toContain('titular@borda-excl.test');
      }
    });
  });
});

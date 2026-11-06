import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bookings,
  courtOccupations,
  gatewayEvents,
  notifications,
  onlineCharges,
  onlineRefunds,
  paymentRecords,
  spaceLedgerEntries,
} from '../../src/db/schema/index.js';
import { signFakeWebhook } from '../../src/payments/gateways/fake/fake-signature.js';
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
  CARD_DECLINE,
  chargeRow,
  drain,
  jobsOf,
  ledgerOf,
  type Row,
  recordsOf,
  setModes,
} from './fixtures.js';

// RF-ONPAY-03/04, RN-ONPAY-02 a 05 e 07, decisões 85, 86 e 96: reserva com pagamento online.

const SECRET = 'segredo-dos-webhooks-de-teste-com-mais-de-32-chars';
const PRICE = 10_000; // R$ 100/h × 60 min

useMiddayClock();

describe('pagamento online da reserva', () => {
  let t: TestApp;
  let required: Space;
  let optional: Space;
  let ownerReq: SignedUp;
  let ownerOpt: SignedUp;
  let adminOpt: SignedUp;
  let ana: SignedUp;
  let bia: SignedUp;
  let caio: SignedUp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({ env: { PAYMENTS_FAKE_WEBHOOK_SECRET: SECRET } });
    required = await createSpace(t.db, 'obrigatorio-pg');
    optional = await createSpace(t.db, 'opcional-pg');
    ownerReq = await member(t, 'dono@req.test', required.id, 'OWNER');
    ownerOpt = await member(t, 'dono@opt.test', optional.id, 'OWNER');
    adminOpt = await member(t, 'admin@opt.test', optional.id, 'ADMIN');
    ana = await signUp(t, 'ana@pg.test', 'Ana Jogadora');
    bia = await signUp(t, 'bia@pg.test', 'Bia Jogadora');
    caio = await signUp(t, 'caio@pg.test', 'Caio Jogador');
    sup = await superUser(t, 'super@flow.test');
    await approveMerchant(t, ownerReq, required.id);
    await approveMerchant(t, ownerOpt, optional.id);
    await setModes(t, ownerReq, required.id, 'ONLINE_REQUIRED');
    await setModes(t, ownerOpt, optional.id, 'ONLINE_OPTIONAL');
  });

  afterAll(async () => {
    await t.close();
  });

  const slot = (space: Space, startsAt: Date, courtId = space.courtA) => ({
    spaceId: space.id,
    courtId,
    sportId: space.sportId,
    startsAt: startsAt.toISOString(),
    durationMin: 60,
    peopleCount: 2,
  });

  const book = (user: SignedUp, body: Row, key?: string) => {
    const req = t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const pay = (user: SignedUp, bookingId: string, body: Row, key?: string) => {
    const req = t
      .http()
      .post(`/v1/bookings/${bookingId}/payment`)
      .set(...bearer(user));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const simulate = (chargeId: string, action: string) =>
    t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${chargeId}/${action}`)
      .set(...bearer(sup))
      .expect(200);

  const notesOf = (user: SignedUp) =>
    t.db.select().from(notifications).where(eq(notifications.userId, user.id));

  describe('modo obrigatório (decisão 85)', () => {
    let bookingId: string;
    let chargeId: string;

    it('nasce PENDING_PAYMENT, segura o horário 15 min e traz o Pix com serverTime', async () => {
      const startsAt = slotIn(180);
      const res = await book(ana, {
        ...slot(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      bookingId = res.body.id;
      expect(res.body.status).toBe('PENDING_PAYMENT');
      expect(new Date(res.body.paymentDueAt).getTime()).toBe(Date.now() + 15 * 60_000);
      const payment = res.body.onlinePayment;
      chargeId = payment.id;
      expect(payment).toMatchObject({
        method: 'PIX',
        status: 'PENDING',
        amountCents: PRICE,
        expiresAt: res.body.paymentDueAt,
        failureCode: null,
      });
      expect(payment.pix.copyPaste).toMatch(/^000201/);
      expect(payment.pix.qrSvg).toContain('fill="currentColor"');
      expect(payment.pix.qrSvg).not.toContain('<rect');
      expect(new Date(payment.serverTime).getTime()).toBe(Date.now());
      expect(payment.paymentEnvironment.sandbox.label).toBe('Ambiente de teste');
      // O jogador não vê taxa nenhuma (decisão 82).
      expect(JSON.stringify(payment)).not.toMatch(/fee/i);
      // Ocupa a agenda: outra pessoa não pega o horário.
      const taken = await book(bia, {
        ...slot(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(409);
      expect(taken.body.error.code).toBe('SLOT_UNAVAILABLE');
      // Aparece nas próximas, como aguardando pagamento.
      const mine = await t
        .http()
        .get('/v1/bookings')
        .set(...bearer(ana))
        .expect(200);
      expect(mine.body.items.map((b: Row) => [b.id, b.status])).toContainEqual([
        bookingId,
        'PENDING_PAYMENT',
      ]);
      // PG.4: a reserva traz a hora do servidor, como a cobrança (criação, lista e detalhe).
      expect(new Date(res.body.serverTime).getTime()).toBe(Date.now());
      const listed = mine.body.items.find((b: Row) => b.id === bookingId);
      expect(new Date(listed.serverTime).getTime()).toBe(Date.now());
      const detail = await t
        .http()
        .get(`/v1/bookings/${bookingId}`)
        .set(...bearer(ana))
        .expect(200);
      expect(new Date(detail.body.serverTime).getTime()).toBe(Date.now());
    });

    it('no local é recusado no modo obrigatório', async () => {
      const res = await book(bia, slot(required, slotIn(300))).expect(422);
      expect(res.body.error.code).toBe('ONLINE_PAYMENT_REQUIRED');
    });

    it('pago pelo simulador: confirma, registra ONLINE sem recorded_by e lança venda e taxa', async () => {
      await simulate(chargeId, 'pay');
      await drain(t);
      const booking = await bookingRow(t, bookingId);
      expect(booking).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentDueAt: null,
      });
      const [record] = await recordsOf(t, chargeId);
      expect(record).toMatchObject({
        channel: 'ONLINE',
        method: 'PIX',
        amountCents: PRICE,
        recordedBy: null,
        reversedAt: null,
      });
      const ledger = await ledgerOf(t, required.id, chargeId);
      expect(ledger.map((e) => [e.kind, e.amountCents]).sort()).toEqual([
        ['PLATFORM_FEE', -400],
        ['SALE', PRICE],
      ]);
      // Pix libera em D+1.
      expect(ledger[0]?.availableAt.getTime()).toBe(Date.now() + 24 * 60 * 60_000);
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({
        status: 'PAID',
        platformFeeCents: 400,
        spaceNetCents: 9_600,
        gatewayCostCents: 99,
        feeBps: 400,
        minFeeCents: 100,
      });
      expect((await notesOf(ana)).map((n) => n.type)).toContain('PAYMENT_CONFIRMED');
    });

    it('webhook repetido não processa de novo; evento antigo depois do novo não volta o status', async () => {
      const [event] = await t.db
        .select()
        .from(gatewayEvents)
        .where(eq(gatewayEvents.type, 'charge.updated'))
        .limit(1);
      if (!event) throw new Error('Sem evento gravado.');
      const body = JSON.stringify({
        id: event.eventId,
        type: event.type,
        objectId: event.payload.objectId,
        createdAt: new Date().toISOString(),
      });
      const deliver = (raw: string) =>
        t
          .http()
          .post('/v1/webhooks/payments/fake')
          .set('content-type', 'application/json')
          .set('x-fake-signature', signFakeWebhook(SECRET, raw))
          .send(raw);
      const repeated = await deliver(body).expect(200);
      expect(repeated.body).toEqual({ received: 0 });
      // Os bytes exatos valem em qualquer content-type (a assinatura confere o corpo bruto).
      const asText = await t
        .http()
        .post('/v1/webhooks/payments/fake')
        .set('content-type', 'text/plain')
        .set('x-fake-signature', signFakeWebhook(SECRET, body))
        .send(body)
        .expect(200);
      expect(asText.body).toEqual({ received: 0 });
      // Um evento novo (fora de ordem: anterior ao pagamento) só pede uma sincronização.
      const stale = JSON.stringify({
        id: 'evt_antigo_fora_de_ordem',
        type: 'charge.updated',
        objectId: event.payload.objectId,
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
      expect((await deliver(stale).expect(200)).body).toEqual({ received: 1 });
      await drain(t);
      expect((await chargeRow(t, chargeId)).status).toBe('PAID');
      expect(await recordsOf(t, chargeId)).toHaveLength(1);
      expect(await ledgerOf(t, required.id, chargeId)).toHaveLength(2);
      const processed = await t.db
        .select()
        .from(gatewayEvents)
        .where(eq(gatewayEvents.eventId, 'evt_antigo_fora_de_ordem'));
      expect(processed[0]?.processedAt).not.toBeNull();
    });

    it('duas pessoas no mesmo horário ao mesmo tempo: uma segura, a outra recebe 409', async () => {
      const startsAt = slotIn(360);
      const results = await Promise.all([
        book(bia, { ...slot(required, startsAt, required.courtB), paymentOption: 'ONLINE_PIX' }),
        book(caio, { ...slot(required, startsAt, required.courtB), paymentOption: 'ONLINE_PIX' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('vence: cancelada por PAYMENT_EXPIRED, horário livre na leitura, sem avisar o espaço', async () => {
      const startsAt = slotIn(480);
      const res = await book(bia, {
        ...slot(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const id = res.body.id as string;
      const pixId = res.body.onlinePayment.id as string;
      const ownerNotes = (await notesOf(ownerReq)).length;
      vi.setSystemTime(Date.now() + 16 * 60_000);
      // A grade expira na leitura (antes do job).
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
        startsAt,
      );
      const grid = await t
        .http()
        .get(`/v1/spaces/${required.id}/availability`)
        .query({ date, durationMin: 60, sportId: required.sportId, courtId: required.courtA })
        .expect(200);
      const free = grid.body.courts[0].slots.find(
        (s: Row) => s.startsAt === startsAt.toISOString(),
      );
      expect(free.available).toBe(true);
      const booking = await bookingRow(t, id);
      expect(booking).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'PAYMENT_EXPIRED',
        cancelledBy: null,
      });
      expect((await chargeRow(t, pixId)).status).toBe('EXPIRED');
      const [occupation] = await t.db
        .select()
        .from(courtOccupations)
        .where(eq(courtOccupations.refId, id));
      expect(occupation?.active).toBe(false);
      expect((await notesOf(bia)).map((n) => [n.type, n.title])).toContainEqual([
        'PAYMENT_EXPIRED',
        'Reserva cancelada',
      ]);
      expect(await notesOf(ownerReq)).toHaveLength(ownerNotes);

      // Pagamento que chega depois do prazo: registrado e estornado sozinho, sem voltar a PAID.
      await simulate(pixId, 'pay');
      await drain(t);
      const late = await chargeRow(t, pixId);
      expect(late.status).toBe('EXPIRED');
      expect(late.paidAt).not.toBeNull();
      expect(late.refundedCents).toBe(PRICE);
      expect(late.feeRefundedCents).toBe(400);
      const [refund] = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, pixId));
      expect(refund).toMatchObject({
        reasonCode: 'PAID_AFTER_DEADLINE',
        requestedBy: null,
        status: 'SUCCEEDED',
      });
      expect(await recordsOf(t, pixId)).toHaveLength(0);
      const ledger = await ledgerOf(t, required.id, pixId);
      expect(ledger.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0);
      expect((await notesOf(bia)).map((n) => n.title)).toContain('Pagamento devolvido');
      const mine = await t
        .http()
        .get(`/v1/me/payments/${pixId}`)
        .set(...bearer(bia))
        .expect(200);
      expect(mine.body.refunds[0]).toMatchObject({ reasonCode: 'PAID_AFTER_DEADLINE' });
      // PG.4: o comprovante traz o pagador, e a lista também traz os estornos com o motivo.
      expect(mine.body.payerName).toBe('Bia Jogadora');
      const list = await t
        .http()
        .get('/v1/me/payments')
        .set(...bearer(bia))
        .expect(200);
      const item = list.body.items.find((i: Row) => i.id === pixId);
      expect(item.refunds).toEqual([
        expect.objectContaining({
          kind: 'REFUND',
          status: 'SUCCEEDED',
          amountCents: PRICE,
          reasonCode: 'PAID_AFTER_DEADLINE',
          reason: 'Estorno automático: o pagamento chegou depois do prazo.',
        }),
      ]);
      vi.setSystemTime(Date.now() - 16 * 60_000);
    });

    it('cartão recusado deixa a reserva aguardando; a nova tentativa vai para a mesma reserva', async () => {
      const res = await book(caio, {
        ...slot(required, slotIn(600)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_DECLINE,
      }).expect(201);
      expect(res.body.status).toBe('PENDING_PAYMENT');
      expect(res.body.onlinePayment).toMatchObject({
        status: 'FAILED',
        failureCode: 'CARD_DECLINED',
        cardLast4: '0002',
      });
      expect(res.body.onlinePayment.failureReason).toMatch(/recusado/);
      const retry = await pay(caio, res.body.id, {
        method: 'CARD',
        cardToken: CARD_APPROVE,
      }).expect(201);
      expect(retry.body).toMatchObject({ status: 'PAID', cardBrand: 'visa', cardLast4: '1111' });
      const booking = await bookingRow(t, res.body.id);
      expect(booking.status).toBe('CONFIRMED');
      // Cartão libera em D+30.
      const ledger = await ledgerOf(t, required.id, retry.body.id);
      expect(ledger.find((e) => e.kind === 'SALE')?.availableAt.getTime()).toBe(
        Date.now() + 30 * 24 * 60 * 60_000,
      );
    });

    it('Idempotency-Key: a mesma chave devolve a reserva e a cobrança já criadas (decisão 96)', async () => {
      const body = { ...slot(required, slotIn(720)), paymentOption: 'ONLINE_PIX' };
      const first = await book(ana, body, 'reserva-chave-0001').expect(201);
      const second = await book(ana, body, 'reserva-chave-0001').expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.onlinePayment.id).toBe(first.body.onlinePayment.id);
      const a = await pay(ana, first.body.id, { method: 'PIX' }, 'cobranca-chave-01').expect(201);
      const b = await pay(ana, first.body.id, { method: 'PIX' }, 'cobranca-chave-01').expect(201);
      expect(b.body.id).toBe(a.body.id);
      const pending = await t.db
        .select()
        .from(onlineCharges)
        .where(
          and(eq(onlineCharges.payableId, first.body.id), eq(onlineCharges.status, 'PENDING')),
        );
      expect(pending).toHaveLength(1);
      const bad = await book(ana, body, 'curta').expect(400);
      expect(bad.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('a mesma Idempotency-Key com outro pedido: 422 IDEMPOTENCY_KEY_REUSED, sem criar nada', async () => {
      const key = 'reserva-chave-0002';
      const body = {
        ...slot(required, slotIn(1080)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_DECLINE,
      };
      const first = await book(ana, body, key).expect(201);
      // O token do cartão não conta: cada tokenização do mesmo cartão gera outro.
      const retry = await book(ana, { ...body, cardToken: CARD_APPROVE }, key).expect(201);
      expect(retry.body.id).toBe(first.body.id);
      for (const other of [
        { ...body, peopleCount: 3 },
        { ...body, startsAt: slotIn(1140).toISOString() },
        { ...body, paymentOption: 'ONLINE_PIX', cardToken: undefined },
      ]) {
        const res = await book(ana, other, key).expect(422);
        expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      }
      const created = await t.db.select().from(bookings).where(eq(bookings.idempotencyKey, key));
      expect(created).toHaveLength(1);
      expect(created[0]?.idempotencyRequestHash).toMatch(/^[0-9a-f]{64}$/);

      // Cobrança: outro meio ou outro item com a mesma chave também é recusado.
      const chargeKey = 'cobranca-chave-02';
      const pix = await pay(ana, first.body.id, { method: 'PIX' }, chargeKey).expect(201);
      const card = await pay(
        ana,
        first.body.id,
        { method: 'CARD', cardToken: CARD_APPROVE },
        chargeKey,
      ).expect(422);
      expect(card.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherBooking = await book(ana, {
        ...slot(required, slotIn(1140)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const otherItem = await pay(ana, otherBooking.body.id, { method: 'PIX' }, chargeKey).expect(
        422,
      );
      expect(otherItem.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      // O mesmo pedido segue devolvendo a cobrança criada.
      const again = await pay(ana, first.body.id, { method: 'PIX' }, chargeKey).expect(201);
      expect(again.body.id).toBe(pix.body.id);
      const keyed = await t.db
        .select()
        .from(onlineCharges)
        .where(eq(onlineCharges.requestKey, chargeKey));
      expect(keyed.map((c) => c.id)).toEqual([pix.body.id]);
      expect((await chargeRow(t, otherBooking.body.onlinePayment.id)).status).toBe('PENDING');
    });

    it('o organizador desiste da reserva aguardando pagamento: libera o horário (decisão 96)', async () => {
      const startsAt = slotIn(840);
      const res = await book(bia, {
        ...slot(required, startsAt),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const cancel = await t
        .http()
        .post(`/v1/bookings/${res.body.id}/cancel`)
        .set(...bearer(bia))
        .send({})
        .expect(200);
      expect(cancel.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'PAYMENT_ABANDONED' });
      const charge = await chargeRow(t, res.body.onlinePayment.id);
      expect(charge).toMatchObject({ status: 'CANCELLED', closedReason: 'BOOKING_CANCELLED' });
      await book(caio, { ...slot(required, startsAt), paymentOption: 'ONLINE_PIX' }).expect(201);
      // Outra pessoa não paga nem cancela a reserva de alguém.
      await pay(caio, res.body.id, { method: 'PIX' }).expect(404);
    });

    it('registro manual é recusado em PENDING_PAYMENT', async () => {
      const res = await book(ana, {
        ...slot(required, slotIn(960)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const record = await t
        .http()
        .post(`/v1/manage/spaces/${required.id}/payments`)
        .set(...bearer(ownerReq))
        .send({
          payableType: 'BOOKING',
          payableId: res.body.id,
          amountCents: PRICE,
          method: 'CASH',
        })
        .expect(409);
      expect(record.body.error.code).toBe('BOOKING_NOT_PAYABLE');
    });
  });

  describe('modo opcional e cobranças concorrentes (RN-ONPAY-03, decisão 96)', () => {
    it('nasce confirmada; no local segue como hoje', async () => {
      const res = await book(ana, slot(optional, slotIn(180))).expect(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        paymentDueAt: null,
        onlinePayment: null,
      });
    });

    it('uma cobrança aberta por item: trocar de forma cancela a anterior; pagamento tardio nela é estornado', async () => {
      const booking = await book(ana, {
        ...slot(optional, slotIn(240)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      expect(booking.body.status).toBe('CONFIRMED');
      const first = booking.body.onlinePayment.id as string;
      // Pix do modo opcional: 15 min.
      expect(new Date(booking.body.onlinePayment.expiresAt).getTime()).toBe(
        Date.now() + 15 * 60_000,
      );
      const second = await pay(ana, booking.body.id, { method: 'PIX' }).expect(201);
      expect(second.body.id).not.toBe(first);
      expect(await chargeRow(t, first)).toMatchObject({
        status: 'CANCELLED',
        closedReason: 'REPLACED',
      });
      const open = await t.db
        .select()
        .from(onlineCharges)
        .where(
          and(eq(onlineCharges.payableId, booking.body.id), eq(onlineCharges.status, 'PENDING')),
        );
      expect(open.map((c) => c.id)).toEqual([second.body.id]);
      // O banco liquida o Pix trocado: a API estorna sozinha, com o motivo da troca.
      await simulate(first, 'pay');
      await drain(t);
      const [refund] = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, first));
      expect(refund?.reasonCode).toBe('PAID_AFTER_METHOD_CHANGE');
      // PG.4: Meus pagamentos mostra o motivo na lista e no detalhe.
      const list = await t
        .http()
        .get('/v1/me/payments')
        .set(...bearer(ana))
        .expect(200);
      const item = list.body.items.find((i: Row) => i.id === first);
      expect(item.refunds.map((r: Row) => r.reasonCode)).toEqual(['PAID_AFTER_METHOD_CHANGE']);
      const detail = await t
        .http()
        .get(`/v1/me/payments/${first}`)
        .set(...bearer(ana))
        .expect(200);
      expect(detail.body.refunds.map((r: Row) => r.reasonCode)).toEqual([
        'PAID_AFTER_METHOD_CHANGE',
      ]);
      expect(detail.body.payerName).toBe('Ana Jogadora');
      // Itens sem estorno vêm com a lista vazia.
      expect(list.body.items.find((i: Row) => i.id === second.body.id)?.refunds).toEqual([]);
      expect((await bookingRow(t, booking.body.id)).paymentStatus).toBe('PENDING');
      // O Pix novo, pago, quita a reserva.
      await simulate(second.body.id, 'pay');
      await drain(t);
      expect((await bookingRow(t, booking.body.id)).paymentStatus).toBe('PAID');
    });

    it('se a cobrança anterior acabou de ser paga, a troca devolve a paga (vale a paga)', async () => {
      const booking = await book(bia, {
        ...slot(optional, slotIn(300)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const pixId = booking.body.onlinePayment.id as string;
      // Pago no banco, webhook ainda não entregue.
      await simulate(pixId, 'pay');
      const res = await pay(bia, booking.body.id, {
        method: 'CARD',
        cardToken: CARD_APPROVE,
      }).expect(201);
      expect(res.body).toMatchObject({ id: pixId, status: 'PAID' });
      await drain(t);
      const charges = await t.db
        .select()
        .from(onlineCharges)
        .where(eq(onlineCharges.payableId, booking.body.id));
      expect(charges).toHaveLength(1);
      const again = await pay(bia, booking.body.id, { method: 'PIX' }).expect(409);
      expect(again.body.error.code).toBe('ALREADY_PAID');
    });

    it('registro no local cancela a cobrança aberta; já paga, 409 com código próprio', async () => {
      const a = await book(caio, {
        ...slot(optional, slotIn(360)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const detail = await t
        .http()
        .get(`/v1/manage/spaces/${optional.id}/bookings/${a.body.id}`)
        .set(...bearer(adminOpt))
        .expect(200);
      expect(detail.body.openOnlineCharge).toMatchObject({
        id: a.body.onlinePayment.id,
        method: 'PIX',
      });
      expect(detail.body.onlineCharges[0]).toMatchObject({ status: 'PENDING', feeBps: 400 });
      await t
        .http()
        .post(`/v1/manage/spaces/${optional.id}/payments`)
        .set(...bearer(adminOpt))
        .send({ payableType: 'BOOKING', payableId: a.body.id, amountCents: PRICE, method: 'CASH' })
        .expect(201);
      expect(await chargeRow(t, a.body.onlinePayment.id)).toMatchObject({
        status: 'CANCELLED',
        closedReason: 'PAID_ON_SITE',
      });

      const b = await book(caio, {
        ...slot(optional, slotIn(420)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      await simulate(b.body.onlinePayment.id, 'pay');
      const refused = await t
        .http()
        .post(`/v1/manage/spaces/${optional.id}/payments`)
        .set(...bearer(adminOpt))
        .send({ payableType: 'BOOKING', payableId: b.body.id, amountCents: PRICE, method: 'CASH' })
        .expect(409);
      expect(refused.body.error.code).toBe('ONLINE_CHARGE_ALREADY_PAID');
      expect((await bookingRow(t, b.body.id)).paymentStatus).toBe('PAID');
      // O registro online não sai pelo estorno manual do registro.
      const [record] = await recordsOf(t, b.body.onlinePayment.id);
      const reverse = await t
        .http()
        .post(`/v1/manage/spaces/${optional.id}/payments/${record?.id}/reverse`)
        .set(...bearer(adminOpt))
        .send({})
        .expect(409);
      expect(reverse.body.error.code).toBe('ONLINE_PAYMENT_NEEDS_REFUND');
      await drain(t);
    });

    it('cancelamento no prazo pelo organizador estorna o total sozinho (RN-ONPAY-05)', async () => {
      const res = await book(ana, {
        ...slot(optional, slotIn(600)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      }).expect(201);
      const chargeId = res.body.onlinePayment.id as string;
      await t
        .http()
        .post(`/v1/bookings/${res.body.id}/cancel`)
        .set(...bearer(ana))
        .send({})
        .expect(200);
      await drain(t);
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({
        status: 'REFUNDED',
        refundedCents: PRICE,
        feeRefundedCents: 600,
      });
      const [refund] = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, chargeId));
      expect(refund).toMatchObject({
        reasonCode: 'BOOKING_CANCELLED_BY_PLAYER',
        chargeAgain: false,
        itemDiscountCents: 0,
      });
      const [record] = await recordsOf(t, chargeId);
      expect(record?.reversedAt).not.toBeNull();
      const net = (await ledgerOf(t, optional.id, chargeId)).reduce((s, e) => s + e.amountCents, 0);
      expect(net).toBe(0);
      expect((await notesOf(ana)).map((n) => n.type)).toContain('PAYMENT_REFUNDED');
    });

    it('cancelamento pelo espaço estorna o total a qualquer momento', async () => {
      const res = await book(bia, {
        ...slot(optional, slotIn(660)),
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      }).expect(201);
      await t
        .http()
        .post(`/v1/manage/spaces/${optional.id}/bookings/${res.body.id}/cancel`)
        .set(...bearer(adminOpt))
        .send({ reason: 'Chuva forte' })
        .expect(200);
      const [refund] = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, res.body.onlinePayment.id));
      expect(refund?.reasonCode).toBe('BOOKING_CANCELLED_BY_SPACE');
      expect((await chargeRow(t, res.body.onlinePayment.id)).status).toBe('REFUNDED');
    });

    it('o Professor não vê cobrança nem valores na reserva (decisão 53)', async () => {
      const teacher = await member(t, 'prof@opt.test', optional.id, 'TEACHER');
      const res = await book(caio, {
        ...slot(optional, slotIn(720)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      const detail = await t
        .http()
        .get(`/v1/manage/spaces/${optional.id}/bookings/${res.body.id}`)
        .set(...bearer(teacher))
        .expect(200);
      expect(detail.body).toMatchObject({
        openOnlineCharge: null,
        onlineCharges: [],
        priceCents: null,
      });
      await t
        .http()
        .get(`/v1/manage/spaces/${optional.id}/online-payments/charges`)
        .set(...bearer(teacher))
        .expect(403);
    });

    it('Pix vencido no modo opcional: a reserva segue confirmada e o jogador é avisado', async () => {
      const res = await book(ana, {
        ...slot(optional, slotIn(780)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      vi.setSystemTime(Date.now() + 16 * 60_000);
      await jobsOf(t).expire();
      vi.setSystemTime(Date.now() - 16 * 60_000);
      expect((await chargeRow(t, res.body.onlinePayment.id)).status).toBe('EXPIRED');
      expect((await bookingRow(t, res.body.id)).status).toBe('CONFIRMED');
      expect((await notesOf(ana)).map((n) => n.title)).toContain('O Pix venceu');
    });

    it('espaço suspenso cancela as cobranças abertas (RN-ONPAY-09)', async () => {
      const res = await book(caio, {
        ...slot(optional, slotIn(840)),
        paymentOption: 'ONLINE_PIX',
      }).expect(201);
      await t
        .http()
        .post(`/v1/super/spaces/${optional.id}/suspend`)
        .set(...bearer(sup))
        .send({ reason: 'Teste' })
        .expect(200);
      expect(await chargeRow(t, res.body.onlinePayment.id)).toMatchObject({
        status: 'CANCELLED',
        closedReason: 'SPACE_INACTIVE',
      });
      const blocked = await pay(caio, res.body.id, { method: 'PIX' }).expect(422);
      expect(blocked.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
      await t
        .http()
        .post(`/v1/super/spaces/${optional.id}/reactivate`)
        .set(...bearer(sup))
        .send({})
        .expect(200);
    });
  });

  it('sem registro duplicado: cada cobrança paga tem no máximo um registro ativo', async () => {
    const rows = await t.db
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.channel, 'ONLINE'));
    const active = new Map<string, number>();
    for (const row of rows) {
      if (row.reversedAt || !row.onlineChargeId) continue;
      active.set(row.onlineChargeId, (active.get(row.onlineChargeId) ?? 0) + 1);
    }
    expect([...active.values()].every((n) => n === 1)).toBe(true);
    const ledger = await t.db.select().from(spaceLedgerEntries);
    expect(ledger.length).toBeGreaterThan(0);
  });
});

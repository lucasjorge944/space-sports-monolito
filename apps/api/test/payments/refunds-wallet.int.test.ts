import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  notifications,
  payouts,
  plans,
  spaceSettings,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
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
  ledgerTotal,
  onlinePath,
  type Row,
  recordsOf,
  setModes,
} from './fixtures.js';

// RN-ONPAY-01, 04 a 06; RF-ONPAY-05 a 09 e 11; decisões 86, 87, 89, 93 e 94: estornos com a regra
// acumulada e o abatimento, chargeback com contestação, carteira e repasse, mensalidade online,
// Meus pagamentos e a receita do Super.

useMiddayClock();

describe('estornos, contestações, carteira e mensalidade', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let player: SignedUp;
  let student: SignedUp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'carteira-pg');
    // R$ 20/h: com 60 min, a taxa Pix de 4% (R$ 0,80) cai no mínimo de R$ 1,00.
    await t.db
      .update(spaceSettings)
      .set({ pricePerHourCents: 2_000 })
      .where(eq(spaceSettings.spaceId, space.id));
    owner = await member(t, 'dono@carteira.test', space.id, 'OWNER');
    admin = await member(t, 'admin@carteira.test', space.id, 'ADMIN');
    teacher = await member(t, 'prof@carteira.test', space.id, 'TEACHER');
    player = await signUp(t, 'maria@carteira.test', 'Maria Oliveira');
    student = await signUp(t, 'aluno@carteira.test', 'Aluno Teste');
    sup = await superUser(t, 'super@carteira.test');
    await approveMerchant(t, owner, space.id);
    await setModes(t, owner, space.id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
  });

  afterAll(async () => {
    await t.close();
  });

  const path = (p: string) => onlinePath(space.id, p);

  const bookAndPay = async (minutes: number, option: Row) => {
    const res = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(player))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(minutes).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        ...option,
      })
      .expect(201);
    return { bookingId: res.body.id as string, chargeId: res.body.onlinePayment.id as string };
  };

  const refund = (chargeId: string, body: Row, user = admin) =>
    t
      .http()
      .post(path(`charges/${chargeId}/refunds`))
      .set(...bearer(user))
      .send(body);

  describe('estorno manual (RN-ONPAY-05, decisões 93 e 94)', () => {
    let bookingId: string;
    let chargeId: string;

    it('Pix de R$ 20,00: taxa no mínimo de R$ 1,00 e o indicador minFeeApplied', async () => {
      ({ bookingId, chargeId } = await bookAndPay(180, { paymentOption: 'ONLINE_PIX' }));
      await t
        .http()
        .post(`/v1/super/online-payments/simulator/charges/${chargeId}/pay`)
        .set(...bearer(sup))
        .expect(200);
      await drain(t);
      const res = await t
        .http()
        .get(path(`charges/${chargeId}`))
        .set(...bearer(owner))
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'PAID',
        amountCents: 2_000,
        platformFeeCents: 100,
        spaceNetCents: 1_900,
        feeBps: 400,
        minFeeApplied: true,
        refundableCents: 2_000,
        transactionId: expect.stringMatching(/^ch_/),
      });
      expect(res.body.availableAt).not.toBeNull();
    });

    it('o Professor e o jogador não estornam', async () => {
      await refund(chargeId, { amountCents: 330, reason: 'Teste' }, teacher).expect(403);
      await t
        .http()
        .post(path(`charges/${chargeId}/refunds`))
        .set(...bearer(player))
        .send({ amountCents: 330, reason: 'Teste' })
        .expect(403);
    });

    it('três estornos de R$ 3,30 e o resto devolvem a taxa inteira (R$ 1,00) pela regra acumulada', async () => {
      // 1º: abatimento (padrão): a reserva segue paga.
      const r1 = await refund(chargeId, { amountCents: 330, reason: 'Atraso na quadra' }).expect(
        201,
      );
      expect(r1.body).toMatchObject({
        amountCents: 330,
        feeRefundCents: 17,
        reasonCode: 'MANUAL',
        chargeAgain: false,
        itemDiscountCents: 330,
        requestedByName: 'Jogador Teste',
      });
      let booking = await bookingRow(t, bookingId);
      expect(booking).toMatchObject({ discountCents: 330, paymentStatus: 'PAID' });
      expect((await recordsOf(t, chargeId)).map((r) => [r.amountCents, r.reversedAt])).toEqual([
        [1_670, null],
      ]);
      // 2º: volta a ser cobrado.
      const r2 = await refund(chargeId, {
        amountCents: 330,
        reason: 'Cobrar no local',
        chargeAgain: true,
      }).expect(201);
      expect(r2.body).toMatchObject({
        feeRefundCents: 16,
        chargeAgain: true,
        itemDiscountCents: 0,
      });
      booking = await bookingRow(t, bookingId);
      expect(booking).toMatchObject({ discountCents: 330, paymentStatus: 'PARTIALLY_PAID' });
      const r3 = await refund(chargeId, { amountCents: 330, reason: 'Mais um' }).expect(201);
      expect(r3.body.feeRefundCents).toBe(17);
      // Acima do que resta: 422 com o saldo.
      const over = await refund(chargeId, { amountCents: 1_011, reason: 'Demais' }).expect(422);
      expect(over.body.error).toMatchObject({
        code: 'REFUND_EXCEEDS_BALANCE',
        details: { refundableCents: 1_010 },
      });
      // O valor é sempre explícito, também no "tudo o que falta" (PG.2b).
      const missing = await refund(chargeId, { reason: 'Encerrando' }).expect(400);
      expect(missing.body.error.code).toBe('VALIDATION_ERROR');
      // Tudo o que resta, com o resto exato da taxa.
      const r4 = await refund(chargeId, {
        amountCents: 1_010,
        reason: 'Encerrando',
        chargeAgain: true,
      }).expect(201);
      expect(r4.body).toMatchObject({ amountCents: 1_010, feeRefundCents: 50 });
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({
        status: 'REFUNDED',
        refundedCents: 2_000,
        feeRefundedCents: 100,
      });
      const [record] = await recordsOf(t, chargeId);
      expect(record?.reversedAt).not.toBeNull();
      const ledger = await ledgerOf(t, space.id, chargeId);
      expect(ledger.reduce((sum, e) => sum + e.amountCents, 0)).toBe(0);
      // Estornado não estorna de novo.
      const again = await refund(chargeId, { amountCents: 1, reason: 'x' }).expect(409);
      expect(again.body.error.code).toBe('CHARGE_NOT_REFUNDABLE');
      const audits = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payment.online.refund'));
      expect(audits).toHaveLength(4);
    });
  });

  describe('chargeback (RN-ONPAY-06, decisões 87 e 94)', () => {
    let bookingId: string;
    let chargeId: string;
    let chargebackId: string;

    it('o cartão de teste contestado tira o valor do espaço, devolve a taxa e avisa a gestão', async () => {
      ({ bookingId, chargeId } = await bookAndPay(240, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_CHARGEBACK,
      }));
      expect((await bookingRow(t, bookingId)).paymentStatus).toBe('PAID');
      await drain(t, { withChargebacks: true });
      const charge = await chargeRow(t, chargeId);
      // Cartão 6% de R$ 20,00 = R$ 1,20.
      expect(charge).toMatchObject({
        status: 'CHARGEBACK',
        refundedCents: 2_000,
        feeRefundedCents: 120,
      });
      expect((await bookingRow(t, bookingId)).paymentStatus).toBe('PENDING');
      const ledger = await ledgerOf(t, space.id, chargeId);
      expect(ledger.map((e) => [e.kind, e.amountCents]).sort()).toEqual([
        ['CHARGEBACK', -2_000],
        ['FEE_REFUND', 120],
        ['PLATFORM_FEE', -120],
        ['SALE', 2_000],
      ]);
      for (const user of [owner, admin]) {
        const notes = await t.db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, user.id));
        const note = notes.find((n) => n.type === 'PAYMENT_CHARGEBACK');
        expect(note?.body).toMatch(
          /^Maria Oliveira contestou R\$\s20,00 em Espaço carteira-pg\. Responda até/,
        );
      }
      const teacherNotes = await t.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, teacher.id));
      expect(teacherNotes.map((n) => n.type)).not.toContain('PAYMENT_CHARGEBACK');
    });

    it('a contestação aparece com prazo; o espaço responde uma vez', async () => {
      const list = await t
        .http()
        .get(path('chargebacks'))
        .set(...bearer(admin))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      chargebackId = list.body.items[0].id;
      expect(list.body.items[0]).toMatchObject({
        kind: 'CHARGEBACK',
        reasonCode: 'CHARGEBACK',
        dispute: { status: 'AWAITING_RESPONSE', responseText: null },
        charge: { id: chargeId },
      });
      expect(list.body.items[0].dispute.respondBy).not.toBeNull();
      const wallet = await t
        .http()
        .get(path('wallet'))
        .set(...bearer(admin))
        .expect(200);
      expect(wallet.body.openDisputes.count).toBe(1);
      const res = await t
        .http()
        .post(path(`chargebacks/${chargebackId}/dispute`))
        .set(...bearer(admin))
        .send({
          text: 'A reserva foi usada: o cliente jogou das 18h às 19h, com testemunhas.',
          attachmentUrls: ['https://example.com/comprovante.pdf'],
        })
        .expect(201);
      expect(res.body.dispute).toMatchObject({
        status: 'RESPONDED',
        attachmentUrls: ['https://example.com/comprovante.pdf'],
      });
      const twice = await t
        .http()
        .post(path(`chargebacks/${chargebackId}/dispute`))
        .set(...bearer(admin))
        .send({ text: 'De novo, com mais detalhes da reserva.' })
        .expect(409);
      expect(twice.body.error.code).toBe('DISPUTE_CLOSED');
    });

    it('contestação ganha: o valor volta e a taxa devolvida é cobrada de novo (decisão 94)', async () => {
      await t
        .http()
        .post(`/v1/super/online-payments/simulator/charges/${chargeId}/dispute-result`)
        .set(...bearer(sup))
        .send({ outcome: 'WON' })
        .expect(200);
      await drain(t);
      const ledger = await ledgerOf(t, space.id, chargeId);
      expect(ledger.reduce((sum, e) => sum + e.amountCents, 0)).toBe(2_000 - 120);
      expect(ledger.map((e) => e.kind)).toEqual(expect.arrayContaining(['ADJUSTMENT']));
      const charge = await chargeRow(t, chargeId);
      expect(charge).toMatchObject({ status: 'CHARGEBACK', refundedCents: 0, feeRefundedCents: 0 });
      expect((await bookingRow(t, bookingId)).paymentStatus).toBe('PAID');
      const list = await t
        .http()
        .get(path('chargebacks'))
        .set(...bearer(admin))
        .expect(200);
      expect(list.body.items[0].dispute.status).toBe('WON');
      expect(list.body.items[0].dispute.resolvedAt).not.toBeNull();
    });
  });

  describe('carteira e repasse (RF-ONPAY-07)', () => {
    it('disponível, a liberar e repassado batem com o livro-razão', async () => {
      const { chargeId } = await bookAndPay(300, {
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_APPROVE,
      });
      await drain(t);
      const before = await t
        .http()
        .get(path('wallet'))
        .set(...bearer(owner))
        .expect(200);
      expect(before.body.balanceCents).toBe(await ledgerTotal(t, space.id));
      expect(before.body.pendingCents).toBeGreaterThan(0);
      expect(before.body.upcoming.length).toBeGreaterThan(0);
      expect(before.body.paidOutCents).toBe(0);
      // Liquidar no simulador libera tudo e repassa.
      await t
        .http()
        .post('/v1/super/online-payments/simulator/settle')
        .set(...bearer(sup))
        .send({ spaceId: space.id })
        .expect(200);
      await drain(t);
      const after = await t
        .http()
        .get(path('wallet'))
        .set(...bearer(owner))
        .expect(200);
      expect(after.body).toMatchObject({ availableCents: 0, pendingCents: 0, balanceCents: 0 });
      const [payout] = await t.db.select().from(payouts).where(eq(payouts.spaceId, space.id));
      expect(payout?.status).toBe('PAID');
      expect(after.body.paidOutCents).toBe(payout?.amountCents);
      expect(payout?.amountCents).toBe(before.body.balanceCents);
      const list = await t
        .http()
        .get(path('wallet/payouts'))
        .set(...bearer(owner))
        .expect(200);
      expect(list.body.items[0]).toMatchObject({
        status: 'PAID',
        amountCents: payout?.amountCents,
      });
      // Lançamentos com filtro e CSV.
      const entries = await t
        .http()
        .get(path('wallet/entries'))
        .query({ kind: ['SALE', 'PAYOUT'], limit: 2 })
        .set(...bearer(owner))
        .expect(200);
      expect(entries.body.items).toHaveLength(2);
      expect(entries.body.nextCursor).not.toBeNull();
      expect(
        entries.body.items.every((e: Row) => ['SALE', 'PAYOUT'].includes(e.kind as string)),
      ).toBe(true);
      const next = await t
        .http()
        .get(path('wallet/entries'))
        .query({ kind: ['SALE', 'PAYOUT'], limit: 2, cursor: entries.body.nextCursor })
        .set(...bearer(owner))
        .expect(200);
      expect(next.body.items[0].id).not.toBe(entries.body.items[1].id);
      // PG.2b: `total` conta os lançamentos com os filtros, em todas as páginas.
      const ledger = await ledgerOf(t, space.id);
      const salesAndPayouts = ledger.filter((e) => e.kind === 'SALE' || e.kind === 'PAYOUT');
      expect(entries.body.total).toBe(salesAndPayouts.length);
      expect(next.body.total).toBe(salesAndPayouts.length);
      const all = await t
        .http()
        .get(path('wallet/entries'))
        .query({ limit: 100 })
        .set(...bearer(owner))
        .expect(200);
      expect(all.body.total).toBe(ledger.length);
      expect(all.body.items).toHaveLength(ledger.length);
      // Filtro por meio: só os lançamentos de cobranças daquele meio (repasse não tem meio).
      const byMethod = async (method: 'PIX' | 'CARD') => {
        const res = await t
          .http()
          .get(path('wallet/entries'))
          .query({ method, limit: 100 })
          .set(...bearer(owner))
          .expect(200);
        const expected = all.body.items.filter((e: Row) => e.method === method);
        expect(expected.length).toBeGreaterThan(0);
        expect(res.body.total).toBe(expected.length);
        expect(res.body.items.map((e: Row) => e.id)).toEqual(expected.map((e: Row) => e.id));
        return res.body.total as number;
      };
      const pixTotal = await byMethod('PIX');
      const cardTotal = await byMethod('CARD');
      expect(pixTotal + cardTotal).toBe(
        all.body.items.filter((e: Row) => e.method !== null).length,
      );
      const cardSales = await t
        .http()
        .get(path('wallet/entries'))
        .query({ method: 'CARD', kind: 'SALE' })
        .set(...bearer(owner))
        .expect(200);
      expect(cardSales.body.items.every((e: Row) => e.kind === 'SALE' && e.method === 'CARD')).toBe(
        true,
      );
      await t
        .http()
        .get(path('wallet/entries'))
        .query({ method: 'BOLETO' })
        .set(...bearer(owner))
        .expect(400);
      // O CSV respeita os mesmos filtros.
      const pixCsv = await t
        .http()
        .get(path('wallet/entries.csv'))
        .query({ method: 'PIX' })
        .set(...bearer(owner))
        .expect(200);
      const pixLines = pixCsv.text.split('\r\n').slice(1).filter(Boolean);
      expect(pixLines).toHaveLength(pixTotal);
      expect(pixLines.every((line) => /,PIX,-?\d+,/.test(line))).toBe(true);
      expect(pixCsv.text).not.toContain('Repasse');
      const csv = await t
        .http()
        .get(path('wallet/entries.csv'))
        .set(...bearer(owner))
        .expect(200);
      expect(csv.text.split('\r\n')[0]).toContain('id,criado_em_utc,criado_em_local,tipo');
      expect(csv.text).toContain('Repasse');
      const sale = (await ledgerOf(t, space.id, chargeId)).find((e) => e.kind === 'SALE');
      expect(sale?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
      // O extrato separa no local × online.
      const statement = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/statement`)
        .query({ from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z', channel: 'ONLINE' })
        .set(...bearer(owner))
        .expect(200);
      expect(statement.body.byChannel.map((c: Row) => c.channel)).toEqual(['ONLINE']);
      expect(
        statement.body.items.every((i: Row) => i.channel === 'ONLINE' && i.recordedByName === null),
      ).toBe(true);
    });
  });

  describe('mensalidade paga online (RF-ONPAY-05, RN-ONPAY-04)', () => {
    it('o aluno paga a mensalidade atrasada com cartão e a assinatura sai de PAST_DUE', async () => {
      const plan = first(
        await t.db
          .insert(plans)
          .values({
            spaceId: space.id,
            sportId: space.sportId,
            name: 'Plano 1x',
            weeklyFrequency: 1,
            priceCents: 15_000,
            billingDay: 1,
          })
          .returning(),
      );
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
        new Date(),
      );
      const sub = first(
        await t.db
          .insert(subscriptions)
          .values({
            userId: student.id,
            planId: plan.id,
            spaceId: space.id,
            status: 'PAST_DUE',
            priceCents: 15_000,
            startsOn: '2020-01-01',
            currentPeriodStart: `${today.slice(0, 8)}01`,
            currentPeriodEnd: `${today.slice(0, 8)}28`,
          })
          .returning(),
      );
      const charge = first(
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
      );
      const url = `/v1/me/subscriptions/${sub.id}/charges/${charge.id}/payment`;
      // Só o aluno.
      await t
        .http()
        .post(url)
        .set(...bearer(player))
        .send({ method: 'PIX' })
        .expect(404);
      const pix = await t
        .http()
        .post(url)
        .set(...bearer(student))
        .send({ method: 'PIX' })
        .expect(201);
      expect(new Date(pix.body.expiresAt).getTime()).toBe(Date.now() + 24 * 60 * 60_000);
      const charges = await t
        .http()
        .get(`/v1/me/subscriptions/${sub.id}/charges`)
        .set(...bearer(student))
        .expect(200);
      expect(charges.body.items[0].openOnlineCharge).toMatchObject({
        id: pix.body.id,
        method: 'PIX',
      });
      const card = await t
        .http()
        .post(url)
        .set(...bearer(student))
        .send({ method: 'CARD', cardToken: CARD_APPROVE })
        .expect(201);
      expect(card.body.status).toBe('PAID');
      const [subRow] = await t.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
      expect(subRow?.status).toBe('ACTIVE');
      const [chargeRowDb] = await t.db
        .select()
        .from(subscriptionCharges)
        .where(eq(subscriptionCharges.id, charge.id));
      expect(chargeRowDb?.status).toBe('PAID');
      const [record] = await recordsOf(t, card.body.id);
      expect(record).toMatchObject({
        payableType: 'SUBSCRIPTION_CHARGE',
        channel: 'ONLINE',
        recordedBy: null,
      });
      expect((await chargeRow(t, pix.body.id)).status).toBe('CANCELLED');
      // PG.2b: os pagamentos da mensalidade trazem o canal e a cobrança, como os da reserva, nas
      // respostas do aluno e da gestão.
      const online = { method: 'CARD', channel: 'ONLINE', onlineChargeId: card.body.id };
      const mine = await t
        .http()
        .get(`/v1/me/subscriptions/${sub.id}/charges`)
        .set(...bearer(student))
        .expect(200);
      expect(mine.body.items[0].payments).toEqual([expect.objectContaining(online)]);
      const myDetail = await t
        .http()
        .get(`/v1/me/subscriptions/${sub.id}`)
        .set(...bearer(student))
        .expect(200);
      expect(myDetail.body.charges[0].payments).toEqual([expect.objectContaining(online)]);
      const staffList = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/subscription-charges`)
        .query({ subscriptionId: sub.id })
        .set(...bearer(admin))
        .expect(200);
      expect(staffList.body.items[0].payments).toEqual([expect.objectContaining(online)]);
      const staffDetail = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/subscriptions/${sub.id}`)
        .set(...bearer(owner))
        .expect(200);
      expect(staffDetail.body.charges[0].payments).toEqual([expect.objectContaining(online)]);
      const notes = await t.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, student.id));
      expect(notes.map((n) => n.type)).toContain('PAYMENT_CONFIRMED');
    });
  });

  describe('Meus pagamentos (RF-ONPAY-06)', () => {
    it('lista paginada com filtro, detalhe com estornos; só as do próprio pagador', async () => {
      const all = await t
        .http()
        .get('/v1/me/payments')
        .set(...bearer(player))
        .expect(200);
      expect(all.body.items.length).toBeGreaterThanOrEqual(3);
      expect(all.body.items[0].space).toMatchObject({ id: space.id });
      expect(all.body.items[0].item.type).toBe('BOOKING');
      const refunded = await t
        .http()
        .get('/v1/me/payments')
        .query({ status: 'REFUNDED' })
        .set(...bearer(player))
        .expect(200);
      expect(refunded.body.items.every((i: Row) => i.status === 'REFUNDED')).toBe(true);
      const id = refunded.body.items[0].id;
      const detail = await t
        .http()
        .get(`/v1/me/payments/${id}`)
        .set(...bearer(player))
        .expect(200);
      expect(detail.body.refunds).toHaveLength(4);
      expect(detail.body.transactionId).toMatch(/^ch_/);
      expect(detail.body.serverTime).toBeTruthy();
      expect(JSON.stringify(detail.body)).not.toMatch(/fee/i);
      await t
        .http()
        .get(`/v1/me/payments/${id}`)
        .set(...bearer(student))
        .expect(404);
      const page = await t
        .http()
        .get('/v1/me/payments?limit=1')
        .set(...bearer(player))
        .expect(200);
      expect(page.body.nextCursor).not.toBeNull();
    });
  });

  describe('Super: receita e relatório da NFS-e (RF-ONPAY-11, decisão 91)', () => {
    it('receita = taxa − tarifa − taxa devolvida, por espaço, meio e mês', async () => {
      const res = await t
        .http()
        .get('/v1/super/online-payments/revenue')
        .set(...bearer(sup))
        .expect(200);
      const { totals } = res.body;
      expect(totals.netRevenueCents).toBe(
        totals.grossFeeCents -
          totals.gatewayCostCents -
          totals.feeRefundedCents +
          totals.feeRechargedCents,
      );
      // A contestação ganha recobrou a taxa devolvida do cartão (R$ 1,20).
      expect(totals.feeRechargedCents).toBe(120);
      expect(res.body.bySpace[0]).toMatchObject({ spaceId: space.id });
      expect(res.body.byMethod.map((m: Row) => m.method).sort()).toEqual(['CARD', 'PIX']);
      await t
        .http()
        .get('/v1/super/online-payments/revenue')
        .set(...bearer(owner))
        .expect(403);
      const csv = await t
        .http()
        .get('/v1/super/online-payments/revenue.csv')
        .set(...bearer(sup))
        .expect(200);
      expect(csv.text).toContain('receita_liquida_centavos');
    });

    it('relatório mensal com o documento completo e a leitura auditada', async () => {
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
        .format(new Date())
        .slice(0, 7);
      const res = await t
        .http()
        .get('/v1/super/online-payments/reports/monthly')
        .query({ month })
        .set(...bearer(sup))
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        spaceId: space.id,
        documentType: 'CPF',
        document: APPROVED_CPF,
      });
      const item = res.body.items[0];
      expect(item.invoiceBaseCents).toBe(
        item.grossFeeCents - item.feeRefundedCents + item.feeRechargedCents,
      );
      const csv = await t
        .http()
        .get('/v1/super/online-payments/reports/monthly.csv')
        .query({ month })
        .set(...bearer(sup))
        .expect(200);
      expect(csv.text).toContain(APPROVED_CPF);
      const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.actorId, sup.id));
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining(['super.payment_report.view', 'super.payment_report.export_csv']),
      );
    });
  });
});

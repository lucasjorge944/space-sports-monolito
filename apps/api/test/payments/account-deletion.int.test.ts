import { addDays, myPaymentsQuerySchema, utcToZoned } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  onlineRefunds,
  plans,
  subscriptionCharges,
  subscriptions,
  users,
} from '../../src/db/schema/index.js';
import { MyPaymentsService } from '../../src/payments/my-payments.service.js';
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
  approveMerchant,
  bookingRow,
  CARD_APPROVE,
  chargeRow,
  drain,
  ledgerOf,
  recordsOf,
  setModes,
} from './fixtures.js';

// RF-AUTH-03 e RN-ONPAY-05: na exclusão da conta, o que foi pago online nas reservas futuras e nas
// mensalidades de meses ainda não começados volta inteiro (taxa devolvida ao espaço); a mensalidade
// do mês em curso fica.

useMiddayClock();

describe('exclusão de conta com pagamento online', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let player: SignedUp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'exclusao-pg');
    owner = await member(t, 'dono@exclusao.test', space.id, 'OWNER');
    player = await signUp(t, 'titular@exclusao.test', 'Titular Excluído');
    sup = await superUser(t, 'super@exclusao.test');
    await approveMerchant(t, owner, space.id);
    await setModes(t, owner, space.id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
  });

  afterAll(async () => {
    await t.close();
  });

  it('estorna as reservas futuras e o mês ainda não começado; o mês em curso fica', async () => {
    // Reserva futura paga com cartão e outra com Pix pago.
    const book = async (minutes: number, body: Record<string, unknown>) =>
      (
        await t
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
            ...body,
          })
          .expect(201)
      ).body;
    const card = await book(240, { paymentOption: 'ONLINE_CARD', cardToken: CARD_APPROVE });
    const pix = await book(360, { paymentOption: 'ONLINE_PIX' });
    await t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${pix.onlinePayment.id}/pay`)
      .set(...bearer(sup))
      .expect(200);
    // Uma terceira com Pix ainda aberto.
    const open = await book(480, { paymentOption: 'ONLINE_PIX' });
    await drain(t);

    // Mensalidades: a do mês em curso e a do mês seguinte, as duas pagas online.
    const today = utcToZoned(new Date(), 'America/Sao_Paulo').date;
    const thisMonth = `${today.slice(0, 8)}01`;
    const nextMonth = `${addDays(thisMonth, 31).slice(0, 8)}01`;
    const plan = first(
      await t.db
        .insert(plans)
        .values({
          spaceId: space.id,
          sportId: space.sportId,
          name: 'Plano 1x',
          weeklyFrequency: 1,
          priceCents: 15_000,
          billingDay: 28,
        })
        .returning(),
    );
    const sub = first(
      await t.db
        .insert(subscriptions)
        .values({
          userId: player.id,
          planId: plan.id,
          spaceId: space.id,
          status: 'ACTIVE',
          priceCents: 15_000,
          startsOn: thisMonth,
          currentPeriodStart: thisMonth,
          currentPeriodEnd: `${today.slice(0, 8)}28`,
        })
        .returning(),
    );
    const [current, upcoming] = await t.db
      .insert(subscriptionCharges)
      .values([
        {
          subscriptionId: sub.id,
          periodStart: thisMonth,
          periodEnd: `${today.slice(0, 8)}28`,
          dueDate: `${today.slice(0, 8)}28`,
          amountCents: 15_000,
        },
        {
          subscriptionId: sub.id,
          periodStart: nextMonth,
          periodEnd: `${nextMonth.slice(0, 8)}28`,
          dueDate: `${nextMonth.slice(0, 8)}28`,
          amountCents: 15_000,
        },
      ])
      .returning();
    if (!current || !upcoming) throw new Error('Mensalidades não criadas.');
    const payCharge = async (chargeId: string) =>
      (
        await t
          .http()
          .post(`/v1/me/subscriptions/${sub.id}/charges/${chargeId}/payment`)
          .set(...bearer(player))
          .send({ method: 'CARD', cardToken: CARD_APPROVE })
          .expect(201)
      ).body.id as string;
    const currentCharge = await payCharge(current.id);
    const upcomingCharge = await payCharge(upcoming.id);
    await drain(t);

    // O titular pede a exclusão e o Super confirma.
    const request = await t
      .http()
      .post('/v1/me/deletion-request')
      .set(...bearer(player))
      .send({ password: PASSWORD })
      .expect(201);
    await t
      .http()
      .post(`/v1/super/deletion-requests/${request.body.requestId}/fulfill`)
      .set(...bearer(sup))
      .send({})
      .expect(200);
    await drain(t);

    // Reservas futuras: canceladas e estornadas inteiras, com a taxa devolvida ao espaço.
    for (const booking of [card, pix]) {
      expect((await bookingRow(t, booking.id)).status).toBe('CANCELLED');
      const charge = await chargeRow(t, booking.onlinePayment.id);
      expect(charge.status).toBe('REFUNDED');
      expect(charge.refundedCents).toBe(charge.amountCents);
      expect(charge.feeRefundedCents).toBe(charge.platformFeeCents);
      const [refund] = await t.db
        .select()
        .from(onlineRefunds)
        .where(eq(onlineRefunds.chargeId, charge.id));
      expect(refund).toMatchObject({
        reasonCode: 'ACCOUNT_DELETED',
        requestedBy: null,
        chargeAgain: false,
        itemDiscountCents: 0,
        status: 'SUCCEEDED',
      });
      const [record] = await recordsOf(t, charge.id);
      expect(record?.reversedAt).not.toBeNull();
      const net = (await ledgerOf(t, space.id, charge.id)).reduce((s, e) => s + e.amountCents, 0);
      expect(net).toBe(0);
    }
    // O Pix aberto fecha.
    expect(await chargeRow(t, open.onlinePayment.id)).toMatchObject({
      status: 'CANCELLED',
      closedReason: 'ACCOUNT_DELETED',
    });

    // Mês seguinte: estornado e dispensado. Mês em curso: pago e não estornado.
    expect((await chargeRow(t, upcomingCharge)).status).toBe('REFUNDED');
    const [upcomingRow] = await t.db
      .select()
      .from(subscriptionCharges)
      .where(eq(subscriptionCharges.id, upcoming.id));
    expect(upcomingRow).toMatchObject({ status: 'WAIVED' });
    expect(upcomingRow?.waiveReason).toBe('Conta excluída a pedido do titular');
    expect((await chargeRow(t, currentCharge)).status).toBe('PAID');
    const [currentRecord] = await recordsOf(t, currentCharge);
    expect(currentRecord?.reversedAt).toBeNull();
    const [currentRow] = await t.db
      .select()
      .from(subscriptionCharges)
      .where(eq(subscriptionCharges.id, current.id));
    expect(currentRow?.status).toBe('PAID');

    // A conta está anonimizada; os estornos ficam auditados.
    const [user] = await t.db.select().from(users).where(eq(users.id, player.id));
    expect(user?.email).toBeNull();
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'payment.online.auto_refund'));
    expect(
      audits.filter((a) => (a.diff as { reasonCode?: string }).reasonCode === 'ACCOUNT_DELETED'),
    ).toHaveLength(3);
    // O comprovante continua na conta (anonimizada) do pagador, pelo gateway.
    expect((await chargeRow(t, upcomingCharge)).payerUserId).toBe(player.id);
    // PG.4: Meus pagamentos do titular (lista e detalhe) trazem os estornos com o motivo.
    const myPayments = t.app.get(MyPaymentsService);
    const page = await myPayments.list(player.id, myPaymentsQuerySchema.parse({ limit: 50 }));
    for (const id of [card.onlinePayment.id, pix.onlinePayment.id, upcomingCharge]) {
      const item = page.items.find((i) => i.id === id);
      expect(item?.refunds.map((r) => r.reasonCode)).toEqual(['ACCOUNT_DELETED']);
    }
    expect(page.items.find((i) => i.id === currentCharge)?.refunds).toEqual([]);
    const detail = await myPayments.get(player.id, upcomingCharge);
    expect(detail.refunds).toEqual([
      expect.objectContaining({ reasonCode: 'ACCOUNT_DELETED', status: 'SUCCEEDED' }),
    ]);
  });
});

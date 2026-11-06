import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  paymentRecords,
  recurringBookingCharges,
  recurringBookings,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  currentSlot,
  member,
  type Space,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { slotWeekday, today } from './fixtures.js';

// Decisão 27 (RF-BOOK-05, RN-BOOK-08): o mensalista não tem cobrança na plataforma. As
// mensalidades e os pagamentos antigos ficam no banco e no extrato, mas nada novo é cobrado.

useMiddayClock();

describe('mensalista sem cobrança: mensalidades e pagamentos antigos', () => {
  let t: TestApp;
  let space: Space;
  let admin: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-mensalidade-legada');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
  });
  afterAll(() => t.close());

  const manage = (path: string) => `/v1/manage/spaces/${space.id}/${path}`;

  /** Mensalista com uma mensalidade antiga paga (como ficaram os dados de antes da decisão 27). */
  async function legacyCharge(
    status: 'PENDING' | 'PAID' | 'WAIVED' = 'PAID',
    dueDate: string = today(),
  ) {
    const recurring = first(
      await t.db
        .insert(recurringBookings)
        .values({
          spaceId: space.id,
          courtId: space.courtA,
          sportId: space.sportId,
          guestName: 'Mensalista Antigo',
          guestPhone: '+5531988887777',
          weekday: slotWeekday(),
          startTime: '06:00',
          durationMin: 60,
          peopleCount: 4,
          startsOn: today(),
          status: 'ACTIVE',
        })
        .returning(),
    );
    const charge = first(
      await t.db
        .insert(recurringBookingCharges)
        .values({
          recurringBookingId: recurring.id,
          periodStart: `${today().slice(0, 8)}01`,
          periodEnd: `${today().slice(0, 8)}28`,
          dueDate,
          amountCents: 20_000,
          status,
        })
        .returning(),
    );
    const payment = first(
      await t.db
        .insert(paymentRecords)
        .values({
          spaceId: space.id,
          payableType: 'RECURRING_BOOKING_CHARGE',
          payableId: charge.id,
          amountCents: 20_000,
          method: 'PIX',
          paidAt: new Date(),
          recordedBy: admin.id,
        })
        .returning(),
    );
    return { recurring, charge, payment };
  }

  it('não aceita registrar pagamento novo de mensalidade (400)', async () => {
    const { charge } = await legacyCharge('PENDING');
    const res = await t
      .http()
      .post(manage('payments'))
      .set(...bearer(admin))
      .send({
        payableType: 'RECURRING_BOOKING_CHARGE',
        payableId: charge.id,
        amountCents: 1_000,
        method: 'PIX',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const payments = await t.db
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.payableId, charge.id));
    expect(payments).toHaveLength(1);
  });

  it('o pagamento antigo segue no extrato e ainda pode ser estornado (auditado)', async () => {
    const { charge, payment } = await legacyCharge();
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const statement = await t
      .http()
      .get(manage('statement'))
      .query({ from, to, service: 'RECURRING' })
      .set(...bearer(admin))
      .expect(200);
    expect(statement.body.items).toContainEqual(
      expect.objectContaining({
        id: payment.id,
        service: 'RECURRING',
        payableType: 'RECURRING_BOOKING_CHARGE',
        amountCents: 20_000,
      }),
    );

    const res = await t
      .http()
      .post(manage(`payments/${payment.id}/reverse`))
      .set(...bearer(admin))
      .send({ reason: 'Lançado por engano' })
      .expect(200);
    expect(res.body.reversedAt).not.toBeNull();
    const again = await t
      .http()
      .post(manage(`payments/${payment.id}/reverse`))
      .set(...bearer(admin))
      .send({})
      .expect(409);
    expect(again.body.error.code).toBe('PAYMENT_ALREADY_REVERSED');
    const [log] = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, payment.id), eq(auditLogs.action, 'payment.reverse')));
    expect(log).toBeDefined();
    // A mensalidade antiga não é apagada; o status volta a refletir o que segue pago.
    expect(await chargeRow(charge.id)).toMatchObject({ status: 'PENDING', amountCents: 20_000 });
  });

  const chargeRow = async (id: string) =>
    first(
      await t.db.select().from(recurringBookingCharges).where(eq(recurringBookingCharges.id, id)),
    );

  const reverse = (paymentId: string) =>
    t
      .http()
      .post(manage(`payments/${paymentId}/reverse`))
      .set(...bearer(admin))
      .send({})
      .expect(200);

  it('estorno de mensalidade vencida a deixa em atraso; a dispensada não muda', async () => {
    const overdue = await legacyCharge('PAID', '2020-01-10');
    await reverse(overdue.payment.id);
    expect((await chargeRow(overdue.charge.id)).status).toBe('OVERDUE');

    const waived = await legacyCharge('WAIVED');
    await reverse(waived.payment.id);
    expect((await chargeRow(waived.charge.id)).status).toBe('WAIVED');
  });

  it('"a receber hoje" só traz reservas: a mensalidade antiga que vence hoje não entra', async () => {
    await legacyCharge('PENDING');
    const desk = await t
      .http()
      .post(manage('bookings'))
      .set(...bearer(admin))
      .send({
        courtId: space.courtB,
        sportId: space.sportId,
        startsAt: currentSlot().toISOString(),
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Avulso',
        guestPhone: '+5531977776666',
      })
      .expect(201);
    const res = await t
      .http()
      .get(manage('receivables/today'))
      .set(...bearer(admin))
      .expect(200);
    expect(res.body).not.toHaveProperty('recurringCharges');
    expect(res.body.items).toEqual([
      expect.objectContaining({ booking: expect.objectContaining({ id: desk.body.id }) }),
    ]);
    expect(res.body.totalDueCents).toBe(res.body.items[0].dueCents);
  });

  it('o detalhe do mensalista não traz mensalidades', async () => {
    const { recurring } = await legacyCharge();
    const res = await t
      .http()
      .get(manage(`recurring-bookings/${recurring.id}`))
      .set(...bearer(admin))
      .expect(200);
    expect(res.body).not.toHaveProperty('charges');
    expect(res.body).not.toHaveProperty('monthlyPriceCents');
  });
});

import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type PaymentRecord,
  type ReceivablesToday,
  type RecordPaymentInput,
  type ReversePaymentInput,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  assertChargePayable,
  recordChargePayment,
  reverseChargePayment,
} from '../classes/subscription-billing.js';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  paymentRecords,
  recurringBookingCharges,
  recurringBookings,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { OnlineChargesService } from '../payments/online-charges.service.js';
import {
  bookingDue,
  insertBookingPayment,
  isBookingPayable,
  PAYABLE_STATUSES,
  refreshBookingPaymentStatus,
} from './booking-payments.js';
import { BookingViews, toPaymentRecord } from './booking-views.js';
import {
  bookingNotPayable,
  onlinePaymentNeedsRefund,
  payableNotFound,
  paymentAlreadyReversed,
  paymentExceedsDue,
  paymentNotFound,
} from './bookings.errors.js';
import { audit, type Tx } from './db-utils.js';
import { SpaceContextService } from './space-context.js';

type BookingRow = typeof bookings.$inferSelect;

/**
 * Registro de pagamentos feitos no espaço (RF-PAY-01, RF-BOOK-08, RN-PAY-01): sem gateway; só
 * a gestão (Dono, Admin) registra e estorna, tudo auditado. O recebimento é da reserva inteira
 * (decisão 50), e o status de pagamento dela é recalculado a cada registro/estorno, com a reserva
 * travada. Registros antigos não têm mais registro novo, mas seguem valendo: os por parte
 * (`BOOKING_PARTICIPANT`) contam no total pago da reserva, e eles e os de mensalidade do mensalista
 * (`RECURRING_BOOKING_CHARGE`, decisão 27) aparecem no extrato e podem ser estornados. A
 * mensalidade de aula (`SUBSCRIPTION_CHARGE`, RF-CLASS-11) usa as regras de
 * `classes/subscription-billing.ts`.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
    private readonly views: BookingViews,
    private readonly online: OnlineChargesService,
  ) {}

  /**
   * Decisão 96: em `PENDING_PAYMENT` não há registro manual (o cliente está pagando pelo app); com
   * cobrança online aberta, ela é cancelada no gateway antes, e se acabou de ser paga o registro é
   * recusado (409 `ONLINE_CHARGE_ALREADY_PAID`).
   */
  async record(
    spaceId: string,
    actorId: string,
    input: RecordPaymentInput,
  ): Promise<PaymentRecord> {
    // Status e valor conferidos antes de qualquer efeito no gateway (a transação confere de novo).
    await this.db.transaction(async (tx) => {
      if (input.payableType === 'BOOKING') {
        const [booking] = await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, input.payableId), eq(bookings.spaceId, spaceId)));
        if (!booking) throw payableNotFound();
        if (!isBookingPayable(booking.status)) throw bookingNotPayable(booking.status);
        const due = await bookingDue(tx, booking);
        if (input.amountCents > due) throw paymentExceedsDue(due);
        return;
      }
      await assertChargePayable(tx, spaceId, input.payableId, input.amountCents);
    });
    await this.online.beforeManualPayment(spaceId, input.payableType, input.payableId);
    return this.db.transaction(async (tx) => {
      if (input.payableType === 'SUBSCRIPTION_CHARGE') {
        return recordChargePayment(tx, spaceId, actorId, input);
      }
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, input.payableId), eq(bookings.spaceId, spaceId)))
        .for('update');
      if (!booking) throw payableNotFound();
      const record = await insertBookingPayment(tx, spaceId, booking, {
        amountCents: input.amountCents,
        method: input.method,
        paidAt: input.paidAt ?? new Date(),
        note: input.note ?? null,
        recordedBy: actorId,
        channel: 'ON_SITE',
        onlineChargeId: null,
      });
      return toPaymentRecord(record);
    });
  }

  async reverse(
    spaceId: string,
    actorId: string,
    paymentId: string,
    input: ReversePaymentInput,
  ): Promise<PaymentRecord> {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(paymentRecords)
        .where(
          and(
            eq(paymentRecords.id, paymentId),
            eq(paymentRecords.spaceId, spaceId),
            inArray(paymentRecords.payableType, [
              'BOOKING',
              'BOOKING_PARTICIPANT',
              'RECURRING_BOOKING_CHARGE',
              'SUBSCRIPTION_CHARGE',
            ]),
          ),
        );
      if (!found) throw paymentNotFound();
      // O pagamento online só sai pelo estorno no gateway (RN-ONPAY-05), que ajusta o registro.
      if (found.channel === 'ONLINE') throw onlinePaymentNeedsRefund();
      if (found.payableType === 'SUBSCRIPTION_CHARGE') {
        return reverseChargePayment(tx, spaceId, actorId, found, input);
      }
      const booking = await this.lockBookingOf(tx, found);
      // Relido depois da trava da reserva: dois estornos simultâneos não passam os dois.
      const [record] = await tx
        .select()
        .from(paymentRecords)
        .where(eq(paymentRecords.id, paymentId))
        .for('update');
      if (!record) throw paymentNotFound();
      if (record.reversedAt) throw paymentAlreadyReversed();

      const [reversed] = await tx
        .update(paymentRecords)
        .set({ reversedAt: new Date(), reversedBy: actorId })
        .where(eq(paymentRecords.id, record.id))
        .returning();
      if (!reversed) throw paymentNotFound();
      if (booking) await refreshBookingPaymentStatus(tx, booking);
      if (record.payableType === 'RECURRING_BOOKING_CHARGE') {
        await this.refreshChargeStatus(tx, spaceId, record.payableId);
      }
      await audit(tx, {
        actorId,
        spaceId,
        action: 'payment.reverse',
        entity: 'payment_record',
        entityId: record.id,
        diff: {
          bookingId: booking?.id ?? null,
          amountCents: record.amountCents,
          method: record.method,
          reason: input.reason ?? null,
        },
      });
      return toPaymentRecord(reversed);
    });
  }

  /** RF-PAY-03: reservas de hoje (fuso do espaço) com pagamento em aberto. */
  async receivablesToday(spaceId: string): Promise<ReceivablesToday> {
    const space = await this.spaces.load(spaceId);
    const today = utcToZoned(new Date(), space.timeZone).date;
    const start = zonedToUtc(today, 0, space.timeZone);
    const end = zonedToUtc(addDays(today, 1), 0, space.timeZone);
    const items = await this.views.list(
      and(
        eq(bookings.spaceId, spaceId),
        gte(bookings.startsAt, start),
        lt(bookings.startsAt, end),
        inArray(bookings.status, [...PAYABLE_STATUSES]),
        ne(bookings.paymentStatus, 'PAID'),
        sql`${bookings.priceCents} > 0`,
      ),
      [asc(bookings.startsAt), asc(bookings.id)],
      500,
      { staff: true },
    );
    const receivables = items.map((booking) => ({
      booking,
      dueCents: Math.max(booking.priceCents - booking.discountCents - booking.paidCents, 0),
    }));
    return {
      date: today,
      timeZone: space.timeZone,
      totalDueCents: receivables.reduce((sum, r) => sum + r.dueCents, 0),
      items: receivables,
    };
  }

  private async lockBookingOf(
    tx: Tx,
    record: typeof paymentRecords.$inferSelect,
  ): Promise<BookingRow | undefined> {
    // Pagamento antigo de mensalidade: não há reserva para recalcular.
    if (record.payableType === 'RECURRING_BOOKING_CHARGE') return undefined;
    let bookingId = record.payableId;
    if (record.payableType === 'BOOKING_PARTICIPANT') {
      const [participant] = await tx
        .select({ bookingId: bookingParticipants.bookingId })
        .from(bookingParticipants)
        .where(eq(bookingParticipants.id, record.payableId));
      // A parte pode ter sido removida (convite desfeito); o estorno vale mesmo assim.
      if (!participant) return undefined;
      bookingId = participant.bookingId;
    }
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');
    return booking;
  }

  /**
   * Mensalidade antiga (decisão 27): o estorno recalcula o status pelo que segue pago, como era
   * no registro. Mensalidade dispensada (`WAIVED`) não muda.
   */
  private async refreshChargeStatus(tx: Tx, spaceId: string, chargeId: string): Promise<void> {
    const [charge] = await tx
      .select({
        id: recurringBookingCharges.id,
        status: recurringBookingCharges.status,
        amountCents: recurringBookingCharges.amountCents,
        dueDate: recurringBookingCharges.dueDate,
      })
      .from(recurringBookingCharges)
      .innerJoin(
        recurringBookings,
        eq(recurringBookings.id, recurringBookingCharges.recurringBookingId),
      )
      .where(and(eq(recurringBookingCharges.id, chargeId), eq(recurringBookings.spaceId, spaceId)))
      .for('update', { of: recurringBookingCharges });
    if (!charge || charge.status === 'WAIVED') return;
    const [paid] = await tx
      .select({ amount: sql<number>`coalesce(sum(${paymentRecords.amountCents}), 0)::int` })
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.payableType, 'RECURRING_BOOKING_CHARGE'),
          eq(paymentRecords.payableId, charge.id),
          isNull(paymentRecords.reversedAt),
        ),
      );
    const space = await this.spaces.load(spaceId, tx);
    const today = utcToZoned(new Date(), space.timeZone).date;
    const status =
      (paid?.amount ?? 0) >= charge.amountCents
        ? 'PAID'
        : charge.dueDate < today
          ? 'OVERDUE'
          : 'PENDING';
    if (status !== charge.status) {
      await tx
        .update(recurringBookingCharges)
        .set({ status })
        .where(eq(recurringBookingCharges.id, charge.id));
    }
  }
}

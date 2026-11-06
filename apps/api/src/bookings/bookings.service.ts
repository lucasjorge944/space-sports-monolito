import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  addMinutes,
  BOOKING_ONLINE_PAYMENT_MIN_LEAD_MIN,
  BOOKING_PAYMENT_ABANDONED_REASON,
  BOOKING_PAYMENT_HOLD_MIN,
  type BookingDetail,
  type BookingPage,
  type CancelBookingInput,
  type CreateBookingInput,
  type CreateDeskBookingInput,
  calculateBookingPriceCents,
  checkBookingTime,
  type MyBookingsQuery,
  type PlayerBookingDetail,
  type PlayerBookingPage,
  playerCancellationDeadline,
  type SpaceBookingPage,
  type SpaceBookingsQuery,
  splitBookingPrice,
  type UpdateBookingInput,
} from '@space-sports/shared';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { captureContact } from '../contacts/contact-store.js';
import type { Database } from '../db/client.js';
import { bookingParticipants, bookings, courtOccupations, users } from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { assertSameRequest, requestHash } from '../payments/idempotency-key.js';
import { OnlineChargesService } from '../payments/online-charges.service.js';
import { PaymentSettingsService } from '../payments/payment-settings.service.js';
import {
  bookingTooSoonForOnlinePayment,
  onlinePaymentRequired,
  onlinePaymentUnavailable,
} from '../payments/payments.errors.js';
import { BookingViews, toPlayerBooking, withoutMoney } from './booking-views.js';
import {
  bookingEditBlocked,
  bookingNotFound,
  bookingNotStarted,
  bookingTimeInvalid,
  cancellationDeadlinePassed,
  invalidBookingStatus,
  peopleBelowParticipants,
  slotUnavailable,
} from './bookings.errors.js';
import { findCustomerUserId } from './customers.js';
import {
  assertSpaceWritable,
  audit,
  type DbOrTx,
  decodeCursor,
  encodeCursor,
  isSlotConflict,
  isUniqueViolation,
  type Tx,
} from './db-utils.js';
import { type BookableSpace, type SpaceContext, SpaceContextService } from './space-context.js';

type BookingRow = typeof bookings.$inferSelect;

/** Reservas avulsas e de balcão: criação, cancelamento, conclusão, no-show e listagens. */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
    private readonly views: BookingViews,
    private readonly events: DomainEvents,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly online: OnlineChargesService,
  ) {}

  /**
   * RF-BOOK-01, RN-BOOK-01..07; RF-ONPAY-03, RN-ONPAY-02: reserva do jogador. No modo
   * `ONLINE_REQUIRED` nasce `PENDING_PAYMENT` e segura o horário por 15 min; nos demais, confirmada
   * na hora. Com Pix ou cartão, a cobrança nasce junto (cartão recusado não desfaz a reserva: a
   * nova tentativa vai para a cobrança dela). A mesma `Idempotency-Key` devolve a reserva já criada
   * (decisão 96).
   */
  async createForPlayer(
    userId: string,
    input: CreateBookingInput,
    idempotencyKey?: string,
  ): Promise<PlayerBookingDetail> {
    // O mesmo pedido com a mesma chave devolve a reserva; outro pedido com ela é recusado (o token
    // do cartão fica de fora: cada tokenização do mesmo cartão gera outro).
    const hash = idempotencyKey
      ? requestHash('booking.create', {
          spaceId: input.spaceId,
          courtId: input.courtId,
          sportId: input.sportId,
          startsAt: input.startsAt.toISOString(),
          durationMin: input.durationMin,
          peopleCount: input.peopleCount,
          intendedPaymentMethod: input.intendedPaymentMethod,
          paymentOption: input.paymentOption ?? 'ON_SITE',
        })
      : undefined;
    if (idempotencyKey) {
      const existing = await this.byIdempotencyKey(userId, idempotencyKey, hash);
      if (existing) return this.playerDetail(existing, userId);
    }
    const space = await this.spaces.loadBookable(input.spaceId);
    await this.spaces.court(space.id, input.courtId, input.sportId, input.peopleCount);
    this.assertTime(space, input.startsAt, input.durationMin, 'PLAYER');

    const option = input.paymentOption ?? 'ON_SITE';
    const price = calculateBookingPriceCents(space.pricePerHourCents, input.durationMin);
    const settings = await this.paymentSettings.effective(space.id);
    // Reserva gratuita não tem o que pagar online.
    const mode = price === 0 ? 'ON_SITE' : settings.effectiveBookingMode;
    if (mode === 'ONLINE_REQUIRED' && option === 'ON_SITE') throw onlinePaymentRequired();
    if (mode === 'ON_SITE' && option !== 'ON_SITE') throw onlinePaymentUnavailable();
    const pending = mode === 'ONLINE_REQUIRED';
    const now = new Date();
    // RN-ONPAY-02: o horário fica guardado até o início, no máximo 15 min; começando em menos de
    // 5 min, não dá tempo de pagar antes.
    if (
      pending &&
      input.startsAt.getTime() - now.getTime() < BOOKING_ONLINE_PAYMENT_MIN_LEAD_MIN * 60_000
    ) {
      throw bookingTooSoonForOnlinePayment(BOOKING_ONLINE_PAYMENT_MIN_LEAD_MIN);
    }

    // RN-ONPAY-02: um hold vencido ainda não varrido pelo job não pode tirar o horário de ninguém.
    await this.online.expireHolds(now, { spaceId: space.id });
    let id: string;
    try {
      id = await this.insert(space, {
        ...input,
        intendedPaymentMethod:
          option === 'ONLINE_PIX'
            ? 'PIX'
            : option === 'ONLINE_CARD'
              ? 'CARD'
              : input.intendedPaymentMethod,
        organizerUserId: userId,
        guestName: null,
        guestPhone: null,
        source: 'APP',
        status: pending ? 'PENDING_PAYMENT' : 'CONFIRMED',
        paymentDueAt: pending
          ? new Date(
              Math.min(
                input.startsAt.getTime(),
                addMinutes(now, BOOKING_PAYMENT_HOLD_MIN).getTime(),
              ),
            )
          : null,
        idempotencyKey: idempotencyKey ?? null,
        idempotencyRequestHash: hash ?? null,
      });
    } catch (err) {
      if (idempotencyKey && isUniqueViolation(err, 'bookings_organizer_idempotency_key_unique')) {
        const existing = await this.byIdempotencyKey(userId, idempotencyKey, hash);
        if (existing) return this.playerDetail(existing, userId);
      }
      throw err;
    }
    if (!pending) await this.events.publish({ type: 'booking.confirmed', bookingId: id });
    if (option !== 'ON_SITE') {
      try {
        await this.online.payBooking(
          userId,
          id,
          {
            method: option === 'ONLINE_PIX' ? 'PIX' : 'CARD',
            ...(input.cardToken ? { cardToken: input.cardToken } : {}),
          },
          { requestKey: idempotencyKey ? `booking:${idempotencyKey}` : undefined },
        );
      } catch (err) {
        // A reserva fica (aguardando pagamento ou confirmada): o app tenta de novo na cobrança dela.
        this.logger.warn({ err, bookingId: id }, 'Cobrança online não criada junto da reserva');
      }
    }
    return this.playerDetail(id, userId);
  }

  private async byIdempotencyKey(
    userId: string,
    key: string,
    hash: string | undefined,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: bookings.id, hash: bookings.idempotencyRequestHash })
      .from(bookings)
      .where(and(eq(bookings.organizerUserId, userId), eq(bookings.idempotencyKey, key)));
    if (row) assertSameRequest(row.hash, hash);
    return row?.id;
  }

  /** RF-BOOK-06: reserva de balcão (cliente com app ou só nome + telefone). */
  async createAtDesk(
    spaceId: string,
    actorId: string,
    input: CreateDeskBookingInput,
  ): Promise<BookingDetail> {
    const space = await this.spaces.loadBookable(spaceId);
    await this.spaces.court(space.id, input.courtId, input.sportId, input.peopleCount);
    this.assertTime(space, input.startsAt, input.durationMin, 'STAFF');

    const organizerUserId = await findCustomerUserId(this.db, input);

    const id = await this.insert(
      space,
      {
        ...input,
        organizerUserId,
        guestName: input.guestName ?? null,
        guestPhone: input.guestPhone ?? null,
        source: 'DESK',
      },
      async (tx, booking) => {
        await audit(tx, {
          actorId,
          spaceId,
          action: 'booking.desk_create',
          entity: 'booking',
          entityId: booking.id,
          diff: {
            courtId: booking.courtId,
            startsAt: booking.startsAt.toISOString(),
            durationMin: booking.durationMin,
            priceCents: booking.priceCents,
            organizerUserId: booking.organizerUserId,
            guestName: booking.guestName,
          },
        });
        if (input.guestPhone) {
          await captureContact(
            tx,
            { name: input.guestName, phone: input.guestPhone },
            { origin: 'DESK_BOOKING', spaceId, bookingId: booking.id, capturedBy: actorId },
          );
        }
      },
    );
    await this.events.publish({ type: 'booking.confirmed', bookingId: id });
    return this.staffDetail(eq(bookings.id, id));
  }

  private assertTime(
    space: SpaceContext,
    startsAt: Date,
    durationMin: number,
    actor: 'PLAYER' | 'STAFF',
  ): void {
    const violation = checkBookingTime({
      startsAt,
      durationMin,
      openingHours: space.openingHours,
      timeZone: space.timeZone,
      rules: space.rules,
      now: new Date(),
      actor,
    });
    if (violation) {
      throw bookingTimeInvalid(violation, {
        minDurationMin: space.rules.minDurationMin,
        maxDurationMin: space.rules.maxDurationMin,
        minAdvanceMin: space.rules.minAdvanceMin,
        windowDays: space.rules.windowDays,
      });
    }
  }

  /**
   * Insere a reserva e a ocupação na mesma transação. A constraint de exclusão de
   * court_occupations é quem garante que não há dupla reserva (RN-BOOK-03).
   */
  private async insert(
    space: BookableSpace,
    input: {
      courtId: string;
      sportId: string;
      startsAt: Date;
      durationMin: number;
      peopleCount: number;
      intendedPaymentMethod?: BookingRow['intendedPaymentMethod'] | undefined;
      organizerUserId: string | null;
      guestName: string | null;
      guestPhone: string | null;
      source: 'APP' | 'DESK';
      status?: 'CONFIRMED' | 'PENDING_PAYMENT';
      paymentDueAt?: Date | null;
      idempotencyKey?: string | null;
      idempotencyRequestHash?: string | null;
    },
    after?: (tx: Tx, booking: BookingRow) => Promise<void>,
  ): Promise<string> {
    const endsAt = addMinutes(input.startsAt, input.durationMin);
    const priceCents = calculateBookingPriceCents(space.pricePerHourCents, input.durationMin);
    try {
      return await this.db.transaction(async (tx) => {
        const [booking] = await tx
          .insert(bookings)
          .values({
            spaceId: space.id,
            courtId: input.courtId,
            organizerUserId: input.organizerUserId,
            guestName: input.guestName,
            guestPhone: input.guestPhone,
            sportId: input.sportId,
            startsAt: input.startsAt,
            endsAt,
            durationMin: input.durationMin,
            peopleCount: input.peopleCount,
            pricePerHourCents: space.pricePerHourCents,
            priceCents,
            status: input.status ?? 'CONFIRMED',
            paymentStatus: priceCents === 0 ? 'PAID' : 'PENDING',
            intendedPaymentMethod: input.intendedPaymentMethod ?? null,
            source: input.source,
            paymentDueAt: input.paymentDueAt ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            idempotencyRequestHash: input.idempotencyRequestHash ?? null,
          })
          .returning();
        if (!booking) throw new Error('Insert de reserva sem retorno.');
        await tx.insert(courtOccupations).values({
          courtId: input.courtId,
          period: { start: input.startsAt, end: endsAt },
          kind: 'BOOKING',
          refId: booking.id,
        });
        await after?.(tx, booking);
        return booking.id;
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotUnavailable();
      throw err;
    }
  }

  /**
   * RN-BOOK-10 a RN-BOOK-13: o organizador edita pessoas, data, horário e duração, na mesma quadra.
   * A trava na reserva serializa com convites e pagamentos. A garantia contra dupla reserva segue
   * na constraint de exclusão (RN-BOOK-03): a ocupação muda na mesma transação e a própria linha
   * não conflita consigo. Só conta o que mudou: reenviar os valores atuais é inofensivo.
   */
  async updateByPlayer(
    userId: string,
    bookingId: string,
    input: UpdateBookingInput,
  ): Promise<PlayerBookingDetail> {
    const where = and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId));
    // Validação antes de qualquer efeito no gateway. Mudança de data, horário ou duração com Pix
    // aberto: a cobrança é cancelada lá antes (decisão 96); se ela acabou de ser paga, o pagamento
    // entra e a edição é barrada ("fale com o espaço").
    const precheck = await this.db.transaction(async (tx) => {
      const [booking] = await tx.select().from(bookings).where(where);
      if (!booking) throw bookingNotFound();
      return this.checkEdit(tx, booking, input, userId);
    });
    if (precheck?.scheduleChanged) {
      await this.online.settleBookingCharges(bookingId, 'BOOKING_CHANGED');
    }
    let updated = false;
    let afterCommit: (() => Promise<void>) | undefined;
    try {
      await this.db.transaction(async (tx) => {
        const booking = await this.lock(tx, where);
        const edit = await this.checkEdit(tx, booking, input, userId);
        if (!edit) return;
        await this.applyEdit(tx, booking, edit.next, userId);
        // O preço mudou: uma cobrança aberta que tenha sobrado perde o valor (RN-ONPAY-03).
        if (edit.scheduleChanged) {
          afterCommit = await this.online.cancelOpenCharges(tx, 'BOOKING', booking.id);
        }
        updated = true;
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotUnavailable();
      throw err;
    }
    await afterCommit?.();
    if (updated)
      await this.events.publish({ type: 'booking.updated', bookingId, updatedBy: userId });
    return this.playerDetail(bookingId, userId);
  }

  /** RN-BOOK-10 a RN-BOOK-13: o que a edição muda e se ela vale; nulo quando nada muda. */
  private async checkEdit(tx: Tx, booking: BookingRow, input: UpdateBookingInput, userId: string) {
    if (booking.status !== 'CONFIRMED') throw invalidBookingStatus(booking.status);
    await assertSpaceWritable(tx, booking.spaceId);
    const next = {
      peopleCount: input.peopleCount ?? booking.peopleCount,
      startsAt: input.startsAt ?? booking.startsAt,
      durationMin: input.durationMin ?? booking.durationMin,
    };
    const peopleChanged = next.peopleCount !== booking.peopleCount;
    const scheduleChanged =
      next.startsAt.getTime() !== booking.startsAt.getTime() ||
      next.durationMin !== booking.durationMin;
    if (!peopleChanged && !scheduleChanged) return null;

    const view = await this.views.one(eq(bookings.id, booking.id), { staff: false }, tx);
    if (!view) throw bookingNotFound();
    const blocks = await this.views.editBlocks(view, userId, tx);
    if (peopleChanged && blocks.people) throw bookingEditBlocked(blocks.people);
    if (scheduleChanged && blocks.schedule) throw bookingEditBlocked(blocks.schedule);

    if (peopleChanged) {
      await this.spaces.court(
        booking.spaceId,
        booking.courtId,
        booking.sportId,
        next.peopleCount,
        tx,
      );
      await this.assertFitsGuests(tx, booking, next.peopleCount);
    }
    if (scheduleChanged) {
      const space = await this.spaces.load(booking.spaceId, tx);
      this.assertTime(space, next.startsAt, next.durationMin, 'PLAYER');
    }
    return { next, peopleChanged, scheduleChanged };
  }

  /** RN-BOOK-11: cabem o organizador e os convidados que não recusaram (a reserva está travada). */
  private async assertFitsGuests(tx: Tx, booking: BookingRow, peopleCount: number): Promise<void> {
    const participants = await tx
      .select({ userId: bookingParticipants.userId, status: bookingParticipants.status })
      .from(bookingParticipants)
      .where(eq(bookingParticipants.bookingId, booking.id));
    const guests = participants.filter(
      (p) => p.userId !== booking.organizerUserId && p.status !== 'DECLINED',
    );
    if (peopleCount < 1 + guests.length) throw peopleBelowParticipants(1 + guests.length);
  }

  /** RN-BOOK-13: grava a edição com preço, partes, ocupação e lembrete coerentes, e audita. */
  private async applyEdit(
    tx: Tx,
    booking: BookingRow,
    next: { peopleCount: number; startsAt: Date; durationMin: number },
    actorId: string,
  ): Promise<void> {
    const endsAt = addMinutes(next.startsAt, next.durationMin);
    const priceCents = calculateBookingPriceCents(booking.pricePerHourCents, next.durationMin);
    const startChanged = next.startsAt.getTime() !== booking.startsAt.getTime();
    await tx
      .update(bookings)
      .set({ ...next, endsAt, priceCents, ...(startChanged && { reminderSentAt: null }) })
      .where(eq(bookings.id, booking.id));
    await tx
      .update(courtOccupations)
      .set({ period: { start: next.startsAt, end: endsAt } })
      .where(and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, booking.id)));

    const [organizerShare, guestShare] = splitBookingPrice(priceCents, next.peopleCount);
    await tx
      .update(bookingParticipants)
      .set({ shareCents: guestShare?.amountCents ?? 0 })
      .where(eq(bookingParticipants.bookingId, booking.id));
    await tx
      .update(bookingParticipants)
      .set({ shareCents: organizerShare?.amountCents ?? 0 })
      .where(
        and(eq(bookingParticipants.bookingId, booking.id), eq(bookingParticipants.userId, actorId)),
      );

    await audit(tx, {
      actorId,
      spaceId: booking.spaceId,
      action: 'booking.update',
      entity: 'booking',
      entityId: booking.id,
      diff: {
        from: {
          peopleCount: booking.peopleCount,
          startsAt: booking.startsAt.toISOString(),
          durationMin: booking.durationMin,
          priceCents: booking.priceCents,
        },
        to: {
          peopleCount: next.peopleCount,
          startsAt: next.startsAt.toISOString(),
          durationMin: next.durationMin,
          priceCents,
        },
      },
    });
  }

  /**
   * RN-BOOK-05: o organizador cancela até o prazo do espaço, com estorno integral automático do
   * que pagou online (RN-ONPAY-05). Decisão 96: a reserva `PENDING_PAYMENT` ele pode desistir a
   * qualquer momento (libera o horário); antes, a cobrança aberta é cancelada no gateway, e se ela
   * acabou de ser paga, a reserva segue o cancelamento normal (com estorno).
   */
  async cancelByPlayer(
    userId: string,
    bookingId: string,
    input: CancelBookingInput,
  ): Promise<PlayerBookingDetail> {
    const where = and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId));
    // Status, espaço e prazo conferidos antes de qualquer efeito no gateway.
    const [current] = await this.db.select().from(bookings).where(where);
    if (!current) throw bookingNotFound();
    await this.assertPlayerCancellable(this.db, current);
    await this.online.settleBookingCharges(bookingId);
    let afterCommit: (() => Promise<void>) | undefined;
    let wasPending = false;
    await this.db.transaction(async (tx) => {
      const booking = await this.lock(tx, where);
      // De novo, travado: a cobrança aberta pode ter acabado de pagar a reserva.
      await this.assertPlayerCancellable(tx, booking);
      wasPending = booking.status === 'PENDING_PAYMENT';
      await this.cancel(
        tx,
        booking,
        userId,
        wasPending ? BOOKING_PAYMENT_ABANDONED_REASON : input.reason,
      );
      afterCommit = await this.online.onBookingCancelled(tx, booking, userId, 'PLAYER');
    });
    await afterCommit?.();
    // Desistir antes de pagar não avisa ninguém: a reserva nunca foi confirmada.
    if (!wasPending) {
      await this.events.publish({ type: 'booking.cancelled', bookingId, cancelledBy: userId });
    }
    return this.playerDetail(bookingId, userId);
  }

  /** RN-BOOK-05: a gestão cancela a qualquer momento (auditado). */
  async cancelByStaff(
    spaceId: string,
    actorId: string,
    bookingId: string,
    input: CancelBookingInput,
  ): Promise<BookingDetail> {
    const where = and(eq(bookings.id, bookingId), eq(bookings.spaceId, spaceId));
    const [current] = await this.db.select().from(bookings).where(where);
    if (!current) throw bookingNotFound();
    if (current.status !== 'CONFIRMED' && current.status !== 'PENDING_PAYMENT') {
      throw invalidBookingStatus(current.status);
    }
    await this.online.settleBookingCharges(bookingId);
    let afterCommit: (() => Promise<void>) | undefined;
    await this.db.transaction(async (tx) => {
      const booking = await this.lock(
        tx,
        and(eq(bookings.id, bookingId), eq(bookings.spaceId, spaceId)),
      );
      if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING_PAYMENT') {
        throw invalidBookingStatus(booking.status);
      }
      await this.cancel(tx, booking, actorId, input.reason);
      // RN-ONPAY-05: cancelamento pelo espaço estorna o que foi pago online, a qualquer momento.
      afterCommit = await this.online.onBookingCancelled(tx, booking, actorId, 'SPACE');
      await audit(tx, {
        actorId,
        spaceId,
        action: 'booking.cancel',
        entity: 'booking',
        entityId: booking.id,
        diff: { from: booking.status, to: 'CANCELLED', reason: input.reason ?? null },
      });
    });
    await afterCommit?.();
    await this.events.publish({ type: 'booking.cancelled', bookingId, cancelledBy: actorId });
    return this.staffDetail(eq(bookings.id, bookingId));
  }

  /** RF-BOOK-08: concluir ou marcar no-show (só depois do início). A ocupação continua. */
  async finish(
    spaceId: string,
    actorId: string,
    bookingId: string,
    to: 'COMPLETED' | 'NO_SHOW',
  ): Promise<BookingDetail> {
    await this.db.transaction(async (tx) => {
      const booking = await this.lock(
        tx,
        and(eq(bookings.id, bookingId), eq(bookings.spaceId, spaceId)),
      );
      if (booking.status !== 'CONFIRMED') throw invalidBookingStatus(booking.status);
      if (booking.startsAt > new Date()) throw bookingNotStarted();
      await tx.update(bookings).set({ status: to }).where(eq(bookings.id, booking.id));
      await audit(tx, {
        actorId,
        spaceId,
        action: to === 'COMPLETED' ? 'booking.complete' : 'booking.no_show',
        entity: 'booking',
        entityId: booking.id,
        diff: { from: booking.status, to },
      });
    });
    return this.staffDetail(eq(bookings.id, bookingId));
  }

  /**
   * RN-BOOK-05 e decisão 96: o organizador cancela a reserva confirmada até o prazo (com o espaço
   * ativo) e desiste da que aguarda pagamento a qualquer momento.
   */
  private async assertPlayerCancellable(db: DbOrTx, booking: BookingRow): Promise<void> {
    if (booking.status === 'PENDING_PAYMENT') return;
    if (booking.status !== 'CONFIRMED') throw invalidBookingStatus(booking.status);
    // RF-SUPER-03: espaço suspenso/encerrado fica só leitura (a gestão é barrada no guard).
    await assertSpaceWritable(db, booking.spaceId);
    const space = await this.spaces.load(booking.spaceId, db);
    const deadline = playerCancellationDeadline(
      booking.startsAt,
      space.rules.cancellationDeadlineMin,
    );
    if (new Date() > deadline) throw cancellationDeadlinePassed(deadline);
  }

  private async lock(tx: Tx, where: SQL | undefined): Promise<BookingRow> {
    const [booking] = await tx.select().from(bookings).where(where).for('update');
    if (!booking) throw bookingNotFound();
    return booking;
  }

  /** Cancela e libera a quadra (a ocupação fica inativa, fora da constraint). */
  private async cancel(tx: Tx, booking: BookingRow, actorId: string, reason?: string) {
    await tx
      .update(bookings)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actorId,
        cancelReason: reason ?? null,
      })
      .where(eq(bookings.id, booking.id));
    await tx
      .update(courtOccupations)
      .set({ active: false })
      .where(and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, booking.id)));
  }

  // -------------------------------------------------------------------------------------------
  // Leitura

  /** Quem pode ver a reserva pelo app: o organizador ou um participante que aceitou. */
  private visibleTo(userId: string): SQL {
    return or(
      eq(bookings.organizerUserId, userId),
      exists(
        this.db
          .select({ one: sql`1` })
          .from(bookingParticipants)
          .where(
            and(
              eq(bookingParticipants.bookingId, bookings.id),
              eq(bookingParticipants.userId, userId),
              eq(bookingParticipants.status, 'ACCEPTED'),
            ),
          ),
      ),
    ) as SQL;
  }

  /**
   * RF-BOOK-03: minhas reservas (próximas em ordem crescente, passadas em decrescente). As que
   * aguardam pagamento (RF-ONPAY-04) entram nas próximas; vencidas, expiram aqui também.
   */
  async listMine(userId: string, query: MyBookingsQuery): Promise<PlayerBookingPage> {
    const now = new Date();
    await this.online.expireHolds(now, { organizerUserId: userId });
    const upcoming = and(
      inArray(bookings.status, ['CONFIRMED', 'PENDING_PAYMENT']),
      gt(bookings.endsAt, now),
    ) as SQL;
    const ascending = query.when === 'upcoming';
    const page = await this.page(
      and(this.visibleTo(userId), ascending ? upcoming : not(upcoming)),
      ascending,
      query,
      { staff: false },
    );
    return { ...page, items: page.items.map((b) => toPlayerBooking(b, userId)) };
  }

  async getMine(userId: string, bookingId: string): Promise<PlayerBookingDetail> {
    await this.online.expireHolds(new Date(), { bookingId, organizerUserId: userId });
    return this.playerDetail(bookingId, userId);
  }

  /**
   * Reservas do espaço com filtros (painel). Sem `money` (decisão 53), os valores chegam nulos e o
   * filtro de pagamento é ignorado: ele revelaria a situação que o campo esconde.
   */
  async listForSpace(
    spaceId: string,
    query: SpaceBookingsQuery,
    { money }: { money: boolean },
  ): Promise<SpaceBookingPage> {
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
    const where = and(
      eq(bookings.spaceId, spaceId),
      query.from ? gt(bookings.endsAt, query.from) : undefined,
      query.to ? lt(bookings.startsAt, query.to) : undefined,
      query.courtId ? eq(bookings.courtId, query.courtId) : undefined,
      query.status?.length ? inArray(bookings.status, query.status) : undefined,
      money && query.paymentStatus?.length
        ? inArray(bookings.paymentStatus, query.paymentStatus)
        : undefined,
      query.source?.length ? inArray(bookings.source, query.source) : undefined,
      pattern
        ? or(
            ilike(bookings.guestName, pattern),
            ilike(bookings.guestPhone, pattern),
            ilike(users.name, pattern),
          )
        : undefined,
    );
    const page = await this.page(where, true, query, { staff: true });
    return money ? page : { ...page, items: page.items.map(withoutMoney) };
  }

  /** `suggestTo`: quem pode vincular o cliente de balcão vê a conta sugerida (RF-CONTACT-05). */
  async getForSpace(
    spaceId: string,
    bookingId: string,
    suggestTo?: string,
  ): Promise<BookingDetail> {
    return this.staffDetail(
      and(eq(bookings.id, bookingId), eq(bookings.spaceId, spaceId)) as SQL,
      suggestTo,
    );
  }

  /** Extrato completo: só nas rotas da gestão (o `:spaceId` já passou pelo guard). */
  private async staffDetail(where: SQL, suggestTo?: string): Promise<BookingDetail> {
    const booking = await this.views.one(where, { staff: true });
    if (!booking) throw bookingNotFound();
    return this.views.staffDetail(booking, undefined, suggestTo);
  }

  /** Visão do jogador: organizador ou participante que aceitou o convite. */
  private async playerDetail(bookingId: string, userId: string): Promise<PlayerBookingDetail> {
    const booking = await this.views.one(
      and(eq(bookings.id, bookingId), this.visibleTo(userId)) as SQL,
      { staff: false },
    );
    if (!booking) throw bookingNotFound();
    return this.views.playerDetail(booking, userId);
  }

  private async page(
    where: SQL | undefined,
    ascending: boolean,
    { limit, cursor }: { limit: number; cursor?: string | undefined },
    options: { staff: boolean },
  ): Promise<BookingPage> {
    const after = cursor ? decodeCursor(cursor) : undefined;
    const keyset = after
      ? ascending
        ? sql`(${bookings.startsAt}, ${bookings.id}) > (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`
        : sql`(${bookings.startsAt}, ${bookings.id}) < (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`
      : undefined;
    const order = ascending
      ? [asc(bookings.startsAt), asc(bookings.id)]
      : [desc(bookings.startsAt), desc(bookings.id)];
    const items = await this.views.list(and(where, keyset), order, limit + 1, options);
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      nextCursor:
        hasMore && last ? encodeCursor({ startsAt: new Date(last.startsAt), id: last.id }) : null,
    };
  }
}

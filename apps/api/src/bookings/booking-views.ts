import { Inject, Injectable } from '@nestjs/common';
import {
  BOOKING_EDIT_BLOCK_MESSAGES,
  type Booking,
  type BookingDetail,
  type BookingEditBlockCode,
  type BookingParticipant,
  bookingEditBlocks,
  DEFAULT_BOOKING_RULES,
  DEFAULT_TIME_ZONE,
  type OpenOnlineCharge,
  type PaymentRecord,
  type PlayerBooking,
  type PlayerBookingDetail,
  type PlayerBookingParticipant,
  playerCancellationDeadline,
  type SpaceBooking,
  type SpaceBookingDetail,
  type SuggestedUser,
} from '@space-sports/shared';
import { and, asc, desc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { phonesInformedInBooking } from '../contacts/contact-store.js';
import { PhoneSuggestions } from '../contacts/phone-suggestions.service.js';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  cities,
  courtSports,
  courts,
  onlineCharges,
  paymentRecords,
  spaceSettings,
  spaces,
  sports,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from '../payments/gateway/gateway.registry.js';
import type { PaymentGateway } from '../payments/gateway/payment-gateway.js';
import { loadOpenCharges, loadStaffCharges } from '../payments/online-queries.js';
import { toPlayerCharge } from '../payments/online-views.js';
import type { DbOrTx } from './db-utils.js';

/** Soma dos pagamentos não estornados da reserva e dos registros antigos por parte (decisão 50). */
export const paidCentsSql = sql<number>`coalesce((
  select sum(${paymentRecords.amountCents})
  from ${paymentRecords}
  where ${paymentRecords.reversedAt} is null and (
    (${paymentRecords.payableType} = 'BOOKING' and ${paymentRecords.payableId} = ${bookings.id})
    or (${paymentRecords.payableType} = 'BOOKING_PARTICIPANT' and ${paymentRecords.payableId} in (
      select ${bookingParticipants.id} from ${bookingParticipants}
      where ${bookingParticipants.bookingId} = ${bookings.id}
    ))
  )
), 0)::int`;

const bookingColumns = {
  booking: bookings,
  spaceName: spaces.name,
  spaceSlug: spaces.slug,
  timeZone: cities.timezone,
  courtName: courts.name,
  sportName: sports.name,
  sportSlug: sports.slug,
  organizerName: users.name,
  cancellationDeadlineMin: spaceSettings.cancellationDeadlineMin,
  paidCents: paidCentsSql,
};

type BookingRow = {
  booking: typeof bookings.$inferSelect;
  spaceName: string;
  spaceSlug: string;
  timeZone: string;
  courtName: string;
  sportName: string;
  sportSlug: string;
  organizerName: string | null;
  cancellationDeadlineMin: number | null;
  paidCents: number;
};

export interface ViewOptions {
  /** Gestão do espaço: vê o telefone do cliente de balcão. */
  staff: boolean;
}

/** Reserva aberta: confirmada e não terminada. */
export const isBookingOpen = (booking: Booking) =>
  booking.status === 'CONFIRMED' && new Date(booking.endsAt) > new Date();

/** Leitura das reservas no formato da API (shared `Booking`/`BookingDetail`). */
@Injectable()
export class BookingViews {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly suggestions: PhoneSuggestions,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  query(db: DbOrTx = this.db) {
    return db
      .select(bookingColumns)
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(sports, eq(sports.id, bookings.sportId))
      .leftJoin(users, eq(users.id, bookings.organizerUserId))
      .leftJoin(spaceSettings, eq(spaceSettings.spaceId, bookings.spaceId))
      .$dynamic();
  }

  async list(
    where: SQL | undefined,
    order: SQL[],
    limit: number,
    options: ViewOptions,
  ): Promise<Booking[]> {
    const rows = await this.query()
      .where(where)
      .orderBy(...order)
      .limit(limit);
    const open = await loadOpenCharges(
      this.db,
      'BOOKING',
      rows.map((row) => row.booking.id),
    );
    return rows.map((row) => toBooking(row, options, open.get(row.booking.id) ?? null));
  }

  async one(where: SQL, options: ViewOptions, db: DbOrTx = this.db): Promise<Booking | null> {
    const [row] = await this.query(db).where(where);
    if (!row) return null;
    const open = await loadOpenCharges(db, 'BOOKING', [row.booking.id]);
    return toBooking(row, options, open.get(row.booking.id) ?? null);
  }

  /**
   * Detalhe para a gestão do espaço: participantes, convites e o extrato completo. `suggestTo` é
   * quem pode vincular o cliente de balcão a uma conta (RF-CONTACT-05), na visualização da reserva.
   */
  async staffDetail(
    booking: Booking,
    db: DbOrTx = this.db,
    suggestTo?: string,
  ): Promise<BookingDetail> {
    const participants = await this.participants(booking, db);
    const payments = await this.payments(booking, participants, db);
    const charges = await loadStaffCharges(
      db,
      and(eq(onlineCharges.payableType, 'BOOKING'), eq(onlineCharges.payableId, booking.id)),
      paymentEnvironmentOf(this.gateway),
    );
    return {
      ...booking,
      onlineCharges: charges,
      participants: participants.map(
        ({ participant: p, userName }): BookingParticipant => ({
          id: p.id,
          userId: p.userId,
          name: userName ?? p.name,
          isOrganizer: isOrganizerRow(p, booking),
          shareCents: p.shareCents,
          status: p.status,
          ...this.invite(p, true),
        }),
      ),
      payments: payments.map(toPaymentRecord),
      suggestedUser: suggestTo ? await this.customerSuggestion(booking, suggestTo, db) : null,
    };
  }

  /**
   * Detalhe para o jogador (organizador ou participante que aceitou): a divisão é só informativa
   * (decisão 50). O organizador vê ainda os convites pendentes; o extrato fica com a gestão.
   */
  async playerDetail(
    booking: Booking,
    userId: string,
    db: DbOrTx = this.db,
  ): Promise<PlayerBookingDetail> {
    const participants = await this.participants(booking, db);
    const organizer = booking.organizer.userId === userId;
    const mine = participants.find(({ participant }) => participant.userId === userId)?.participant;
    const suggested = organizer
      ? await this.participantSuggestions(booking, userId, participants, db)
      : new Map<string, SuggestedUser>();

    return {
      ...toPlayerBooking(booking, userId),
      participants: participants.map(
        ({ participant: p, userName }): PlayerBookingParticipant => ({
          id: p.id,
          name: userName ?? p.name,
          isOrganizer: isOrganizerRow(p, booking),
          isMe: p.userId === userId,
          shareCents: p.shareCents,
          status: p.status,
          ...this.invite(p, organizer),
          suggestedUser: suggested.get(p.id) ?? null,
          hasAccount: p.userId !== null,
        }),
      ),
      myShare: {
        participantId: mine?.id ?? null,
        shareCents: mine?.shareCents ?? (organizer ? booking.priceCents : 0),
      },
      ...(await this.editability(booking, userId, db)),
      onlinePayment: organizer ? await this.latestPlayerCharge(booking.id, db) : null,
    };
  }

  /** RF-ONPAY-03/04: a cobrança aberta da reserva ou, sem ela, a mais recente. */
  private async latestPlayerCharge(bookingId: string, db: DbOrTx) {
    const [charge] = await db
      .select()
      .from(onlineCharges)
      .where(and(eq(onlineCharges.payableType, 'BOOKING'), eq(onlineCharges.payableId, bookingId)))
      .orderBy(sql`${onlineCharges.status} = 'PENDING' DESC`, desc(onlineCharges.createdAt))
      .limit(1);
    return charge ? toPlayerCharge(charge, paymentEnvironmentOf(this.gateway)) : null;
  }

  /** RN-BOOK-10 a RN-BOOK-12: a mesma leitura vale para as flags do detalhe e para o PATCH. */
  async editBlocks(booking: Booking, userId: string, db: DbOrTx = this.db) {
    const [row] = await db
      .select({
        recurringBookingId: bookings.recurringBookingId,
        spaceStatus: spaces.status,
        courtStatus: courts.status,
        offeredSportId: courtSports.sportId,
      })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .leftJoin(
        courtSports,
        and(eq(courtSports.courtId, bookings.courtId), eq(courtSports.sportId, bookings.sportId)),
      )
      .where(eq(bookings.id, booking.id));
    return bookingEditBlocks({
      isOrganizer: booking.organizer.userId === userId,
      spaceActive: row?.spaceStatus === 'ACTIVE',
      status: booking.status,
      source: booking.source,
      recurring: Boolean(row?.recurringBookingId),
      courtActive: row?.courtStatus === 'ACTIVE',
      sportOffered: Boolean(row?.offeredSportId),
      startsAt: new Date(booking.startsAt),
      endsAt: new Date(booking.endsAt),
      // O abatimento conta como pagamento: com ele, mudar data ou horário é com o espaço.
      paidCents: booking.paidCents + booking.discountCents,
      deadline: new Date(booking.cancellableUntil),
      now: new Date(),
    });
  }

  /** RF-BOOK-03: o que o usuário pode editar agora e, quando não pode, por quê. */
  private async editability(booking: Booking, userId: string, db: DbOrTx) {
    const { people, schedule } = await this.editBlocks(booking, userId, db);
    return {
      canEditPeople: people === null,
      peopleEditBlock: toEditBlock(people),
      canEditSchedule: schedule === null,
      scheduleEditBlock: toEditBlock(schedule),
    };
  }

  /** Token e link público só para quem pode reenviar o convite, e só enquanto pendente. */
  private invite(p: ParticipantRow, canSee: boolean) {
    const show = canSee && p.status === 'INVITED';
    return {
      inviteToken: show ? p.inviteToken : null,
      inviteUrl: show ? `${this.env.WEB_URL}/r/${p.inviteToken}` : null,
    };
  }

  /** RF-CONTACT-05: participante sem conta, em reserva aberta, cujo telefone é de uma conta. */
  private async participantSuggestions(
    booking: Booking,
    organizerId: string,
    rows: Awaited<ReturnType<BookingViews['participants']>>,
    db: DbOrTx,
  ): Promise<Map<string, SuggestedUser>> {
    if (!isBookingOpen(booking)) return new Map();
    const phones = await phonesInformedInBooking(db, booking.id);
    const pending = rows.flatMap(({ participant: p }) => {
      const phone = p.contactId ? phones.get(p.contactId) : undefined;
      return phone && !p.userId && p.status !== 'DECLINED' ? [{ id: p.id, phone }] : [];
    });
    const accounts = await this.suggestions.find(
      'organizer',
      organizerId,
      pending.map((p) => p.phone),
      db,
    );
    const inBooking = new Set(rows.map(({ participant }) => participant.userId));
    return new Map(
      pending.flatMap(({ id, phone }) => {
        const account = accounts.get(phone);
        return account && !inBooking.has(account.id) ? [[id, account]] : [];
      }),
    );
  }

  /** RF-CONTACT-05: cliente de balcão sem conta, em reserva aberta, cujo telefone é de uma conta. */
  private async customerSuggestion(
    booking: Booking,
    staffId: string,
    db: DbOrTx,
  ): Promise<SuggestedUser | null> {
    const { userId, phone } = booking.organizer;
    if (userId || !phone || !isBookingOpen(booking)) return null;
    const accounts = await this.suggestions.find('staff', staffId, [phone], db);
    return accounts.get(phone) ?? null;
  }

  private participants(booking: Booking, db: DbOrTx) {
    return (
      db
        .select({ participant: bookingParticipants, userName: users.name })
        .from(bookingParticipants)
        .leftJoin(users, eq(users.id, bookingParticipants.userId))
        .where(eq(bookingParticipants.bookingId, booking.id))
        // O organizador primeiro; depois pela ordem dos convites.
        .orderBy(
          desc(sql`coalesce(${bookingParticipants.userId} = ${booking.organizer.userId}, false)`),
          asc(bookingParticipants.createdAt),
          asc(bookingParticipants.id),
        )
    );
  }

  /** Pagamentos da reserva e os registros antigos das partes dela (decisão 50). */
  private payments(booking: Booking, participants: { participant: ParticipantRow }[], db: DbOrTx) {
    const participantIds = participants.map((p) => p.participant.id);
    return db
      .select()
      .from(paymentRecords)
      .where(
        or(
          and(eq(paymentRecords.payableType, 'BOOKING'), eq(paymentRecords.payableId, booking.id)),
          participantIds.length
            ? and(
                eq(paymentRecords.payableType, 'BOOKING_PARTICIPANT'),
                inArray(paymentRecords.payableId, participantIds),
              )
            : undefined,
        ),
      )
      .orderBy(asc(paymentRecords.paidAt), asc(paymentRecords.id));
  }
}

type ParticipantRow = typeof bookingParticipants.$inferSelect;

const isOrganizerRow = (p: ParticipantRow, booking: Booking) =>
  p.userId !== null && p.userId === booking.organizer.userId;

const toEditBlock = (code: BookingEditBlockCode | null) =>
  code && { code, message: BOOKING_EDIT_BLOCK_MESSAGES[code] };

/** O total pago e o status da reserva inteira só vão para o organizador. */
export function toPlayerBooking(booking: Booking, userId: string): PlayerBooking {
  const organizer = booking.organizer.userId === userId;
  return {
    ...booking,
    paidCents: organizer ? booking.paidCents : null,
    discountCents: organizer ? booking.discountCents : null,
    paymentStatus: organizer ? booking.paymentStatus : null,
    serverTime: new Date().toISOString(),
  };
}

/** Decisão 53: a agenda sem valores nem situação do pagamento, para quem não os registra. */
export function withoutMoney(booking: Booking): SpaceBooking {
  return {
    ...booking,
    pricePerHourCents: null,
    priceCents: null,
    paidCents: null,
    discountCents: null,
    paymentStatus: null,
    intendedPaymentMethod: null,
    openOnlineCharge: null,
  };
}

/** Decisão 53: também sem as partes, o extrato e o convite (token e link). */
export function detailWithoutMoney(detail: BookingDetail): SpaceBookingDetail {
  return {
    ...detail,
    ...withoutMoney(detail),
    participants: detail.participants.map((participant) => ({
      ...participant,
      shareCents: null,
      inviteToken: null,
      inviteUrl: null,
    })),
    payments: [],
    onlineCharges: [],
  };
}

function toBooking(
  row: BookingRow,
  { staff }: ViewOptions,
  openOnlineCharge: OpenOnlineCharge | null,
): Booking {
  const b = row.booking;
  const deadline = row.cancellationDeadlineMin ?? DEFAULT_BOOKING_RULES.cancellationDeadlineMin;
  return {
    id: b.id,
    space: {
      id: b.spaceId,
      name: row.spaceName,
      slug: row.spaceSlug,
      timeZone: row.timeZone || DEFAULT_TIME_ZONE,
    },
    court: { id: b.courtId, name: row.courtName },
    sport: { id: b.sportId, name: row.sportName, slug: row.sportSlug },
    organizer: {
      userId: b.organizerUserId,
      name: b.guestName ?? row.organizerName ?? '',
      phone: staff ? b.guestPhone : null,
    },
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    durationMin: b.durationMin,
    peopleCount: b.peopleCount,
    pricePerHourCents: b.pricePerHourCents,
    priceCents: b.priceCents,
    paidCents: row.paidCents,
    discountCents: b.discountCents,
    status: b.status,
    paymentStatus: b.paymentStatus,
    intendedPaymentMethod: b.intendedPaymentMethod,
    source: b.source,
    paymentDueAt: b.paymentDueAt?.toISOString() ?? null,
    openOnlineCharge,
    cancellableUntil: playerCancellationDeadline(b.startsAt, deadline).toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt.toISOString(),
  };
}

export function toPaymentRecord(p: typeof paymentRecords.$inferSelect): PaymentRecord {
  return {
    id: p.id,
    // Só os tipos do aluguel chegam aqui (filtro por payable_type nas consultas).
    payableType: p.payableType as PaymentRecord['payableType'],
    payableId: p.payableId,
    payerUserId: p.payerUserId,
    amountCents: p.amountCents,
    method: p.method,
    channel: p.channel,
    onlineChargeId: p.onlineChargeId,
    paidAt: p.paidAt.toISOString(),
    recordedBy: p.recordedBy,
    note: p.note,
    reversedAt: p.reversedAt?.toISOString() ?? null,
    reversedBy: p.reversedBy,
  };
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPACE_PERMISSIONS, utcToZoned } from '@space-sports/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  cities,
  courts,
  recurringBookings,
  spaceMembers,
  spaces,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { NotificationsService, type NotifyInput } from './notifications.service.js';

const WEEKDAYS_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const WEEKDAYS_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `sáb., 02/11/2030 às 14:00` no fuso do espaço (as datas ficam em UTC no banco). */
export function formatWhen(instant: Date, timeZone: string): string {
  const { date, minuteOfDay, weekday } = utcToZoned(instant, timeZone);
  const [year, month, day] = date.split('-');
  const time = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
  return `${WEEKDAYS_SHORT[weekday]}, ${day}/${month}/${year} às ${time}`;
}

interface BookingContext {
  id: string;
  spaceId: string;
  organizerUserId: string | null;
  organizerName: string | null;
  startsAt: Date;
  peopleCount: number;
  spaceName: string;
  courtName: string;
  timeZone: string;
}

/**
 * Textos e destinatários das notificações de reserva (RF-NOTIF-01). Lê o que precisa do banco
 * e entrega ao `NotificationsService`; os módulos de reserva não conhecem nada daqui.
 */
@Injectable()
export class BookingNotifier {
  private readonly logger = new Logger(BookingNotifier.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /** Reserva criada: avisa o organizador (se ele tem conta; reserva de balcão pode não ter). */
  async confirmed(bookingId: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking?.organizerUserId) return;
    await this.notifications.notify({
      userId: booking.organizerUserId,
      type: 'BOOKING_CONFIRMED',
      title: 'Reserva confirmada',
      body: `${this.where(booking)} · ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId },
    });
  }

  /** Reserva cancelada: avisa o organizador e quem aceitou dividir a conta, menos quem cancelou. */
  async cancelled(bookingId: string, cancelledBy: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking) return;
    const recipients = (await this.players(booking)).filter((userId) => userId !== cancelledBy);
    await this.notifyEach(recipients, (userId) => ({
      userId,
      type: 'BOOKING_CANCELLED',
      title: 'Reserva cancelada',
      body: `${this.where(booking)} · ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId },
    }));
  }

  /**
   * Reserva editada (RN-BOOK-13): avisa quem joga e a gestão do espaço, menos quem editou. Cada
   * público tem um tipo, com preferência própria, e quem está nos dois recebe só o de jogador. O
   * `bookingId` abre a reserva no app do jogador, onde ela só existe para quem joga; por isso a
   * gestão recebe `spaceBookingId`.
   */
  async updated(bookingId: string, updatedBy: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking) return;
    const people = booking.peopleCount === 1 ? '1 pessoa' : `${booking.peopleCount} pessoas`;
    const summary = `${this.where(booking)} · ${formatWhen(booking.startsAt, booking.timeZone)} · ${people}`;
    const players = await this.players(booking);
    await this.notifyEach(
      players.filter((userId) => userId !== updatedBy),
      (userId) => ({
        userId,
        type: 'BOOKING_UPDATED',
        title: 'Reserva alterada',
        body: summary,
        data: { bookingId, spaceId: booking.spaceId },
      }),
    );
    const staff = await this.staff(booking.spaceId);
    await this.notifyEach(
      staff.filter((userId) => userId !== updatedBy && !players.includes(userId)),
      (userId) => ({
        userId,
        type: 'SPACE_BOOKING_UPDATED',
        title: `${booking.organizerName ?? 'O jogador'} alterou a reserva`,
        body: summary,
        data: { spaceBookingId: bookingId, spaceId: booking.spaceId },
      }),
    );
  }

  /** Lembrete antes do jogo: organizador e participantes que aceitaram. */
  async reminder(bookingId: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking) return;
    await this.notifyEach(await this.players(booking), (userId) => ({
      userId,
      type: 'BOOKING_REMINDER',
      title: 'Hora de jogar!',
      body: `${this.where(booking)} · ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId },
    }));
  }

  /**
   * Convite direto a um usuário. O `inviteToken` vai só nos dados da notificação do convidado: é
   * por ele que o app aceita ou recusa (a reserva só fica visível a quem já aceitou).
   */
  async invited(bookingId: string, inviteeUserId: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking) return;
    const [invite] = await this.db
      .select({ inviteToken: bookingParticipants.inviteToken })
      .from(bookingParticipants)
      .where(
        and(
          eq(bookingParticipants.bookingId, bookingId),
          eq(bookingParticipants.userId, inviteeUserId),
          eq(bookingParticipants.status, 'INVITED'),
        ),
      );
    // Sem convite pendente (já aceito, recusado ou desfeito) não há o que avisar.
    if (!invite) return;
    await this.notifications.notify({
      userId: inviteeUserId,
      type: 'BOOKING_INVITE',
      title: 'Convite para dividir a conta',
      body: `${booking.organizerName ?? 'Alguém'} convidou você · ${this.where(booking)}, ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId, inviteToken: invite.inviteToken },
    });
  }

  /** RF-CONTACT-02: o convidado sem conta respondeu pela página pública. */
  async inviteAnswered(bookingId: string, participantId: string, accepted: boolean): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking?.organizerUserId) return;
    const [participant] = await this.db
      .select({ name: bookingParticipants.name })
      .from(bookingParticipants)
      .where(eq(bookingParticipants.id, participantId));
    const guest = participant?.name ?? 'Um convidado';
    await this.notifications.notify({
      userId: booking.organizerUserId,
      type: 'BOOKING_INVITE_ANSWERED',
      title: accepted ? 'Convite confirmado' : 'Convite recusado',
      body: `${guest} ${accepted ? 'confirmou presença' : 'recusou o convite'} · ${this.where(booking)}, ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId },
    });
  }

  /** RF-CONTACT-04: a reserva passou para a conta do usuário e está em Minhas reservas. */
  async linked(bookingId: string, userId: string): Promise<void> {
    const booking = await this.load(bookingId);
    if (!booking) return;
    await this.notifications.notify({
      userId,
      type: 'BOOKING_LINKED',
      title: 'Reserva na sua conta',
      body: `${this.where(booking)} · ${formatWhen(booking.startsAt, booking.timeZone)}`,
      data: { bookingId, spaceId: booking.spaceId },
    });
  }

  /** Mensalista aprovado ou recusado: avisa o solicitante (se tem conta). */
  async recurringDecided(recurringBookingId: string, approved: boolean): Promise<void> {
    const [row] = await this.db
      .select({
        id: recurringBookings.id,
        spaceId: recurringBookings.spaceId,
        userId: recurringBookings.userId,
        weekday: recurringBookings.weekday,
        startTime: recurringBookings.startTime,
        spaceName: spaces.name,
        courtName: courts.name,
      })
      .from(recurringBookings)
      .innerJoin(spaces, eq(spaces.id, recurringBookings.spaceId))
      .innerJoin(courts, eq(courts.id, recurringBookings.courtId))
      .where(eq(recurringBookings.id, recurringBookingId));
    if (!row?.userId) return;
    const slot = `${WEEKDAYS_LONG[row.weekday]} às ${row.startTime.slice(0, 5)}`;
    await this.notifications.notify({
      userId: row.userId,
      type: approved ? 'RECURRING_APPROVED' : 'RECURRING_REJECTED',
      title: approved ? 'Mensalista aprovado' : 'Mensalista recusado',
      body: `${row.spaceName} · ${row.courtName} · ${slot}`,
      data: { recurringBookingId, spaceId: row.spaceId },
    });
  }

  /**
   * Notifica cada destinatário isoladamente: o erro de um (conta, preferência, fila) é logado e
   * os demais seguem. Os eventos de reserva já aconteceram, então não há o que desfazer.
   */
  private async notifyEach(
    userIds: string[],
    build: (userId: string) => NotifyInput,
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.notifications.notify(build(userId));
      } catch (err) {
        this.logger.error({ err, userId }, 'Falha ao notificar destinatário');
      }
    }
  }

  private where(booking: BookingContext): string {
    return `${booking.spaceName} · ${booking.courtName}`;
  }

  private async load(bookingId: string): Promise<BookingContext | undefined> {
    const [row] = await this.db
      .select({
        id: bookings.id,
        spaceId: bookings.spaceId,
        organizerUserId: bookings.organizerUserId,
        organizerName: users.name,
        startsAt: bookings.startsAt,
        peopleCount: bookings.peopleCount,
        spaceName: spaces.name,
        courtName: courts.name,
        timeZone: cities.timezone,
      })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .leftJoin(users, eq(users.id, bookings.organizerUserId))
      .where(eq(bookings.id, bookingId));
    return row;
  }

  /** Quem joga: o organizador (se tem conta) e os participantes que aceitaram o convite. */
  private async players(booking: BookingContext): Promise<string[]> {
    const accepted = await this.db
      .select({ userId: bookingParticipants.userId })
      .from(bookingParticipants)
      .where(
        and(
          eq(bookingParticipants.bookingId, booking.id),
          eq(bookingParticipants.status, 'ACCEPTED'),
          isNotNull(bookingParticipants.userId),
        ),
      );
    const ids = new Set<string>();
    if (booking.organizerUserId) ids.add(booking.organizerUserId);
    for (const { userId } of accepted) if (userId) ids.add(userId);
    return [...ids];
  }

  /** Quem cuida das reservas do espaço: vínculo ativo com a permissão da matriz (RN-AUTH-01). */
  private async staff(spaceId: string): Promise<string[]> {
    const members = await this.db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.status, 'ACTIVE'),
          inArray(spaceMembers.role, [...SPACE_PERMISSIONS['booking.create']]),
        ),
      );
    return [...new Set(members.map((m) => m.userId))];
  }
}

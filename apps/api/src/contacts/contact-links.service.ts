import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { bookingNotFound, inviteNotFound } from '../bookings/bookings.errors.js';
import { assertSpaceWritable, audit, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  bookingParticipants,
  bookings,
  contacts,
  recurringBookings,
  users,
} from '../db/schema/index.js';
import { type DomainEventOf, DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { accountsByPhone, linkContactToUser, phonesInformedInBooking } from './contact-store.js';
import { suggestedUserMismatch } from './contacts.errors.js';
import { RateLimiter, type RateLimitRule } from './rate-limiter.js';

type BookingRow = typeof bookings.$inferSelect;
type ParticipantRow = typeof bookingParticipants.$inferSelect;
type LinkEvent = DomainEventOf<'booking.invite_created' | 'booking.linked'>;

/** Confirmações de vínculo por telefone, por pessoa: a tela mostra só as contas sugeridas. */
export const CONFIRM_LINK_LIMIT: RateLimitRule = { window: 10 * 60, max: 30 };

/** Reserva aberta: a única em que o vínculo mexe em participante ou organizador. */
const isOpen = (booking: BookingRow, now = new Date()) =>
  booking.status === 'CONFIRMED' && booking.endsAt > now;

/**
 * Passa o convite para a conta. Pendente vira convite direto (a conta recebe a notificação e
 * responde pelo app); confirmado entra em Minhas reservas.
 */
async function bindParticipant(
  tx: Tx,
  participant: ParticipantRow,
  user: { id: string; name: string },
): Promise<LinkEvent> {
  await tx
    .update(bookingParticipants)
    .set({ userId: user.id, name: user.name || participant.name })
    .where(eq(bookingParticipants.id, participant.id));
  return participant.status === 'INVITED'
    ? {
        type: 'booking.invite_created',
        bookingId: participant.bookingId,
        inviteeUserId: user.id,
      }
    : { type: 'booking.linked', bookingId: participant.bookingId, userId: user.id };
}

/**
 * Vínculo do contato à conta (RF-CONTACT-04, RF-CONTACT-05, decisão 48): automático pelo e-mail
 * verificado; pelo telefone, só com a confirmação do organizador ou da gestão. Em reserva
 * terminada ou cancelada, nada muda além de `contacts.user_id`.
 */
@Injectable()
export class ContactLinksService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: DomainEvents,
    private readonly rateLimit: RateLimiter,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('user.email_verified', (e) => this.linkVerifiedEmail(e.userId));
  }

  /**
   * RF-CONTACT-04: o contato do e-mail passa para a conta, mesmo que outra o tivesse (confirmação
   * por telefone vale menos que o e-mail provado), com os convites abertos feitos antes da
   * verificação que citaram esse e-mail (`contact_via_email`). Convite que chegou só pelo telefone
   * fica: pode ser de outra pessoa. Idempotente: repetir não refaz vínculo nem notificação.
   */
  async linkVerifiedEmail(userId: string): Promise<void> {
    const [user] = await this.db
      .select({
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.email || !user.emailVerified || user.deletedAt) return;
    const { email, name } = user;

    const events = await this.db.transaction(async (tx) => {
      const [contact] = await tx
        .select({ id: contacts.id, userId: contacts.userId })
        .from(contacts)
        .where(eq(contacts.email, email));
      if (!contact) return [];

      // Trava as reservas antes do contato, na mesma ordem dos convites (sem deadlock).
      const open = await tx
        .select({ participant: bookingParticipants })
        .from(bookingParticipants)
        .innerJoin(bookings, eq(bookings.id, bookingParticipants.bookingId))
        .where(
          and(
            eq(bookingParticipants.contactId, contact.id),
            eq(bookingParticipants.contactViaEmail, true),
            isNull(bookingParticipants.userId),
            inArray(bookingParticipants.status, ['INVITED', 'ACCEPTED']),
            eq(bookings.status, 'CONFIRMED'),
            gt(bookings.endsAt, new Date()),
          ),
        )
        .orderBy(asc(bookings.id), asc(bookingParticipants.id))
        .for('update', { of: bookings });

      // A conta pode já estar na reserva (a linha é única por reserva e usuário).
      const bookingIds = [...new Set(open.map(({ participant }) => participant.bookingId))];
      const taken = new Set(
        bookingIds.length
          ? (
              await tx
                .select({ bookingId: bookingParticipants.bookingId })
                .from(bookingParticipants)
                .where(
                  and(
                    inArray(bookingParticipants.bookingId, bookingIds),
                    eq(bookingParticipants.userId, userId),
                  ),
                )
            ).map((row) => row.bookingId)
          : [],
      );

      const linked: LinkEvent[] = [];
      for (const { participant } of open) {
        if (taken.has(participant.bookingId)) continue;
        taken.add(participant.bookingId);
        linked.push(await bindParticipant(tx, participant, { id: userId, name }));
      }

      if (contact.userId !== userId) {
        await tx.update(contacts).set({ userId }).where(eq(contacts.id, contact.id));
      }
      if (linked.length || contact.userId !== userId) {
        await audit(tx, {
          actorId: userId,
          spaceId: null,
          action: 'contact.link_email',
          entity: 'contact',
          entityId: contact.id,
          diff: { userId, from: contact.userId, bookingIds: linked.map((e) => e.bookingId) },
        });
      }
      return linked;
    });
    for (const event of events) await this.events.publish(event);
  }

  /** RF-CONTACT-05: o organizador confirma a conta sugerida para o convidado. */
  async confirmParticipant(
    organizerId: string,
    bookingId: string,
    participantId: string,
    userId: string,
  ): Promise<void> {
    await this.rateLimit.consume(`user:${organizerId}|/bookings/confirm-link`, CONFIRM_LINK_LIMIT);
    const events = await this.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, organizerId)))
        .for('update');
      if (!booking) throw bookingNotFound();
      await assertSpaceWritable(tx, booking.spaceId);

      const [participant] = await tx
        .select()
        .from(bookingParticipants)
        .where(
          and(
            eq(bookingParticipants.id, participantId),
            eq(bookingParticipants.bookingId, bookingId),
          ),
        );
      const contactId = participant?.contactId;
      if (!participant || !contactId) throw inviteNotFound();
      const phones = await phonesInformedInBooking(tx, bookingId);
      const account = await this.suggested(tx, phones.get(contactId) ?? null, userId);

      if (!isOpen(booking)) {
        await this.linkContact(tx, contactId, booking.spaceId, organizerId, { bookingId, userId });
        return [];
      }
      if (participant.userId || participant.status === 'DECLINED') throw suggestedUserMismatch();
      const [occupied] = await tx
        .select({ id: bookingParticipants.id })
        .from(bookingParticipants)
        .where(
          and(eq(bookingParticipants.bookingId, bookingId), eq(bookingParticipants.userId, userId)),
        );
      if (occupied) throw suggestedUserMismatch();

      const event = await bindParticipant(tx, participant, account);
      await this.linkContact(tx, contactId, booking.spaceId, organizerId, {
        bookingId,
        participantId,
        userId,
      });
      return [event];
    });
    for (const event of events) await this.events.publish(event);
  }

  /**
   * RF-CONTACT-05: a gestão confirma a conta sugerida para o cliente de balcão. Na ocorrência de
   * mensalista, o vínculo vale para o mensalista e para as próximas ocorrências abertas.
   */
  async confirmDeskCustomer(
    spaceId: string,
    actorId: string,
    bookingId: string,
    userId: string,
  ): Promise<void> {
    await this.rateLimit.consume(`user:${actorId}|/manage/confirm-link`, CONFIRM_LINK_LIMIT);
    const linked = await this.db.transaction(async (tx) => {
      const where = and(eq(bookings.id, bookingId), eq(bookings.spaceId, spaceId));
      const [found] = await tx
        .select({ recurringBookingId: bookings.recurringBookingId })
        .from(bookings)
        .where(where);
      if (!found) throw bookingNotFound();
      // Mensalista antes das ocorrências, a ordem da geração.
      if (found.recurringBookingId) {
        await tx
          .select({ id: recurringBookings.id })
          .from(recurringBookings)
          .where(eq(recurringBookings.id, found.recurringBookingId))
          .for('update');
      }
      const [booking] = await tx.select().from(bookings).where(where).for('update');
      if (!booking) throw bookingNotFound();
      if (booking.organizerUserId || !booking.guestPhone) throw suggestedUserMismatch();
      const phone = booking.guestPhone;
      await this.suggested(tx, phone, userId);

      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.phone, phone));
      const diff = { bookingId, userId, recurringBookingId: booking.recurringBookingId };
      if (!isOpen(booking)) {
        if (contact) await this.linkContact(tx, contact.id, spaceId, actorId, diff);
        return false;
      }

      if (booking.recurringBookingId) {
        await tx
          .update(recurringBookings)
          .set({ userId })
          .where(
            and(
              eq(recurringBookings.id, booking.recurringBookingId),
              isNull(recurringBookings.userId),
            ),
          );
        await tx
          .update(bookings)
          .set({ organizerUserId: userId })
          .where(
            and(
              eq(bookings.recurringBookingId, booking.recurringBookingId),
              isNull(bookings.organizerUserId),
              eq(bookings.status, 'CONFIRMED'),
              gt(bookings.endsAt, new Date()),
              ne(bookings.id, booking.id),
            ),
          );
      }
      await tx.update(bookings).set({ organizerUserId: userId }).where(eq(bookings.id, bookingId));
      await this.linkContact(tx, contact?.id ?? null, spaceId, actorId, diff);
      return true;
    });
    if (linked) await this.events.publish({ type: 'booking.linked', bookingId, userId });
  }

  /** A conta tem de ser a dona do telefone agora: a sugestão que a tela mostrou pode ter mudado. */
  private async suggested(tx: Tx, phone: string | null, userId: string) {
    const [account] = phone ? await accountsByPhone(tx, [phone]) : [];
    if (account?.id !== userId) throw suggestedUserMismatch();
    return account;
  }

  private async linkContact(
    tx: Tx,
    contactId: string | null,
    spaceId: string,
    actorId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    if (contactId) await linkContactToUser(tx, contactId, diff.userId as string);
    await audit(tx, {
      actorId,
      spaceId,
      action: 'contact.link_phone',
      entity: 'contact',
      entityId: contactId,
      diff,
    });
  }
}

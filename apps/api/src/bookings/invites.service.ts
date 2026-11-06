import { Inject, Injectable } from '@nestjs/common';
import {
  type ConfirmPublicInviteInput,
  type CreateInvitesInput,
  type InvitePreview,
  type PlayerBookingDetail,
  type PublicInvitePreview,
  splitBookingPrice,
} from '@space-sports/shared';
import { and, eq, inArray, isNull, ne, notExists, type SQL } from 'drizzle-orm';
import {
  captureContact,
  linkContactToUser,
  lockContactIdentities,
  matchesInviteContact,
} from '../contacts/contact-store.js';
import type { Database } from '../db/client.js';
import { bookingParticipants, bookings, paymentRecords, users } from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { firstName } from '../users/normalize.js';
import { BookingViews, isBookingOpen } from './booking-views.js';
import {
  alreadyParticipant,
  bookingNotFound,
  bookingNotSplittable,
  inviteeNotFound,
  inviteNotFound,
  inviteSlotTaken,
  inviteUnavailable,
  tooManyInvites,
} from './bookings.errors.js';
import {
  assertSpaceWritable,
  audit,
  isUniqueViolation,
  newInviteToken,
  type Tx,
} from './db-utils.js';

type BookingRow = typeof bookings.$inferSelect;
type ParticipantRow = typeof bookingParticipants.$inferSelect;

/** Reserva ainda aberta a convites: confirmada e não terminada. */
const isOpen = (booking: BookingRow) =>
  booking.status === 'CONFIRMED' && booking.endsAt > new Date();

/**
 * Dividir a conta (RF-BOOK-04, RN-BOOK-09). As partes saem de `splitBookingPrice(price,
 * people_count)`: o organizador fica com a parte maior (a diferença de arredondamento) e cada
 * convidado com `price ÷ people_count`. A divisão é só informativa: o recebimento é da reserva
 * inteira (decisão 50). O organizador entra como participante (ACCEPTED) no primeiro convite. O
 * convite por nome é só link; o convite com WhatsApp ou e-mail (`items`) entra também na base de
 * contatos (RF-CONTACT-01); o convite a um usuário (`userIds`) já nasce vinculado a ele, que é
 * avisado e é o único a poder aceitar ou recusar. Quem não tem conta responde pela página pública
 * (`publicPreview`, `confirmPublic`, `declinePublic`; RF-CONTACT-02).
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly views: BookingViews,
    private readonly events: DomainEvents,
  ) {}

  async create(
    userId: string,
    bookingId: string,
    input: CreateInvitesInput,
  ): Promise<PlayerBookingDetail> {
    const userIds = [...new Set(input.userIds)];
    const notified: string[] = [];
    await this.db.transaction(async (tx) => {
      const booking = await this.lockBooking(
        tx,
        and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId)) as SQL,
      );
      await assertSpaceWritable(tx, booking.spaceId);
      if (!isOpen(booking) || booking.peopleCount < 2) throw bookingNotSplittable();

      const [organizerShare, guestShare] = splitBookingPrice(
        booking.priceCents,
        booking.peopleCount,
      );
      const participants = await tx
        .select()
        .from(bookingParticipants)
        .where(eq(bookingParticipants.bookingId, booking.id));
      const guests = participants.filter((p) => p.userId !== userId && p.status !== 'DECLINED');
      const available = booking.peopleCount - 1 - guests.length;
      if (input.names.length + input.items.length + userIds.length > available) {
        throw tooManyInvites(available);
      }

      const invitees = await this.activeUsers(tx, userIds);
      for (const invitee of invitees) {
        if (invitee.id === userId) throw alreadyParticipant();
        const current = participants.find((p) => p.userId === invitee.id);
        if (current && current.status !== 'DECLINED') throw alreadyParticipant();
      }

      if (!participants.some((p) => p.userId === userId)) {
        await tx.insert(bookingParticipants).values({
          bookingId: booking.id,
          userId,
          inviteToken: newInviteToken(),
          shareCents: organizerShare?.amountCents ?? 0,
          status: 'ACCEPTED',
        });
      }
      const shareCents = guestShare?.amountCents ?? 0;
      if (input.names.length) {
        await tx.insert(bookingParticipants).values(
          input.names.map((name) => ({
            bookingId: booking.id,
            inviteToken: newInviteToken(),
            name,
            shareCents,
          })),
        );
      }
      await lockContactIdentities(tx, input.items);
      for (const { name, phone, email } of input.items) {
        const contact =
          phone || email
            ? await captureContact(
                tx,
                { name, phone, email },
                {
                  origin: 'BOOKING_INVITE_ORGANIZER',
                  spaceId: booking.spaceId,
                  bookingId: booking.id,
                  capturedBy: userId,
                },
              )
            : null;
        await tx.insert(bookingParticipants).values({
          bookingId: booking.id,
          inviteToken: newInviteToken(),
          name: name ?? null,
          shareCents,
          contactId: contact?.id ?? null,
          contactViaEmail: contact?.viaEmail ?? false,
        });
      }
      for (const invitee of invitees) {
        const declined = participants.find((p) => p.userId === invitee.id);
        if (declined) {
          // Quem recusou antes volta a ser convidado (a linha é única por reserva e usuário).
          await tx
            .update(bookingParticipants)
            .set({ status: 'INVITED', shareCents, name: invitee.name })
            .where(eq(bookingParticipants.id, declined.id));
        } else {
          await tx.insert(bookingParticipants).values({
            bookingId: booking.id,
            userId: invitee.id,
            inviteToken: newInviteToken(),
            name: invitee.name,
            shareCents,
          });
        }
        notified.push(invitee.id);
      }
    });
    for (const inviteeUserId of notified) {
      await this.events.publish({ type: 'booking.invite_created', bookingId, inviteeUserId });
    }
    return this.organizerDetail(bookingId, userId);
  }

  /** O organizador desfaz um convite ainda pendente. */
  async revoke(
    userId: string,
    bookingId: string,
    participantId: string,
  ): Promise<PlayerBookingDetail> {
    await this.db.transaction(async (tx) => {
      const booking = await this.lockBooking(
        tx,
        and(eq(bookings.id, bookingId), eq(bookings.organizerUserId, userId)) as SQL,
      );
      await assertSpaceWritable(tx, booking.spaceId);
      const deleted = await tx
        .delete(bookingParticipants)
        .where(
          and(
            eq(bookingParticipants.id, participantId),
            eq(bookingParticipants.bookingId, bookingId),
            eq(bookingParticipants.status, 'INVITED'),
            // Parte com pagamento antigo registrado fica (o registro aponta para ela).
            notExists(
              tx
                .select({ id: paymentRecords.id })
                .from(paymentRecords)
                .where(
                  and(
                    eq(paymentRecords.payableType, 'BOOKING_PARTICIPANT'),
                    eq(paymentRecords.payableId, bookingParticipants.id),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: bookingParticipants.id });
      if (!deleted.length) throw inviteNotFound();
    });
    return this.organizerDetail(bookingId, userId);
  }

  async preview(userId: string, token: string): Promise<InvitePreview> {
    const participant = await this.byToken(this.db, token);
    const booking = await this.views.one(eq(bookings.id, participant.bookingId), { staff: false });
    if (!booking) throw inviteNotFound();
    const mine = participant.userId === userId;
    const confirmed = participant.status === 'ACCEPTED';
    return {
      participantId: participant.id,
      status: participant.status,
      shareCents: participant.shareCents,
      acceptedByMe: mine && confirmed,
      slotTaken:
        confirmed &&
        !mine &&
        (participant.userId !== null ||
          !(await this.isInviteContact(this.db, participant, userId))),
      forAnotherAccount: participant.status === 'INVITED' && participant.userId !== null && !mine,
      booking: {
        id: booking.id,
        space: booking.space,
        court: booking.court,
        sport: booking.sport,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        status: booking.status,
        intendedPaymentMethod: booking.intendedPaymentMethod,
        organizerName: booking.organizer.name,
      },
    };
  }

  /**
   * Aceite pelo link/deep link: o convite e o contato dele passam a ser do usuário da sessão
   * (RF-CONTACT-03). A vaga confirmada sem conta só vem para a conta com o mesmo contato; a de outra
   * pessoa é recusada com `INVITE_SLOT_TAKEN`. Idempotente.
   */
  async accept(userId: string, token: string): Promise<InvitePreview> {
    try {
      await this.db.transaction(async (tx) => {
        // Trava a reserva antes do convite (mesma ordem do create/revoke, sem deadlock).
        const { bookingId } = await this.byToken(tx, token);
        const booking = await this.lockBooking(tx, eq(bookings.id, bookingId));
        await assertSpaceWritable(tx, booking.spaceId);
        const participant = await this.byToken(tx, token, true);
        if (participant.status === 'ACCEPTED' && participant.userId === userId) return;
        const confirmedWithoutAccount = participant.status === 'ACCEPTED' && !participant.userId;
        if (participant.status !== 'INVITED' && !confirmedWithoutAccount) {
          throw inviteUnavailable();
        }
        // Convite direto a um usuário só vale para ele.
        if (participant.userId && participant.userId !== userId) throw inviteUnavailable();
        if (!isOpen(booking)) throw inviteUnavailable();
        if (booking.organizerUserId === userId) throw alreadyParticipant();
        if (confirmedWithoutAccount && !(await this.isInviteContact(tx, participant, userId))) {
          throw inviteSlotTaken();
        }
        const [user] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, userId));
        await tx
          .update(bookingParticipants)
          .set({ userId, status: 'ACCEPTED', name: user?.name || participant.name })
          .where(eq(bookingParticipants.id, participant.id));
        if (participant.contactId) {
          await linkContactToUser(tx, participant.contactId, userId);
          await audit(tx, {
            actorId: userId,
            spaceId: booking.spaceId,
            action: 'contact.link_invite',
            entity: 'contact',
            entityId: participant.contactId,
            diff: { bookingId, participantId: participant.id, userId },
          });
        }
      });
    } catch (err) {
      if (isUniqueViolation(err, 'booking_participants_booking_user_unique')) {
        throw alreadyParticipant();
      }
      throw err;
    }
    return this.preview(userId, token);
  }

  async decline(userId: string, token: string): Promise<InvitePreview> {
    await this.db.transaction(async (tx) => {
      const participant = await this.byToken(tx, token, true);
      if (participant.status !== 'INVITED') throw inviteUnavailable();
      if (participant.userId && participant.userId !== userId) throw inviteUnavailable();
      const [booking] = await tx
        .select({ spaceId: bookings.spaceId })
        .from(bookings)
        .where(eq(bookings.id, participant.bookingId));
      if (booking) await assertSpaceWritable(tx, booking.spaceId);
      await tx
        .update(bookingParticipants)
        .set({ status: 'DECLINED' })
        .where(
          and(
            eq(bookingParticipants.id, participant.id),
            ne(bookingParticipants.status, 'ACCEPTED'),
          ),
        );
    });
    return this.preview(userId, token);
  }

  /** RF-CONTACT-02: o mínimo que quem tem o link vê, sem sessão. */
  async publicPreview(token: string): Promise<PublicInvitePreview> {
    const participant = await this.byToken(this.db, token);
    const booking = await this.views.one(eq(bookings.id, participant.bookingId), { staff: false });
    if (!booking) throw inviteNotFound();
    const { name, slug, timeZone } = booking.space;
    return {
      status: participant.status,
      canAnswer: participant.status === 'INVITED' && !participant.userId && isBookingOpen(booking),
      accountRequired: participant.userId !== null,
      slotTaken: participant.status === 'ACCEPTED',
      shareCents: participant.shareCents,
      booking: {
        space: { name, slug, timeZone },
        court: { name: booking.court.name },
        sport: { name: booking.sport.name, slug: booking.sport.slug },
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        status: booking.status,
        organizerFirstName: firstName(booking.organizer.name),
      },
    };
  }

  /**
   * RF-CONTACT-02: presença sem conta. O participante fica ACCEPTED sem `user_id`, ligado ao
   * contato, e o organizador é avisado. O e-mail digitado aqui não vincula conta nenhuma: só quem
   * verifica o e-mail ou entra com o link vira dono do convite. Cada link é uma vaga: a mesma pessoa
   * (telefone ou e-mail) repete sem mudar nada, e outra é recusada sem deixar dado nenhum.
   */
  async confirmPublic(
    token: string,
    { name, phone, email, marketingConsent }: ConfirmPublicInviteInput,
  ): Promise<PublicInvitePreview> {
    let participantId: string | undefined;
    const { bookingId } = await this.db.transaction(async (tx) => {
      const { booking, participant } = await this.lockInvite(tx, token);
      if (participant.status === 'ACCEPTED') {
        if (await matchesInviteContact(tx, participant, { phone, email })) return participant;
        throw isOpen(booking) ? inviteSlotTaken() : inviteUnavailable();
      }
      // Convite direto a uma conta: só ela responde.
      if (participant.userId || participant.status !== 'INVITED' || !isOpen(booking)) {
        throw inviteUnavailable();
      }
      await assertSpaceWritable(tx, booking.spaceId);

      const contact = await captureContact(
        tx,
        { name, phone, email },
        { origin: 'BOOKING_INVITE_SELF', spaceId: booking.spaceId, bookingId: booking.id },
        { current: participant.contactId, marketingConsent },
      );
      const sameContact = contact.id === participant.contactId;
      await tx
        .update(bookingParticipants)
        .set({
          status: 'ACCEPTED',
          name,
          contactId: contact.id,
          contactViaEmail: contact.viaEmail || (sameContact && participant.contactViaEmail),
        })
        .where(eq(bookingParticipants.id, participant.id));
      participantId = participant.id;
      return participant;
    });
    if (participantId) {
      await this.events.publish({
        type: 'booking.invite_answered',
        bookingId,
        participantId,
        accepted: true,
      });
    }
    return this.publicPreview(token);
  }

  /** RF-CONTACT-02: recusa sem conta; não pede dado nenhum. */
  async declinePublic(token: string): Promise<PublicInvitePreview> {
    const { id, bookingId } = await this.db.transaction(async (tx) => {
      const { booking, participant } = await this.lockInvite(tx, token);
      if (participant.status !== 'INVITED' || participant.userId || !isOpen(booking)) {
        throw inviteUnavailable();
      }
      await assertSpaceWritable(tx, booking.spaceId);
      await tx
        .update(bookingParticipants)
        .set({ status: 'DECLINED' })
        .where(eq(bookingParticipants.id, participant.id));
      return participant;
    });
    await this.events.publish({
      type: 'booking.invite_answered',
      bookingId,
      participantId: id,
      accepted: false,
    });
    return this.publicPreview(token);
  }

  /**
   * RF-CONTACT-03: a conta é de quem está no convite? Vale só o que a conta provou: e-mail
   * verificado ou telefone verificado (o telefone só entra na conta pelo OTP).
   */
  private async isInviteContact(
    db: Database | Tx,
    participant: ParticipantRow,
    userId: string,
  ): Promise<boolean> {
    const [user] = await db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return false;
    return matchesInviteContact(db, participant, {
      email: user.emailVerified ? user.email : null,
      phone: user.phoneVerified ? user.phone : null,
    });
  }

  /** Trava a reserva antes do convite (mesma ordem do create/revoke, sem deadlock). */
  private async lockInvite(tx: Tx, token: string) {
    const { bookingId } = await this.byToken(tx, token);
    const booking = await this.lockBooking(tx, eq(bookings.id, bookingId));
    const participant = await this.byToken(tx, token, true);
    return { booking, participant };
  }

  private async byToken(
    db: Database | Tx,
    token: string,
    forUpdate = false,
  ): Promise<ParticipantRow> {
    const query = db
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.inviteToken, token));
    const [participant] = forUpdate ? await query.for('update') : await query;
    if (!participant) throw inviteNotFound();
    return participant;
  }

  /** Usuários ativos entre `ids`; qualquer id que sobrar sem conta é `INVITEE_NOT_FOUND`. */
  private async activeUsers(tx: Tx, ids: string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'ACTIVE'), isNull(users.deletedAt)));
    if (rows.length !== ids.length) throw inviteeNotFound();
    return rows;
  }

  private async lockBooking(tx: Tx, where: SQL): Promise<BookingRow> {
    const [booking] = await tx.select().from(bookings).where(where).for('update');
    if (!booking) throw bookingNotFound();
    return booking;
  }

  private async organizerDetail(bookingId: string, userId: string): Promise<PlayerBookingDetail> {
    const booking = await this.views.one(eq(bookings.id, bookingId), { staff: false });
    if (!booking) throw bookingNotFound();
    return this.views.playerDetail(booking, userId);
  }
}

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Auth } from '../../src/auth/auth.js';
import { AUTH } from '../../src/auth/auth.tokens.js';
import {
  auditLogs,
  bookingParticipants,
  bookings,
  contacts,
  contactTouchpoints,
  recurringBookings,
  users,
} from '../../src/db/schema/index.js';
import { DomainEvents } from '../../src/events/domain-events.js';
import { anonymizeUser } from '../../src/users/anonymize.js';
import { createTestApp, type SignedUp, signUp, type TestApp, WEB_ORIGIN } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { inbox } from '../notifications/helpers.js';
import {
  book,
  confirmPublic,
  guests,
  invite,
  myDetail,
  tokenOf,
  verifyEmail,
  verifyPhone,
} from './helpers.js';

useMiddayClock();

const mineIds = async (t: TestApp, user: SignedUp) => {
  const res = await t
    .http()
    .get('/v1/bookings')
    .set(...bearer(user))
    .expect(200);
  return res.body.items.map((b: { id: string }) => b.id);
};

describe('vínculo do contato com a conta (RF-CONTACT-04, RF-CONTACT-05)', () => {
  let t: TestApp;
  let space: Space;
  let organizer: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let hours = 24;
  const nextHours = () => {
    hours += 2;
    return hours;
  };

  const bookNext = (people = 4) => book(t, organizer, space, nextHours(), people);
  const contactByEmail = async (email: string) =>
    (await t.db.select().from(contacts).where(eq(contacts.email, email)))[0];
  const contactByPhone = async (phone: string) =>
    (await t.db.select().from(contacts).where(eq(contacts.phone, phone)))[0];
  const participant = async (id: string) =>
    (await t.db.select().from(bookingParticipants).where(eq(bookingParticipants.id, id)))[0];
  /** Um update qualquer da conta, pela rota do Better Auth. */
  const updateUser = (user: SignedUp, name: string) =>
    t
      .http()
      .post('/v1/auth/update-user')
      .set(...bearer(user))
      .set('origin', WEB_ORIGIN)
      .send({ name })
      .expect(200);

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-vinculos');
    organizer = await signUp(t, 'organizadora@exemplo.com', 'Organizadora');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
  });
  afterAll(() => t.close());

  describe('e-mail', () => {
    it('sem verificar não vincula; ao verificar, contato e reserva confirmada passam para a conta', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Paula Reis',
        email: 'paula@exemplo.com',
      }).expect(200);
      const guestId = guests(detail)[0]?.id ?? '';

      const account = await signUp(t, 'paula@exemplo.com', 'Paula Reis');
      expect((await contactByEmail('paula@exemplo.com'))?.userId).toBeNull();
      expect((await participant(guestId))?.userId).toBeNull();
      expect(await mineIds(t, account)).not.toContain(booking.id);

      await verifyEmail(t, 'paula@exemplo.com');

      expect((await contactByEmail('paula@exemplo.com'))?.userId).toBe(account.id);
      expect(await participant(guestId)).toMatchObject({
        userId: account.id,
        status: 'ACCEPTED',
      });
      expect(await mineIds(t, account)).toContain(booking.id);
      const { items } = await inbox(t, account);
      expect(items.find((i) => i.type === 'BOOKING_LINKED')).toMatchObject({
        title: 'Reserva na sua conta',
        data: expect.objectContaining({ bookingId: booking.id }),
      });
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'contact.link_email'), eq(auditLogs.actorId, account.id)));
      expect(log?.diff).toMatchObject({ userId: account.id, bookingIds: [booking.id] });
    });

    it('convite pendente vira convite direto à conta, com a notificação de convite', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ name: 'Quésia', email: 'quesia@exemplo.com' }],
      });
      const account = await signUp(t, 'quesia@exemplo.com', 'Quésia');
      await verifyEmail(t, 'quesia@exemplo.com');
      expect(await participant(guests(detail)[0]?.id ?? '')).toMatchObject({
        userId: account.id,
        status: 'INVITED',
      });
      const { items } = await inbox(t, account);
      expect(items.find((i) => i.type === 'BOOKING_INVITE')?.data).toMatchObject({
        bookingId: booking.id,
        inviteToken: tokenOf(detail),
      });
      expect(await mineIds(t, account)).not.toContain(booking.id);
    });

    it('reserva cancelada ou terminada não muda; só o contato ganha a conta', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Rita',
        email: 'rita@exemplo.com',
      }).expect(200);
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));

      const account = await signUp(t, 'rita@exemplo.com', 'Rita');
      await verifyEmail(t, 'rita@exemplo.com');
      expect((await contactByEmail('rita@exemplo.com'))?.userId).toBe(account.id);
      expect((await participant(guests(detail)[0]?.id ?? ''))?.userId).toBeNull();
      const { items } = await inbox(t, account);
      expect(items.filter((i) => i.type === 'BOOKING_LINKED')).toHaveLength(0);
    });

    it('convite que chegou só pelo telefone não vai para quem verificar o e-mail do contato', async () => {
      // O atacante cria o contato com o próprio e-mail e o telefone da vítima.
      const first = await bookNext();
      await invite(t, organizer, first.id, {
        items: [{ email: 'mallory@exemplo.com', phone: '+5531911110001' }],
      });
      // Outro convite cita só o telefone, e cai no mesmo contato.
      const second = await bookNext();
      const detail = await invite(t, organizer, second.id, {
        items: [{ phone: '+5531911110001' }],
      });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Vítima',
        phone: '+5531911110001',
      }).expect(200);

      const mallory = await signUp(t, 'mallory@exemplo.com', 'Mallory');
      await verifyEmail(t, 'mallory@exemplo.com');
      expect((await participant(guests(detail)[0]?.id ?? ''))?.userId).toBeNull();
      expect(await mineIds(t, mallory)).not.toContain(second.id);
    });

    it('a conta que já está na reserva não duplica a linha', async () => {
      const account = await signUp(t, 'sara@exemplo.com', 'Sara');
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        userIds: [account.id],
        items: [{ email: 'sara@exemplo.com' }],
      });
      await verifyEmail(t, 'sara@exemplo.com');
      const byEmail = guests(detail).find((g) => g.name === null);
      expect((await participant(byEmail?.id ?? ''))?.userId).toBeNull();
    });

    it('contato criado depois da verificação nasce com a conta, mas o convite não é dela', async () => {
      const account = await signUp(t, 'tais@exemplo.com', 'Taís');
      await verifyEmail(t, 'tais@exemplo.com');
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ email: 'tais@exemplo.com' }],
      });
      expect((await contactByEmail('tais@exemplo.com'))?.userId).toBe(account.id);
      expect(await participant(guests(detail)[0]?.id ?? '')).toMatchObject({
        userId: null,
        contactViaEmail: false,
      });
    });

    it('conta verificada: confirmar com o e-mail dela e update-user não vinculam o convite', async () => {
      const account = await signUp(t, 'verificada@exemplo.com', 'Verificada');
      await verifyEmail(t, 'verificada@exemplo.com');
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Impostor',
        email: 'verificada@exemplo.com',
      }).expect(200);
      const guestId = guests(detail)[0]?.id ?? '';

      await updateUser(account, 'Nome Novo');

      expect(await participant(guestId)).toMatchObject({
        userId: null,
        contactViaEmail: false,
      });
      expect(await mineIds(t, account)).not.toContain(booking.id);
      const { items } = await inbox(t, account);
      expect(items.filter((i) => i.data?.bookingId === booking.id)).toEqual([]);
    });

    it('o evento só sai na transição: uma vez ao verificar, nunca em outro update', async () => {
      const seen: string[] = [];
      t.app.get(DomainEvents).subscribe('user.email_verified', async ({ userId }) => {
        seen.push(userId);
      });
      const account = await signUp(t, 'transicao@exemplo.com', 'Transição');
      const events = () => seen.filter((id) => id === account.id);

      await updateUser(account, 'Antes de Verificar');
      expect(events()).toHaveLength(0);

      await verifyEmail(t, 'transicao@exemplo.com');
      expect(events()).toHaveLength(1);

      await updateUser(account, 'Depois de Verificar');
      // O login social reenvia `emailVerified: true` para quem já está verificado.
      const context = await (t.app.get(AUTH) as Auth).$context;
      await context.internalAdapter.updateUser(account.id, { emailVerified: true });
      expect(events()).toHaveLength(1);
    });

    it('conta que já nasce verificada, no login social, leva os convites feitos antes', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Vitória',
        email: 'vitoria@exemplo.com',
      }).expect(200);
      const context = await (t.app.get(AUTH) as Auth).$context;
      const created = await context.internalAdapter.createUser(
        { name: 'Vitória', email: 'vitoria@exemplo.com', emailVerified: true },
        { method: 'oauth' },
      );
      expect((await participant(guests(detail)[0]?.id ?? ''))?.userId).toBe(created.id);
    });

    it('vale para a conta que verificou ao entrar por login social (update do Better Auth)', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), {
        name: 'Úrsula',
        email: 'ursula@exemplo.com',
      }).expect(200);
      const account = await signUp(t, 'ursula@exemplo.com', 'Úrsula');
      // O que o Better Auth faz ao ligar a conta social: `updateUser` com o e-mail verificado.
      const auth = t.app.get(AUTH) as Auth;
      const context = await auth.$context;
      await context.internalAdapter.updateUser(account.id, { emailVerified: true });
      expect((await participant(guests(detail)[0]?.id ?? ''))?.userId).toBe(account.id);
    });
  });

  describe('telefone', () => {
    const phone = '+5531922220001';
    let owner: SignedUp;

    beforeAll(async () => {
      owner = await signUp(t, 'dono-do-telefone@exemplo.com', 'Vera Lúcia Campos');
      await verifyPhone(t, owner, phone);
    });

    const confirmLink = (
      bookingId: string,
      participantId: string,
      userId: string,
      user = organizer,
    ) =>
      t
        .http()
        .post(`/v1/bookings/${bookingId}/invites/${participantId}/confirm-link`)
        .set(...bearer(user))
        .send({ userId });

    it('não vincula sozinho: o organizador vê a sugestão com id e primeiro nome', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ name: 'Vera', phone }],
      });
      expect((await contactByPhone(phone))?.userId).toBeNull();
      const [guest] = guests(detail);
      expect((await participant(guest?.id ?? ''))?.userId).toBeNull();
      expect(await mineIds(t, owner)).not.toContain(booking.id);
      expect(guest?.suggestedUser).toEqual({ id: owner.id, firstName: 'Vera' });
    });

    it('confirmar a presença com o telefone também não vincula', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), { name: 'Vera', phone }).expect(200);
      expect(await mineIds(t, owner)).not.toContain(booking.id);
      const after = await myDetail(t, organizer, booking.id);
      expect(guests(after)[0]?.suggestedUser?.id).toBe(owner.id);
    });

    it('a sugestão usa só o telefone informado na reserva, não o que veio de outro espaço', async () => {
      const elsewhere = await createSpace(t.db, 'arena-origem');
      const first = await book(t, organizer, elsewhere, nextHours());
      const informed = await invite(t, organizer, first.id, { items: [{}] });
      await confirmPublic(t, tokenOf(informed), {
        name: 'Vera',
        email: 'vera@exemplo.com',
        phone,
      }).expect(200);

      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ email: 'vera@exemplo.com' }],
      });
      const [guest] = guests(detail);
      expect(guest?.suggestedUser).toBeNull();
      await confirmLink(booking.id, guest?.id ?? '', owner.id).expect(409);
    });

    it('quem confirma é o organizador: outra conta não vincula, conta errada é recusada', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{ phone }] });
      const guest = guests(detail)[0]?.id ?? '';

      await confirmLink(booking.id, guest, owner.id, teacher).expect(404);
      const wrong = await confirmLink(booking.id, guest, organizer.id).expect(409);
      expect(wrong.body.error.code).toBe('SUGGESTED_USER_MISMATCH');

      const res = await confirmLink(booking.id, guest, owner.id).expect(200);
      expect(res.body.participants.find((p: { id: string }) => p.id === guest).suggestedUser).toBe(
        null,
      );
      expect(await participant(guest)).toMatchObject({ userId: owner.id, status: 'INVITED' });
      expect((await contactByPhone(phone))?.userId).toBe(owner.id);
      const { items } = await inbox(t, owner);
      expect(items.find((i) => i.type === 'BOOKING_INVITE')?.data).toMatchObject({
        bookingId: booking.id,
      });
      const [log] = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'contact.link_phone'), eq(auditLogs.actorId, organizer.id)),
        );
      expect(log?.diff).toMatchObject({ bookingId: booking.id, userId: owner.id });
    });

    it('participante confirmado passa a ver a reserva em Minhas reservas', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      await confirmPublic(t, tokenOf(detail), { name: 'Vera', phone }).expect(200);
      await confirmLink(booking.id, guests(detail)[0]?.id ?? '', owner.id).expect(200);
      expect(await mineIds(t, owner)).toContain(booking.id);
    });

    it('não há sugestão para quem não organiza, nem de quem já está na reserva', async () => {
      const friend = await signUp(t, 'wagner@exemplo.com', 'Wagner');
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        userIds: [friend.id],
        items: [{ phone }],
      });
      await t
        .http()
        .post(`/v1/invites/${guests(detail).find((g) => g.name === 'Wagner')?.inviteToken}/accept`)
        .set(...bearer(friend))
        .expect(200);
      const seen = await myDetail(t, friend, booking.id);
      expect(seen.participants.every((p) => p.suggestedUser === null)).toBe(true);

      await invite(t, organizer, booking.id, { userIds: [owner.id] });
      const full = await myDetail(t, organizer, booking.id);
      expect(full.participants.every((p) => p.suggestedUser === null)).toBe(true);
    });

    it('conta inativa ou telefone sem verificação não geram sugestão', async () => {
      const inactive = await signUp(t, 'xenia@exemplo.com', 'Xênia');
      await t.db
        .update(users)
        .set({ phone: '+5531922220002', phoneVerified: true, status: 'INACTIVE' })
        .where(eq(users.id, inactive.id));
      const unverified = await signUp(t, 'yuri@exemplo.com', 'Yuri');
      await t.db.update(users).set({ phone: '+5531922220003' }).where(eq(users.id, unverified.id));
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ phone: '+5531922220002' }, { phone: '+5531922220003' }],
      });
      expect(guests(detail).map((g) => g.suggestedUser)).toEqual([null, null]);
    });

    it('reserva cancelada: sem sugestão, e a confirmação só liga o contato', async () => {
      const other = await signUp(t, 'zeca@exemplo.com', 'Zeca');
      const otherPhone = '+5531922220004';
      await verifyPhone(t, other, otherPhone);
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [{ phone: otherPhone }],
      });
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));

      const after = await myDetail(t, organizer, booking.id);
      expect(guests(after)[0]?.suggestedUser).toBeNull();

      const guest = guests(detail)[0]?.id ?? '';
      await confirmLink(booking.id, guest, other.id).expect(200);
      expect((await participant(guest))?.userId).toBeNull();
      expect((await contactByPhone(otherPhone))?.userId).toBe(other.id);
    });
  });

  describe('telefone do cadastro (não verificado, decisão 64)', () => {
    // Quem se cadastra digita o telefone sem prova: igual ao de um contato, ele não vincula, não
    // gera sugestão, não resgata a vaga e não apaga o contato na exclusão da conta (decisão 48).
    const phone = '+5531955550001';
    let typed: SignedUp;

    beforeAll(async () => {
      typed = await signUp(t, 'digitou@exemplo.com', 'Digitou Telefone', phone);
      const [row] = await t.db.select().from(users).where(eq(users.id, typed.id));
      expect(row).toMatchObject({ phone, phoneVerified: false });
    });

    it('convite pelo telefone: sem sugestão e a confirmação manual é recusada', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{ phone }] });
      const guest = guests(detail)[0];
      expect(guest?.suggestedUser).toBeNull();
      expect(guests(await myDetail(t, organizer, booking.id))[0]?.suggestedUser).toBeNull();

      const res = await t
        .http()
        .post(`/v1/bookings/${booking.id}/invites/${guest?.id}/confirm-link`)
        .set(...bearer(organizer))
        .send({ userId: typed.id })
        .expect(409);
      expect(res.body.error.code).toBe('SUGGESTED_USER_MISMATCH');
      expect((await contactByPhone(phone))?.userId).toBeNull();
    });

    it('vaga confirmada sem conta com esse telefone não é resgatada pela conta', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Dono do Número', phone }).expect(200);

      const res = await t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(typed))
        .expect(409);
      expect(res.body.error.code).toBe('INVITE_SLOT_TAKEN');
      expect((await contactByPhone(phone))?.userId).toBeNull();
    });

    it('balcão com esse telefone: a gestão não vê sugestão nem consegue vincular', async () => {
      const res = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          startsAt: slotIn(nextHours() * 60).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Cliente do Balcão',
          guestPhone: phone,
        })
        .expect(201);
      expect(res.body.suggestedUser).toBeNull();
      const confirm = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${res.body.id}/confirm-link`)
        .set(...bearer(admin))
        .send({ userId: typed.id })
        .expect(409);
      expect(confirm.body.error.code).toBe('SUGGESTED_USER_MISMATCH');
    });

    it('a exclusão da conta não apaga o contato com o mesmo telefone', async () => {
      const contact = await contactByPhone(phone);
      expect(contact).toBeDefined();
      await t.db.transaction((tx) => anonymizeUser(tx, typed.id));
      expect((await contactByPhone(phone))?.id).toBe(contact?.id);
    });
  });

  describe('balcão', () => {
    const phone = '+5531933330001';
    let customer: SignedUp;

    beforeAll(async () => {
      customer = await signUp(t, 'cliente@exemplo.com', 'Beatriz Nunes');
      await verifyPhone(t, customer, phone);
    });

    const desk = async (extra: Record<string, unknown> = {}) => {
      const res = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          startsAt: slotIn(nextHours() * 60).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Bia do Balcão',
          guestPhone: phone,
          ...extra,
        })
        .expect(201);
      return res.body as { id: string; suggestedUser: unknown };
    };
    const staffDetail = (bookingId: string, user = admin) =>
      t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings/${bookingId}`)
        .set(...bearer(user))
        .expect(200);
    const confirmLink = (bookingId: string, userId: string, user = admin) =>
      t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${bookingId}/confirm-link`)
        .set(...bearer(user))
        .send({ userId });

    it('gera contato com touchpoint do espaço, e o telefone não vincula sozinho', async () => {
      const booking = await desk();
      const contact = await contactByPhone(phone);
      expect(contact).toMatchObject({ name: 'Bia do Balcão', userId: null });
      expect(
        await t.db
          .select()
          .from(contactTouchpoints)
          .where(eq(contactTouchpoints.bookingId, booking.id)),
      ).toMatchObject([{ origin: 'DESK_BOOKING', spaceId: space.id, capturedBy: admin.id }]);
      expect(await mineIds(t, customer)).not.toContain(booking.id);
    });

    it('a gestão vê a sugestão na visualização da reserva e confirma; o Professor não vê', async () => {
      const booking = await desk();
      const seen = await staffDetail(booking.id);
      expect(seen.body.suggestedUser).toEqual({ id: customer.id, firstName: 'Beatriz' });
      expect(seen.body.organizer.userId).toBeNull();
      expect((await staffDetail(booking.id, teacher)).body.suggestedUser).toBeNull();

      await confirmLink(booking.id, customer.id, teacher).expect(403);
      const wrong = await confirmLink(booking.id, admin.id).expect(409);
      expect(wrong.body.error.code).toBe('SUGGESTED_USER_MISMATCH');

      const res = await confirmLink(booking.id, customer.id).expect(200);
      expect(res.body.organizer.userId).toBe(customer.id);
      expect(res.body.suggestedUser).toBeNull();
      expect(await mineIds(t, customer)).toContain(booking.id);
      const { items } = await inbox(t, customer);
      expect(items.find((i) => i.type === 'BOOKING_LINKED')?.data).toMatchObject({
        bookingId: booking.id,
      });
    });

    it('outro espaço não confirma', async () => {
      const booking = await desk({ guestPhone: phone });
      const other = await createSpace(t.db, 'arena-outra');
      const stranger = await member(t, 'estranha@exemplo.com', other.id, 'ADMIN');
      const res = await t
        .http()
        .post(`/v1/manage/spaces/${other.id}/bookings/${booking.id}/confirm-link`)
        .set(...bearer(stranger))
        .send({ userId: customer.id })
        .expect(404);
      expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    });

    it('mensalista de balcão gera contato, e confirmar numa ocorrência vale para o mensalista', async () => {
      const recurringPhone = '+5531933330002';
      const client = await signUp(t, 'mensal@exemplo.com', 'Mensalista');
      await verifyPhone(t, client, recurringPhone);
      const res = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/recurring-bookings`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtB,
          sportId: space.sportId,
          weekday: new Date().getDay(),
          startTime: '23:00',
          durationMin: 30,
          peopleCount: 4,
          guestName: 'Sem App',
          guestPhone: recurringPhone,
        })
        .expect(201);
      expect(res.body.customer.userId).toBeNull();
      const contact = await contactByPhone(recurringPhone);
      expect(contact?.userId).toBeNull();
      expect(
        await t.db
          .select()
          .from(contactTouchpoints)
          .where(eq(contactTouchpoints.contactId, contact?.id ?? '')),
      ).toMatchObject([{ origin: 'RECURRING_DESK', spaceId: space.id, bookingId: null }]);

      const occurrences = await t.db
        .select()
        .from(bookings)
        .where(eq(bookings.recurringBookingId, res.body.id));
      expect(occurrences.length).toBeGreaterThan(1);
      const first = occurrences[0]?.id ?? '';
      expect((await staffDetail(first)).body.suggestedUser?.id).toBe(client.id);

      await confirmLink(first, client.id).expect(200);
      const [recurring] = await t.db
        .select()
        .from(recurringBookings)
        .where(eq(recurringBookings.id, res.body.id));
      expect(recurring?.userId).toBe(client.id);
      const after = await t.db
        .select()
        .from(bookings)
        .where(eq(bookings.recurringBookingId, res.body.id));
      expect(after.every((b) => b.organizerUserId === client.id)).toBe(true);
    });

    it('reserva terminada: só o contato é vinculado', async () => {
      const donePhone = '+5531933330003';
      const client = await signUp(t, 'terminada@exemplo.com', 'Terminada');
      await verifyPhone(t, client, donePhone);
      const booking = await desk({ guestPhone: donePhone });
      await t.db.update(bookings).set({ status: 'COMPLETED' }).where(eq(bookings.id, booking.id));
      expect((await staffDetail(booking.id)).body.suggestedUser).toBeNull();
      const res = await confirmLink(booking.id, client.id).expect(200);
      expect(res.body.organizer.userId).toBeNull();
      expect((await contactByPhone(donePhone))?.userId).toBe(client.id);
    });
  });
});

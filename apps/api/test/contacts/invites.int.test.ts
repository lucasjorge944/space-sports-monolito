import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingParticipants,
  bookings,
  contacts,
  contactTouchpoints,
  users,
} from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp, WEB_ORIGIN } from '../auth/helpers.js';
import { bearer, createSpace, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { inbox } from '../notifications/helpers.js';
import { book, confirmPublic, guests, invite, myDetail, tokenOf, verifyPhone } from './helpers.js';

useMiddayClock();

describe('convite com contato e página pública (RF-CONTACT-01 a RF-CONTACT-03)', () => {
  let t: TestApp;
  let space: Space;
  let organizer: SignedUp;
  let friend: SignedUp;
  let hours = 24;
  const nextHours = () => {
    hours += 2;
    return hours;
  };

  const bookNext = (people = 4) => book(t, organizer, space, nextHours(), people);
  const contactByPhone = async (phone: string) =>
    (await t.db.select().from(contacts).where(eq(contacts.phone, phone)))[0];
  const contactByEmail = async (email: string) =>
    (await t.db.select().from(contacts).where(eq(contacts.email, email)))[0];
  const participantByToken = async (token: string) =>
    (
      await t.db
        .select()
        .from(bookingParticipants)
        .where(eq(bookingParticipants.inviteToken, token))
    )[0];
  const touchpoints = (contactId: string) =>
    t.db.select().from(contactTouchpoints).where(eq(contactTouchpoints.contactId, contactId));

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-contatos');
    organizer = await signUp(t, 'organizadora@exemplo.com', 'Marina de Souza Lima');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');
  });
  afterAll(() => t.close());

  it('o link do convite é https no web, e names e userIds seguem funcionando', async () => {
    const booking = await bookNext();
    const detail = await invite(t, organizer, booking.id, {
      names: ['Ana'],
      userIds: [friend.id],
      items: [{ name: 'Bruno', phone: '+5531900000001' }],
    });
    const invited = guests(detail);
    expect(invited).toHaveLength(3);
    for (const guest of invited) {
      expect(guest.inviteUrl).toBe(`${WEB_ORIGIN}/r/${guest.inviteToken}`);
    }
    expect(invited.map((g) => g.name).sort()).toEqual(['Amigo', 'Ana', 'Bruno']);
  });

  it('item com WhatsApp ou e-mail gera contato e touchpoint do espaço', async () => {
    const booking = await bookNext();
    const detail = await invite(t, organizer, booking.id, {
      items: [{ name: 'Carla', phone: '+5531900000002' }, { email: 'Duda@Exemplo.com' }],
    });
    const carla = await contactByPhone('+5531900000002');
    expect(carla).toMatchObject({ name: 'Carla', email: null, userId: null });
    expect(carla?.marketingConsentAt).toBeNull();
    expect(await touchpoints(carla?.id ?? '')).toMatchObject([
      {
        origin: 'BOOKING_INVITE_ORGANIZER',
        spaceId: space.id,
        bookingId: booking.id,
        capturedBy: organizer.id,
      },
    ]);
    const duda = await contactByEmail('duda@exemplo.com');
    expect(duda).toMatchObject({ name: null, phone: null });
    const byEmail = guests(detail).find((g) => g.name === null);
    expect(await participantByToken(byEmail?.inviteToken ?? '')).toMatchObject({
      contactId: duda?.id,
      contactViaEmail: true,
    });
  });

  it('item vazio é vaga aberta, sem contato; o limite conta todos os convites', async () => {
    const booking = await bookNext(3);
    const detail = await invite(t, organizer, booking.id, { items: [{}] });
    expect(await participantByToken(tokenOf(detail))).toMatchObject({
      name: null,
      contactId: null,
    });
    await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['A'], items: [{}] })
      .expect(422);
    await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ items: [] })
      .expect(400);
  });

  describe('prévia pública', () => {
    it('mostra só o mínimo: sem telefone, e-mail, outros convidados ou ids', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, {
        items: [
          { name: 'Convidada Secreta', phone: '+5531900000003', email: 'secreta@exemplo.com' },
          { name: 'Outro Convidado', phone: '+5531900000004' },
        ],
      });
      const token = tokenOf(detail);
      const res = await t.http().get(`/v1/public/invites/${token}`).expect(200);
      const invitee = guests(detail)[0];
      expect(res.body).toEqual({
        status: 'INVITED',
        canAnswer: true,
        accountRequired: false,
        slotTaken: false,
        shareCents: 2_500,
        booking: {
          space: {
            name: 'Espaço arena-contatos',
            slug: 'arena-contatos',
            timeZone: 'America/Sao_Paulo',
          },
          court: { name: 'Quadra A' },
          sport: { name: 'Futevôlei', slug: 'futevolei' },
          startsAt: expect.any(String),
          endsAt: expect.any(String),
          status: 'CONFIRMED',
          organizerFirstName: 'Marina',
        },
      });
      const text = JSON.stringify(res.body);
      for (const secret of [
        '+5531900000003',
        '+5531900000004',
        'secreta@exemplo.com',
        'Convidada Secreta',
        'Outro Convidado',
        'Souza',
        organizer.email,
        organizer.id,
        booking.id,
        space.id,
        invitee?.id ?? '',
        token,
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it('token desconhecido responde 404', async () => {
      const res = await t.http().get('/v1/public/invites/nao-existe').expect(404);
      expect(res.body.error.code).toBe('INVITE_NOT_FOUND');
    });
  });

  describe('confirmar sem conta', () => {
    it('fica ACCEPTED sem conta, ligado ao contato, e avisa o organizador', async () => {
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}] });
      const token = tokenOf(detail);
      const res = await confirmPublic(t, token, {
        name: 'Elisa Prado',
        phone: '+5531900000005',
        marketingConsent: true,
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'ACCEPTED', canAnswer: false });

      const contact = await contactByPhone('+5531900000005');
      expect(contact).toMatchObject({ name: 'Elisa Prado', userId: null });
      expect(contact?.marketingConsentAt).toBeInstanceOf(Date);
      expect(await touchpoints(contact?.id ?? '')).toMatchObject([
        { origin: 'BOOKING_INVITE_SELF', spaceId: space.id, capturedBy: null },
      ]);
      expect(await participantByToken(token)).toMatchObject({
        status: 'ACCEPTED',
        userId: null,
        name: 'Elisa Prado',
        contactId: contact?.id,
      });

      const { items } = await inbox(t, organizer);
      expect(items.find((i) => i.type === 'BOOKING_INVITE_ANSWERED')).toMatchObject({
        title: 'Convite confirmado',
        body: expect.stringContaining('Elisa Prado confirmou presença'),
        data: expect.objectContaining({ bookingId: booking.id }),
      });
    });

    it('confirmar de novo não muda nada e não avisa duas vezes', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Fábio', email: 'fabio@exemplo.com' }).expect(200);
      const before = (await inbox(t, organizer)).items.length;
      const contact = await contactByEmail('fabio@exemplo.com');
      await confirmPublic(t, token, { name: 'Fábio Corrigido', email: 'Fabio@Exemplo.com' })
        .expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ status: 'ACCEPTED' }));
      expect((await participantByToken(token))?.name).toBe('Fábio');
      expect(await touchpoints(contact?.id ?? '')).toHaveLength(1);
      expect((await inbox(t, organizer)).items).toHaveLength(before);
    });

    it('consentimento é opt-in; sem a caixa marcada fica nulo', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Gil', phone: '+5531900000006' }).expect(200);
      expect((await contactByPhone('+5531900000006'))?.marketingConsentAt).toBeNull();
    });

    it('exige nome e WhatsApp ou e-mail', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Sem Contato' }).expect(400);
      await confirmPublic(t, token, { phone: '+5531900000007' }).expect(400);
      await confirmPublic(t, token, { name: 'Telefone Ruim', phone: '31999' }).expect(400);
    });

    it('convite direto a uma conta só ela responde', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { userIds: [friend.id] }));
      const preview = await t.http().get(`/v1/public/invites/${token}`).expect(200);
      expect(preview.body).toMatchObject({ canAnswer: false, accountRequired: true });
      await confirmPublic(t, token, { name: 'Intruso', phone: '+5531900000008' }).expect(409);
      await t.http().post(`/v1/public/invites/${token}/decline`).expect(409);
      expect(await contactByPhone('+5531900000008')).toBeUndefined();
    });

    it('reserva cancelada não aceita resposta', async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));
      const preview = await t.http().get(`/v1/public/invites/${token}`).expect(200);
      expect(preview.body).toMatchObject({ canAnswer: false });
      expect(preview.body.booking.status).toBe('CANCELLED');
      await confirmPublic(t, token, { name: 'Tarde', phone: '+5531900000009' }).expect(409);
    });

    it('e-mail de conta verificada não vincula o convite de quem digitou', async () => {
      await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, friend.id));
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Impostor', email: friend.email }).expect(200);
      expect(await participantByToken(token)).toMatchObject({
        status: 'ACCEPTED',
        userId: null,
        contactViaEmail: false,
      });
      expect(await myDetail(t, organizer, booking.id)).toBeTruthy();
      await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(friend))
        .expect(404);
    });
  });

  describe('vaga já confirmada por outra pessoa', () => {
    const accept = (user: SignedUp, token: string) =>
      t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(user));
    const openInvite = async () => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      return { booking, token };
    };
    const expectSlotTaken = async (token: string, body: Record<string, unknown>) => {
      const res = await confirmPublic(t, token, body).expect(409);
      expect(res.body.error.code).toBe('INVITE_SLOT_TAKEN');
    };
    const answersOf = async (bookingId: string) =>
      (await inbox(t, organizer)).items.filter(
        (item) =>
          item.type === 'BOOKING_INVITE_ANSWERED' &&
          (item.data as { bookingId?: string }).bookingId === bookingId,
      );

    /** Espera `count` conexões paradas numa trava. */
    const waitForLockWaiters = async (count: number) => {
      for (let attempt = 0; attempt < 250; attempt++) {
        const { rows } = await t.db.execute<{ waiting: number }>(
          sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if ((rows[0]?.waiting ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('As confirmações não chegaram às travas.');
    };

    /**
     * Segura a reserva e o convite até todas as confirmações pararem no banco, e só então solta:
     * elas disputam a vaga de verdade, em vez de chegarem uma depois da outra.
     */
    const race = async (bookingId: string, token: string, bodies: Record<string, unknown>[]) => {
      const { responses } = await t.db.transaction(async (tx) => {
        await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(eq(bookings.id, bookingId))
          .for('update');
        await tx
          .select({ id: bookingParticipants.id })
          .from(bookingParticipants)
          .where(eq(bookingParticipants.inviteToken, token))
          .for('update');
        const responses = Promise.all(bodies.map((body) => confirmPublic(t, token, body)));
        await waitForLockWaiters(bodies.length);
        // Dentro de um objeto: esperar aqui seguraria a trava que as confirmações aguardam.
        return { responses };
      });
      return responses;
    };

    it('outro contato é recusado, sem entrar na base e sem avisar o organizador', async () => {
      const { booking, token } = await openInvite();
      await confirmPublic(t, token, { name: 'Primeira', phone: '+5531900000020' }).expect(200);
      const holder = await participantByToken(token);

      await expectSlotTaken(token, {
        name: 'Segunda',
        phone: '+5531900000021',
        email: 'segunda@exemplo.com',
        marketingConsent: true,
      });

      expect(await participantByToken(token)).toEqual(holder);
      expect(await contactByPhone('+5531900000021')).toBeUndefined();
      expect(await contactByEmail('segunda@exemplo.com')).toBeUndefined();
      expect(await answersOf(booking.id)).toHaveLength(1);
    });

    it('a prévia indica a vaga ocupada, sem dizer quem ficou com ela', async () => {
      const { token } = await openInvite();
      await confirmPublic(t, token, { name: 'Dona da Vaga', phone: '+5531900000022' }).expect(200);
      const res = await t.http().get(`/v1/public/invites/${token}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'ACCEPTED',
        canAnswer: false,
        accountRequired: false,
        slotTaken: true,
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Dona da Vaga');
      expect(text).not.toContain('+5531900000022');
    });

    it('a mesma pessoa repete só com o telefone ou só com o e-mail', async () => {
      const { token } = await openInvite();
      const phone = '+5531900000023';
      const email = 'repete@exemplo.com';
      await confirmPublic(t, token, { name: 'Repete', phone, email }).expect(200);
      await confirmPublic(t, token, { name: 'Repete', phone }).expect(200);
      await confirmPublic(t, token, { name: 'Repete', email: 'REPETE@exemplo.com' }).expect(200);
      await confirmPublic(t, token, {
        name: 'Repete',
        phone,
        email: 'outro-email@exemplo.com',
      }).expect(200);
      expect(await contactByEmail('outro-email@exemplo.com')).toBeUndefined();
    });

    it('telefone que não entrou no contato ainda identifica quem confirmou', async () => {
      // O telefone já é de outro contato: fica só no touchpoint (RN-CONTACT-02).
      const phone = '+5531900000024';
      const first = await bookNext();
      await invite(t, organizer, first.id, { items: [{ name: 'Dona do Telefone', phone }] });
      const { token } = await openInvite();
      await confirmPublic(t, token, {
        name: 'Tem E-mail',
        email: 'tem-email@exemplo.com',
        phone,
      }).expect(200);
      expect(await contactByEmail('tem-email@exemplo.com')).toMatchObject({ phone: null });
      await confirmPublic(t, token, { name: 'Tem E-mail', phone }).expect(200);
    });

    it('telefone digitado só pelo organizador não identifica quem confirmou', async () => {
      const phone = '+5531900000025';
      const first = await bookNext();
      await invite(t, organizer, first.id, { items: [{ name: 'Dona do Telefone', phone }] });
      const booking = await bookNext();
      const token = tokenOf(
        await invite(t, organizer, booking.id, {
          items: [{ name: 'Lia', email: 'lia@exemplo.com', phone }],
        }),
      );
      await confirmPublic(t, token, { name: 'Lia', email: 'lia@exemplo.com' }).expect(200);
      await expectSlotTaken(token, { name: 'Dona do Telefone', phone });
    });

    it('o e-mail do convite e o telefone que completou o contato são da mesma pessoa', async () => {
      const booking = await bookNext();
      const token = tokenOf(
        await invite(t, organizer, booking.id, { items: [{ email: 'nina@exemplo.com' }] }),
      );
      await confirmPublic(t, token, { name: 'Nina', phone: '+5531900000026' }).expect(200);
      await confirmPublic(t, token, { name: 'Nina', email: 'nina@exemplo.com' }).expect(200);
      await expectSlotTaken(token, { name: 'Outra', email: 'outra-nina@exemplo.com' });
    });

    it('vaga que passou para uma conta segue ocupada, e quem confirmou ainda repete', async () => {
      const guest = await signUp(t, 'olivia@exemplo.com', 'Olívia');
      await verifyPhone(t, guest, '+5531900000027');
      const { token } = await openInvite();
      await confirmPublic(t, token, { name: 'Olívia', phone: '+5531900000027' }).expect(200);
      await accept(guest, token).expect(200);
      await expectSlotTaken(token, { name: 'Outra', phone: '+5531900000028' });
      await confirmPublic(t, token, { name: 'Olívia', phone: '+5531900000027' }).expect(200);
      expect(await participantByToken(token)).toMatchObject({ userId: guest.id });
    });

    it('vaga aceita por uma conta, sem contato, está ocupada para qualquer contato', async () => {
      const guest = await signUp(t, 'paula@exemplo.com', 'Paula');
      const { token } = await openInvite();
      await accept(guest, token).expect(200);
      await expectSlotTaken(token, { name: 'Outra', phone: '+5531900000029' });
    });

    it('sem o contato apagado, nada identifica a pessoa e a vaga segue ocupada', async () => {
      const { token } = await openInvite();
      const phone = '+5531900000030';
      await confirmPublic(t, token, { name: 'Quer Sair', phone }).expect(200);
      await t.db.delete(contacts).where(eq(contacts.phone, phone));
      await expectSlotTaken(token, { name: 'Quer Sair', phone });
      expect(await contactByPhone(phone)).toBeUndefined();
    });

    it('em reserva cancelada, outro contato recebe indisponível e quem confirmou repete', async () => {
      const { booking, token } = await openInvite();
      const body = { name: 'Rita', phone: '+5531900000031' };
      await confirmPublic(t, token, body).expect(200);
      await t.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, booking.id));
      const res = await confirmPublic(t, token, { name: 'Outra', phone: '+5531900000032' }).expect(
        409,
      );
      expect(res.body.error.code).toBe('INVITE_UNAVAILABLE');
      await confirmPublic(t, token, body).expect(200);
    });

    it('recusado continua indisponível, não ocupado', async () => {
      const { token } = await openInvite();
      await t.http().post(`/v1/public/invites/${token}/decline`).expect(200);
      const res = await confirmPublic(t, token, { name: 'Tarde', phone: '+5531900000033' }).expect(
        409,
      );
      expect(res.body.error.code).toBe('INVITE_UNAVAILABLE');
    });

    it('confirmação concorrente: uma pessoa fica com a vaga e as outras são recusadas', async () => {
      const { booking, token } = await openInvite();
      const phones = Array.from(
        { length: 8 },
        (_, i) => `+55319000001${String(i).padStart(2, '0')}`,
      );
      const responses = await race(
        booking.id,
        token,
        phones.map((phone, i) => ({ name: `Pessoa ${i}`, phone })),
      );

      const won = responses.flatMap((res, i) => (res.status === 200 ? [i] : []));
      expect(won).toHaveLength(1);
      const lost = responses.filter((res) => res.status !== 200);
      expect(lost.map((res) => [res.status, res.body.error?.code])).toEqual(
        lost.map(() => [409, 'INVITE_SLOT_TAKEN']),
      );

      const winner = won[0] ?? -1;
      const contact = await contactByPhone(phones[winner] ?? '');
      expect(await participantByToken(token)).toMatchObject({
        status: 'ACCEPTED',
        name: `Pessoa ${winner}`,
        contactId: contact?.id,
      });
      for (const [i, phone] of phones.entries()) {
        if (i !== winner) expect(await contactByPhone(phone)).toBeUndefined();
      }
      expect(await answersOf(booking.id)).toHaveLength(1);
    });

    it('confirmação concorrente da mesma pessoa vale uma vez só', async () => {
      const { booking, token } = await openInvite();
      const phone = '+5531900000034';
      const responses = await race(
        booking.id,
        token,
        Array.from({ length: 5 }, () => ({ name: 'Clique Duplo', phone })),
      );
      expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
      const contact = await contactByPhone(phone);
      expect(await touchpoints(contact?.id ?? '')).toHaveLength(1);
      expect(await answersOf(booking.id)).toHaveLength(1);
    });
  });

  it('recusar sem conta não pede dados e avisa o organizador', async () => {
    const booking = await bookNext();
    const detail = await invite(t, organizer, booking.id, { names: ['Helena'] });
    const res = await t
      .http()
      .post(`/v1/public/invites/${tokenOf(detail)}/decline`)
      .expect(200);
    expect(res.body).toMatchObject({ status: 'DECLINED', canAnswer: false });
    const { items } = await inbox(t, organizer);
    expect(items.find((i) => i.title === 'Convite recusado')).toMatchObject({
      body: expect.stringContaining('Helena recusou o convite'),
    });
  });

  describe('aceite com sessão', () => {
    const accept = (user: SignedUp, token: string) =>
      t
        .http()
        .post(`/v1/invites/${token}/accept`)
        .set(...bearer(user));

    it('vincula o convite e o contato à conta e audita', async () => {
      const guest = await signUp(t, 'ines@exemplo.com', 'Inês');
      const booking = await bookNext();
      const token = tokenOf(
        await invite(t, organizer, booking.id, {
          items: [{ name: 'Inês', phone: '+5531900000010' }],
        }),
      );
      await accept(guest, token).expect(200);
      const contact = await contactByPhone('+5531900000010');
      expect(contact?.userId).toBe(guest.id);
      expect(await participantByToken(token)).toMatchObject({
        userId: guest.id,
        status: 'ACCEPTED',
      });
      const audited = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'contact.link_invite'));
      expect(audited.map((row) => row.entityId)).toContain(contact?.id);
    });

    const previewOf = (user: SignedUp, token: string) =>
      t
        .http()
        .get(`/v1/invites/${token}`)
        .set(...bearer(user))
        .expect(200);
    const confirmedInvite = async (body: Record<string, unknown>) => {
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await confirmPublic(t, token, { name: 'Quem confirmou', ...body }).expect(200);
      return { booking, token };
    };
    const expectSlotTaken = async (user: SignedUp, token: string) => {
      const preview = await previewOf(user, token);
      expect(preview.body).toMatchObject({ acceptedByMe: false, slotTaken: true });
      const res = await accept(user, token).expect(409);
      expect(res.body.error.code).toBe('INVITE_SLOT_TAKEN');
      expect(await participantByToken(token)).toMatchObject({
        userId: null,
        status: 'ACCEPTED',
        name: 'Quem confirmou',
      });
    };

    it('telefone da conta igual ao contato: a presença confirmada vai para ela', async () => {
      const guest = await signUp(t, 'joao@exemplo.com', 'João');
      await verifyPhone(t, guest, '+5531900000011');
      const { booking, token } = await confirmedInvite({ phone: '+5531900000011' });
      const preview = await previewOf(guest, token);
      expect(preview.body).toMatchObject({ acceptedByMe: false, slotTaken: false });

      const accepted = await accept(guest, token).expect(200);
      expect(accepted.body).toMatchObject({ acceptedByMe: true, slotTaken: false });
      expect(await participantByToken(token)).toMatchObject({ userId: guest.id });
      expect((await contactByPhone('+5531900000011'))?.userId).toBe(guest.id);
      await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(guest))
        .expect(200);
    });

    it('e-mail verificado da conta igual ao contato: a presença confirmada vai para ela', async () => {
      const guest = await signUp(t, 'luana@exemplo.com', 'Luana');
      await t.db.update(users).set({ emailVerified: true }).where(eq(users.id, guest.id));
      const { token } = await confirmedInvite({ email: guest.email });
      await accept(guest, token).expect(200);
      expect(await participantByToken(token)).toMatchObject({
        userId: guest.id,
        status: 'ACCEPTED',
      });
      expect((await contactByEmail('luana@exemplo.com'))?.userId).toBe(guest.id);
    });

    it('telefone informado ao confirmar vale mesmo sem ter entrado no contato', async () => {
      const guest = await signUp(t, 'mario@exemplo.com', 'Mário');
      await verifyPhone(t, guest, '+5531900000012');
      await confirmedInvite({ phone: '+5531900000012' });
      const { token } = await confirmedInvite({
        email: 'mario.outro@exemplo.com',
        phone: '+5531900000012',
      });
      await accept(guest, token).expect(200);
      expect(await participantByToken(token)).toMatchObject({ userId: guest.id });
    });

    it('outra conta não fica com a vaga confirmada sem conta', async () => {
      const stranger = await signUp(t, 'nina@exemplo.com', 'Nina');
      await verifyPhone(t, stranger, '+5531900000013');
      const { booking, token } = await confirmedInvite({ phone: '+5531900000014' });
      await expectSlotTaken(stranger, token);
      expect((await contactByPhone('+5531900000014'))?.userId).toBeNull();
      await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(stranger))
        .expect(404);
    });

    it('e-mail sem verificação não identifica a conta', async () => {
      const guest = await signUp(t, 'yara@exemplo.com', 'Yara');
      const { token } = await confirmedInvite({ email: guest.email });
      await expectSlotTaken(guest, token);
    });

    it('telefone sem verificação não identifica a conta', async () => {
      const guest = await signUp(t, 'paulo@exemplo.com', 'Paulo');
      await t.db
        .update(users)
        .set({ phone: '+5531900000015', phoneVerified: false })
        .where(eq(users.id, guest.id));
      const { token } = await confirmedInvite({ phone: '+5531900000015' });
      await expectSlotTaken(guest, token);
    });

    it('telefone digitado só pelo organizador não identifica a conta', async () => {
      const guest = await signUp(t, 'quesia@exemplo.com', 'Quésia');
      await verifyPhone(t, guest, '+5531900000016');
      const booking = await bookNext();
      const token = tokenOf(
        await invite(t, organizer, booking.id, {
          items: [{ name: 'Quésia', phone: '+5531900000016' }],
        }),
      );
      await confirmPublic(t, token, { name: 'Quem confirmou', phone: '+5531900000017' }).expect(
        200,
      );
      await expectSlotTaken(guest, token);
    });

    it('vaga aceita por outra conta segue indisponível e a prévia diz que está ocupada', async () => {
      const first = await signUp(t, 'renata@exemplo.com', 'Renata');
      const second = await signUp(t, 'sergio@exemplo.com', 'Sérgio');
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { names: ['Vaga'] }));
      await accept(first, token).expect(200);
      expect((await previewOf(second, token)).body.slotTaken).toBe(true);
      const res = await accept(second, token).expect(409);
      expect(res.body.error.code).toBe('INVITE_UNAVAILABLE');
    });

    it('convite direto pendente só conta como aceito depois do aceite', async () => {
      const invited = await signUp(t, 'tania@exemplo.com', 'Tânia');
      const other = await signUp(t, 'ulisses@exemplo.com', 'Ulisses');
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { userIds: [invited.id] }));

      const pending = await previewOf(invited, token);
      expect(pending.body).toMatchObject({
        status: 'INVITED',
        acceptedByMe: false,
        slotTaken: false,
        forAnotherAccount: false,
      });
      const foreign = await previewOf(other, token);
      expect(foreign.body).toMatchObject({
        acceptedByMe: false,
        slotTaken: false,
        forAnotherAccount: true,
      });

      const accepted = await accept(invited, token).expect(200);
      expect(accepted.body).toMatchObject({ status: 'ACCEPTED', acceptedByMe: true });
      expect((await previewOf(other, token)).body).toMatchObject({
        slotTaken: true,
        forAnotherAccount: false,
      });
    });

    it('convite direto recusado não conta como aceito', async () => {
      const invited = await signUp(t, 'vera@exemplo.com', 'Vera');
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { userIds: [invited.id] }));
      const declined = await t
        .http()
        .post(`/v1/invites/${token}/decline`)
        .set(...bearer(invited))
        .expect(200);
      expect(declined.body).toMatchObject({ status: 'DECLINED', acceptedByMe: false });
    });

    it('o organizador vê quem está sem conta e quem está numa conta', async () => {
      const guest = await signUp(t, 'wagner@exemplo.com', 'Wagner');
      const booking = await bookNext();
      const detail = await invite(t, organizer, booking.id, { items: [{}, {}] });
      const [withoutAccount, withAccount] = guests(detail);
      await confirmPublic(t, withoutAccount?.inviteToken ?? '', {
        name: 'Sem Conta',
        phone: '+5531900000018',
      }).expect(200);
      await accept(guest, withAccount?.inviteToken ?? '').expect(200);

      const after = await myDetail(t, organizer, booking.id);
      const byId = new Map(after.participants.map((p) => [p.id, p]));
      expect(byId.get(withoutAccount?.id ?? '')?.hasAccount).toBe(false);
      expect(byId.get(withAccount?.id ?? '')?.hasAccount).toBe(true);
      expect(after.participants.find((p) => p.isOrganizer)?.hasAccount).toBe(true);
    });

    it('sem contato no convite, o aceite não cria contato', async () => {
      const guest = await signUp(t, 'karla@exemplo.com', 'Karla');
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { names: ['Karla'] }));
      await accept(guest, token).expect(200);
      expect(await contactByEmail('karla@exemplo.com')).toBeUndefined();
    });

    it('convite recusado continua indisponível', async () => {
      const guest = await signUp(t, 'lara@exemplo.com', 'Lara');
      const booking = await bookNext();
      const token = tokenOf(await invite(t, organizer, booking.id, { items: [{}] }));
      await t.http().post(`/v1/public/invites/${token}/decline`).expect(200);
      await accept(guest, token).expect(409);
    });
  });

  it('e-mail nunca entra em contato que já existe: o telefone de outra pessoa não vira seu', async () => {
    // Bob convida a vítima pelo telefone; o atacante, que digita o próprio e-mail junto com o
    // telefone dela, fica com um contato só do e-mail.
    const victimPhone = '+5531900000012';
    const first = await bookNext();
    await invite(t, organizer, first.id, { items: [{ name: 'Vítima', phone: victimPhone }] });
    const second = await bookNext();
    await invite(t, organizer, second.id, {
      items: [{ phone: victimPhone, email: 'atacante@exemplo.com' }],
    });
    expect((await contactByPhone(victimPhone))?.email).toBeNull();
    expect(await contactByEmail('atacante@exemplo.com')).toMatchObject({ phone: null });
  });

  it('telefone livre completa o contato achado pelo e-mail; dado existente não muda', async () => {
    const booking = await bookNext();
    const detail = await invite(t, organizer, booking.id, {
      items: [{ name: 'Nome Original', email: 'maya@exemplo.com' }],
    });
    await confirmPublic(t, tokenOf(detail), {
      name: 'Nome Trocado',
      phone: '+5531900000013',
    }).expect(200);
    const contact = await contactByEmail('maya@exemplo.com');
    expect(contact).toMatchObject({ name: 'Nome Original', phone: '+5531900000013' });
    const [row] = await t.db
      .select()
      .from(bookingParticipants)
      .where(eq(bookingParticipants.contactId, contact?.id ?? ''));
    expect(row).toMatchObject({ contactViaEmail: true, name: 'Nome Trocado' });
  });
});

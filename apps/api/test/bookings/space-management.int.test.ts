import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, bookings, users } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { book, guests, invite } from '../contacts/helpers.js';
import {
  bearer,
  createSpace,
  currentSlot,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from './fixtures.js';

useMiddayClock();

describe('gestão de reservas no painel (RF-BOOK-06, RF-BOOK-08, RF-PAY-03)', () => {
  let t: TestApp;
  let space: Space;
  let otherSpace: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let otherOwner: SignedUp;
  let player: SignedUp;
  /** Reserva de balcão no slot em andamento (criada nos testes de balcão). */
  let inProgressId: string;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-gestao');
    otherSpace = await createSpace(t.db, 'arena-vizinha');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
    otherOwner = await member(t, 'dono-vizinho@exemplo.com', otherSpace.id, 'OWNER');
    player = await signUp(t, 'jogador@exemplo.com', 'Jogador');
  });
  afterAll(() => t.close());

  const desk = (user: SignedUp, body: Record<string, unknown>, spaceId = space.id) =>
    t
      .http()
      .post(`/v1/manage/spaces/${spaceId}/bookings`)
      .set(...bearer(user))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Cliente Balcão',
        guestPhone: '+5531988887777',
        ...body,
      });

  describe('reserva de balcão', () => {
    it('cliente sem app (nome + telefone): a gestão vê o telefone', async () => {
      const res = await desk(admin, { startsAt: slotIn(10 * 60).toISOString() }).expect(201);
      expect(res.body).toMatchObject({
        source: 'DESK',
        status: 'CONFIRMED',
        organizer: { userId: null, name: 'Cliente Balcão', phone: '+5531988887777' },
      });
    });

    it('cliente com app: por id a reserva aparece no app dele; pelo telefone, só a sugestão', async () => {
      const byId = await desk(admin, {
        startsAt: slotIn(12 * 60).toISOString(),
        guestName: undefined,
        guestPhone: undefined,
        customerUserId: player.id,
      }).expect(201);
      expect(byId.body.organizer).toMatchObject({ userId: player.id, name: 'Jogador' });

      await t.db
        .update(users)
        .set({ phone: '+5531977776666', phoneVerified: true })
        .where(eq(users.id, player.id));
      const byPhone = await desk(admin, {
        startsAt: slotIn(14 * 60).toISOString(),
        guestName: 'Jogador no balcão',
        guestPhone: '+5531977776666',
      }).expect(201);
      // Telefone não vincula sozinho (decisão 48): a gestão confirma em test/contacts.
      expect(byPhone.body.organizer.userId).toBeNull();

      const mine = await t
        .http()
        .get('/v1/bookings')
        .set(...bearer(player))
        .expect(200);
      const mineIds = mine.body.items.map((b: { id: string }) => b.id);
      expect(mineIds).toContain(byId.body.id);
      expect(mineIds).not.toContain(byPhone.body.id);
      // O jogador não vê o telefone guardado na reserva.
      expect(
        mine.body.items.every((b: { organizer: { phone: null } }) => b.organizer.phone === null),
      ).toBe(true);
    });

    it('valida o cliente', async () => {
      await desk(admin, {
        startsAt: slotIn(16 * 60).toISOString(),
        guestPhone: undefined,
      }).expect(400);
      const res = await desk(admin, {
        startsAt: slotIn(16 * 60).toISOString(),
        guestName: undefined,
        guestPhone: undefined,
        customerUserId: '018f0000-0000-7000-8000-000000000000',
      }).expect(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('dispensa a antecedência (horário em andamento), mas não o conflito', async () => {
      const startsAt = currentSlot().toISOString();
      inProgressId = (await desk(admin, { startsAt, courtId: space.courtB }).expect(201)).body.id;
      const res = await desk(admin, { startsAt, courtId: space.courtB }).expect(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    });
  });

  describe('concluir e no-show (RF-BOOK-08)', () => {
    it('só depois do início; depois disso não muda mais', async () => {
      const future = await desk(admin, { startsAt: slotIn(20 * 60).toISOString() }).expect(201);
      const early = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${future.body.id}/complete`)
        .set(...bearer(admin))
        .expect(422);
      expect(early.body.error.code).toBe('BOOKING_NOT_STARTED');

      // Reservas em andamento (balcão aceita o slot atual).
      const now = currentSlot();
      const done = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${inProgressId}/complete`)
        .set(...bearer(admin))
        .expect(200);
      expect(done.body.status).toBe('COMPLETED');
      const again = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${inProgressId}/no-show`)
        .set(...bearer(admin))
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_BOOKING_STATUS');

      const noShowBooking = await desk(owner, {
        startsAt: now.toISOString(),
        courtId: space.courtA,
      }).expect(201);
      const noShow = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${noShowBooking.body.id}/no-show`)
        .set(...bearer(owner))
        .expect(200);
      expect(noShow.body.status).toBe('NO_SHOW');

      const logs = await t.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.spaceId, space.id));
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining(['booking.desk_create', 'booking.complete', 'booking.no_show']),
      );
    });
  });

  describe('bloqueios (RF-BOOK-06)', () => {
    it('bloqueio ocupa a agenda: conflita com reserva, impede nova reserva e libera ao remover', async () => {
      const booked = slotIn(40 * 60);
      await desk(admin, { startsAt: booked.toISOString() }).expect(201);
      const conflict = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/court-blocks`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtA,
          startsAt: booked.toISOString(),
          endsAt: new Date(booked.getTime() + 30 * 60_000).toISOString(),
        })
        .expect(409);
      expect(conflict.body.error.code).toBe('SLOT_UNAVAILABLE');

      const start = slotIn(44 * 60);
      const end = new Date(start.getTime() + 3 * 60 * 60_000);
      const block = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/court-blocks`)
        .set(...bearer(admin))
        .send({
          courtId: space.courtA,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          reason: 'Manutenção',
        })
        .expect(201);
      expect(block.body).toMatchObject({
        courtId: space.courtA,
        reason: 'Manutenção',
        createdBy: admin.id,
      });

      const inside = new Date(start.getTime() + 60 * 60_000).toISOString();
      const playerBooking = () =>
        t
          .http()
          .post('/v1/bookings')
          .set(...bearer(player))
          .send({
            spaceId: space.id,
            courtId: space.courtA,
            sportId: space.sportId,
            startsAt: inside,
            durationMin: 60,
            peopleCount: 2,
          });
      expect((await playerBooking().expect(409)).body.error.code).toBe('SLOT_UNAVAILABLE');

      const list = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/court-blocks`)
        .query({ from: start.toISOString(), to: end.toISOString() })
        .set(...bearer(teacher))
        .expect(200);
      expect(list.body.map((b: { id: string }) => b.id)).toEqual([block.body.id]);

      await t
        .http()
        .delete(`/v1/manage/spaces/${space.id}/court-blocks/${block.body.id}`)
        .set(...bearer(admin))
        .expect(204);
      await playerBooking().expect(201);
    });

    it('bloqueio de quadra de outro espaço: 404', async () => {
      const start = slotIn(48 * 60);
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/court-blocks`)
        .set(...bearer(owner))
        .send({
          courtId: otherSpace.courtA,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
        })
        .expect(404);
    });
  });

  describe('listagem e "a receber hoje"', () => {
    it('filtra por status e origem e busca pelo nome do cliente', async () => {
      const res = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings`)
        .query({ status: ['COMPLETED', 'NO_SHOW'], source: 'DESK' })
        .set(...bearer(admin))
        .expect(200);
      expect(res.body.items.map((b: { status: string }) => b.status).sort()).toEqual([
        'COMPLETED',
        'NO_SHOW',
      ]);
      const search = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings`)
        .query({ q: 'balcão' })
        .set(...bearer(admin))
        .expect(200);
      expect(search.body.items.length).toBeGreaterThan(0);
      expect(
        search.body.items.every((b: { organizer: { name: string } }) =>
          /balcão/i.test(b.organizer.name),
        ),
      ).toBe(true);
    });

    it('a receber hoje: reservas do dia com pagamento em aberto', async () => {
      const res = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/receivables/today`)
        .set(...bearer(admin))
        .expect(200);
      expect(res.body.timeZone).toBe('America/Sao_Paulo');
      expect(res.body.items.length).toBeGreaterThanOrEqual(2); // concluída e no-show em andamento
      const first = res.body.items[0];
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments`)
        .set(...bearer(admin))
        .send({
          payableType: 'BOOKING',
          payableId: first.booking.id,
          amountCents: first.dueCents,
          method: 'CARD',
        })
        .expect(201);
      const after = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/receivables/today`)
        .set(...bearer(admin))
        .expect(200);
      expect(after.body.items.map((i: { booking: { id: string } }) => i.booking.id)).not.toContain(
        first.booking.id,
      );
      expect(after.body.totalDueCents).toBe(res.body.totalDueCents - first.dueCents);
    });
  });

  describe('permissões por papel (matriz de docs/02)', () => {
    it('Professor só visualiza', async () => {
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(teacher))
        .expect(200);
      const create = await desk(teacher, { startsAt: slotIn(60 * 60).toISOString() }).expect(403);
      expect(create.body.error.code).toBe('SPACE_FORBIDDEN');
      const [any] = await t.db
        .select()
        .from(bookings)
        .where(eq(bookings.spaceId, space.id))
        .limit(1);
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments`)
        .set(...bearer(teacher))
        .send({ payableType: 'BOOKING', payableId: any?.id, amountCents: 100, method: 'PIX' })
        .expect(403);
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${any?.id}/cancel`)
        .set(...bearer(teacher))
        .send({})
        .expect(403);
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/receivables/today`)
        .set(...bearer(teacher))
        .expect(403);
    });

    describe('valores da reserva (decisão 53)', () => {
      const listing = (user: SignedUp, query: Record<string, unknown> = {}) =>
        t
          .http()
          .get(`/v1/manage/spaces/${space.id}/bookings`)
          .query(query)
          .set(...bearer(user))
          .expect(200);
      const detailOf = (user: SignedUp, bookingId: string) =>
        t
          .http()
          .get(`/v1/manage/spaces/${space.id}/bookings/${bookingId}`)
          .set(...bearer(user))
          .expect(200);

      let hoursAhead = 24;

      /** Reserva com a conta dividida, um convite pendente e um pagamento registrado. */
      const paidWithInvite = async () => {
        hoursAhead += 2;
        const booking = await book(t, player, space, hoursAhead);
        const detail = await invite(t, player, booking.id, { names: ['Convidada'] });
        await t
          .http()
          .post(`/v1/manage/spaces/${space.id}/payments`)
          .set(...bearer(owner))
          .send({ payableType: 'BOOKING', payableId: booking.id, amountCents: 100, method: 'PIX' })
          .expect(201);
        return { id: booking.id, guest: guests(detail)[0] };
      };

      it('o Professor vê a reserva sem preço, partes, pagamentos e convite', async () => {
        const { id, guest } = await paidWithInvite();
        const { body } = await detailOf(teacher, id);
        expect(body).toMatchObject({
          id,
          peopleCount: 4,
          status: 'CONFIRMED',
          pricePerHourCents: null,
          priceCents: null,
          paidCents: null,
          paymentStatus: null,
          intendedPaymentMethod: null,
          payments: [],
        });
        expect(body.participants.length).toBeGreaterThan(1);
        for (const participant of body.participants) {
          expect(participant).toMatchObject({
            shareCents: null,
            inviteToken: null,
            inviteUrl: null,
          });
        }
        expect(JSON.stringify(body)).not.toContain(guest?.inviteToken);
      });

      it('Dono e Admin seguem vendo tudo', async () => {
        const { id, guest } = await paidWithInvite();
        for (const user of [owner, admin]) {
          const { body } = await detailOf(user, id);
          expect(body.priceCents).toBeGreaterThan(0);
          expect(body.paidCents).toBe(100);
          expect(body.paymentStatus).toBe('PARTIALLY_PAID');
          expect(body.payments).toHaveLength(1);
          const invited = body.participants.find((p: { id: string }) => p.id === guest?.id);
          expect(invited.shareCents).toBeGreaterThan(0);
          expect(invited.inviteToken).toBe(guest?.inviteToken);
          expect(invited.inviteUrl).toContain(`/r/${guest?.inviteToken}`);
        }
      });

      it('a listagem do Professor não traz valores', async () => {
        const { id } = await paidWithInvite();
        const { body } = await listing(teacher);
        const row = body.items.find((b: { id: string }) => b.id === id);
        expect(row).toMatchObject({
          pricePerHourCents: null,
          priceCents: null,
          paidCents: null,
          paymentStatus: null,
          intendedPaymentMethod: null,
        });
        for (const item of body.items) expect(item.priceCents).toBeNull();

        const managed = await listing(admin);
        const full = managed.body.items.find((b: { id: string }) => b.id === id);
        expect(full.priceCents).toBeGreaterThan(0);
        expect(full.paymentStatus).toBe('PARTIALLY_PAID');
      });

      it('o filtro de pagamento não revela a situação ao Professor', async () => {
        const { id } = await paidWithInvite();
        const paid = { paymentStatus: 'PAID' };
        const forAdmin = await listing(admin, paid);
        expect(forAdmin.body.items.map((b: { id: string }) => b.id)).not.toContain(id);
        const forTeacher = await listing(teacher, paid);
        expect(forTeacher.body.items.map((b: { id: string }) => b.id)).toContain(id);
      });
    });

    it('jogador sem vínculo e dono de outro espaço não acessam', async () => {
      for (const user of [player, otherOwner]) {
        await t
          .http()
          .get(`/v1/manage/spaces/${space.id}/bookings`)
          .set(...bearer(user))
          .expect(403);
        await desk(user, { startsAt: slotIn(62 * 60).toISOString() }).expect(403);
      }
    });

    it('a gestão de um espaço não alcança reservas de outro pelo próprio espaço', async () => {
      const foreign = await desk(
        otherOwner,
        {
          startsAt: slotIn(64 * 60).toISOString(),
          courtId: otherSpace.courtA,
          sportId: otherSpace.sportId,
        },
        otherSpace.id,
      ).expect(201);
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings/${foreign.body.id}`)
        .set(...bearer(owner))
        .expect(404);
      const pay = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments`)
        .set(...bearer(owner))
        .send({
          payableType: 'BOOKING',
          payableId: foreign.body.id,
          amountCents: 100,
          method: 'PIX',
        })
        .expect(404);
      expect(pay.body.error.code).toBe('PAYABLE_NOT_FOUND');
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings/${foreign.body.id}/cancel`)
        .set(...bearer(owner))
        .send({})
        .expect(404);
    });

    it('Dono e Admin registram pagamento', async () => {
      const created = await desk(admin, { startsAt: slotIn(66 * 60).toISOString() }).expect(201);
      for (const user of [owner, admin]) {
        await t
          .http()
          .post(`/v1/manage/spaces/${space.id}/payments`)
          .set(...bearer(user))
          .send({
            payableType: 'BOOKING',
            payableId: created.body.id,
            amountCents: 1_000,
            method: 'CASH',
          })
          .expect(201);
      }
    });
  });
});

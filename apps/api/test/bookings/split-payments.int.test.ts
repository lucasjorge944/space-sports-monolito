import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, bookings, paymentRecords } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp, WEB_ORIGIN } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { bearer, createSpace, member, type Space, slotIn, useMiddayClock } from './fixtures.js';

type Participant = {
  id: string;
  userId: string | null;
  name: string | null;
  isOrganizer: boolean;
  shareCents: number;
  status: string;
  inviteToken: string | null;
  inviteUrl: string | null;
};

useMiddayClock();

describe('dividir a conta e pagamentos (RF-BOOK-04, RN-BOOK-09, RF-PAY-01, RN-PAY-01, decisão 50)', () => {
  let t: TestApp;
  let space: Space;
  let organizer: SignedUp;
  let friend: SignedUp;
  let stranger: SignedUp;
  let manager: SignedUp;
  let teacher: SignedUp;
  let booking: { id: string; participants: Participant[] };

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'arena-divisao');
    organizer = await signUp(t, 'organizador@exemplo.com', 'Organizador');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');
    stranger = await signUp(t, 'estranho@exemplo.com', 'Estranho');
    manager = await member(t, 'gestor@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');

    // R$ 100/h × 1h para 3 pessoas: 3334 (organizador) + 3333 + 3333.
    const res = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(30 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 3,
      })
      .expect(201);
    booking = res.body;
  });
  afterAll(() => t.close());

  const pay = (body: Record<string, unknown>, user = manager) =>
    t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments`)
      .set(...bearer(user))
      .send({ method: 'PIX', ...body });

  const reverse = (paymentId: string, body: Record<string, unknown> = {}) =>
    t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments/${paymentId}/reverse`)
      .set(...bearer(manager))
      .send(body);

  const staffDetail = async (bookingId = booking.id) =>
    (
      await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/bookings/${bookingId}`)
        .set(...bearer(manager))
        .expect(200)
    ).body as {
      paymentStatus: string;
      paidCents: number;
      participants: Participant[];
      payments: { id: string; payableType: string; reversedAt: string | null }[];
    };

  it('convites criam as partes; o organizador fica com a diferença do arredondamento', async () => {
    const res = await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Ana', 'Bruno'] })
      .expect(201);
    booking = res.body;
    const shares = booking.participants.map((p) => [p.isOrganizer, p.shareCents, p.status]);
    expect(shares).toEqual([
      [true, 3_334, 'ACCEPTED'],
      [false, 3_333, 'INVITED'],
      [false, 3_333, 'INVITED'],
    ]);
    const guests = booking.participants.filter((p) => !p.isOrganizer);
    for (const guest of guests) {
      expect(guest.inviteToken).toBeTruthy();
      expect(guest.inviteUrl).toBe(`${WEB_ORIGIN}/r/${guest.inviteToken}`);
    }
    expect(guests.map((g) => g.name).sort()).toEqual(['Ana', 'Bruno']);
  });

  it('não convida mais gente do que people_count − 1', async () => {
    const res = await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Carla'] })
      .expect(422);
    expect(res.body.error).toMatchObject({ code: 'TOO_MANY_INVITES', details: { available: 0 } });
  });

  it('só o organizador convida', async () => {
    await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(stranger))
      .send({ names: ['X'] })
      .expect(404);
  });

  it('aceite pelo link: o convidado vira participante e vê a reserva e a parte dele', async () => {
    const token = booking.participants[1]?.inviteToken ?? '';
    const preview = await t
      .http()
      .get(`/v1/invites/${token}`)
      .set(...bearer(friend))
      .expect(200);
    expect(preview.body).toMatchObject({
      status: 'INVITED',
      shareCents: 3_333,
      acceptedByMe: false,
      booking: { id: booking.id, organizerName: 'Organizador' },
    });

    const accepted = await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', acceptedByMe: true });
    // Idempotente.
    await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(200);

    const mine = await t
      .http()
      .get('/v1/bookings')
      .set(...bearer(friend))
      .expect(200);
    expect(mine.body.items.map((b: { id: string }) => b.id)).toContain(booking.id);
    const detail = await t
      .http()
      .get(`/v1/bookings/${booking.id}`)
      .set(...bearer(friend))
      .expect(200);
    // O convidado não vê os tokens dos outros convites.
    expect(detail.body.participants.every((p: Participant) => p.inviteToken === null)).toBe(true);
    expect(detail.body.participants[1]).toMatchObject({ isMe: true, name: 'Amigo' });

    // Convite já usado por outra pessoa.
    const taken = await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(stranger))
      .expect(409);
    expect(taken.body.error.code).toBe('INVITE_UNAVAILABLE');
  });

  it('o organizador não aceita o próprio convite; quem já participa não aceita outro', async () => {
    const token = booking.participants[2]?.inviteToken ?? '';
    const self = await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(organizer))
      .expect(409);
    expect(self.body.error.code).toBe('ALREADY_PARTICIPANT');
    const twice = await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(409);
    expect(twice.body.error.code).toBe('ALREADY_PARTICIPANT');
    await t
      .http()
      .get('/v1/invites/token-inexistente')
      .set(...bearer(friend))
      .expect(404);
  });

  it('recusa o recebimento por participante, com erro próprio e sem registrar nada', async () => {
    const part = booking.participants[1] as Participant;
    const refused = await pay({
      payableType: 'BOOKING_PARTICIPANT',
      payableId: part.id,
      amountCents: 3_333,
    }).expect(422);
    expect(refused.body.error.code).toBe('PARTICIPANT_PAYMENT_NOT_ALLOWED');
    // O motivo vem antes da validação do corpo, mas depois da permissão.
    const incomplete = await pay({ payableType: 'BOOKING_PARTICIPANT' }).expect(422);
    expect(incomplete.body.error.code).toBe('PARTICIPANT_PAYMENT_NOT_ALLOWED');
    await pay({ payableType: 'BOOKING_PARTICIPANT' }, teacher).expect(403);

    // Outro tipo desconhecido continua sendo erro de validação.
    await pay({ payableType: 'QUALQUER', payableId: part.id, amountCents: 1 }).expect(400);

    const detail = await staffDetail();
    expect(detail.payments).toEqual([]);
    expect(detail.paymentStatus).toBe('PENDING');
  });

  it('a parte da conta não é item a pagar: o id dela não serve como reserva', async () => {
    const part = booking.participants[1] as Participant;
    const res = await pay({ payableType: 'BOOKING', payableId: part.id, amountCents: 3_333 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAYABLE_NOT_FOUND');
  });

  it('reserva inteira: PENDING → PARTIALLY_PAID → PAID, sem passar do valor em aberto', async () => {
    const over = await pay({
      payableType: 'BOOKING',
      payableId: booking.id,
      amountCents: 10_001,
    }).expect(422);
    expect(over.body.error).toMatchObject({
      code: 'PAYMENT_EXCEEDS_DUE',
      details: { dueCents: 10_000 },
    });

    const first = await pay({
      payableType: 'BOOKING',
      payableId: booking.id,
      amountCents: 3_333,
      method: 'CASH',
    }).expect(201);
    expect(first.body).toMatchObject({
      payableType: 'BOOKING',
      payerUserId: organizer.id,
      amountCents: 3_333,
      method: 'CASH',
      recordedBy: manager.id,
      reversedAt: null,
    });
    let detail = await staffDetail();
    expect(detail.paymentStatus).toBe('PARTIALLY_PAID');
    expect(detail.paidCents).toBe(3_333);

    const rest = await pay({
      payableType: 'BOOKING',
      payableId: booking.id,
      amountCents: 6_667,
    }).expect(201);
    detail = await staffDetail();
    expect(detail.paymentStatus).toBe('PAID');
    expect(detail.paidCents).toBe(10_000);
    await pay({ payableType: 'BOOKING', payableId: booking.id, amountCents: 1 }).expect(422);

    // Estorno: volta a PARTIALLY_PAID, fica registrado (não apaga) e não estorna duas vezes.
    const reversed = await reverse(rest.body.id, { reason: 'Pix não caiu' }).expect(200);
    expect(reversed.body.reversedBy).toBe(manager.id);
    detail = await staffDetail();
    expect(detail.paymentStatus).toBe('PARTIALLY_PAID');
    expect(detail.paidCents).toBe(3_333);
    expect(detail.payments).toHaveLength(2);
    const again = await reverse(rest.body.id).expect(409);
    expect(again.body.error.code).toBe('PAYMENT_ALREADY_REVERSED');
  });

  it('cada audiência vê o que lhe cabe: a parte é só informativa; extrato só na gestão', async () => {
    await pay({
      payableType: 'BOOKING',
      payableId: booking.id,
      amountCents: 1_000,
      method: 'CARD',
      note: 'nota interna',
    }).expect(201);

    const asFriend = (
      await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(friend))
        .expect(200)
    ).body;
    expect(asFriend).not.toHaveProperty('payments');
    expect(asFriend.paidCents).toBeNull();
    expect(asFriend.paymentStatus).toBeNull();
    expect(asFriend.myShare).toEqual({
      participantId: booking.participants[1]?.id,
      shareCents: 3_333,
    });
    for (const p of asFriend.participants) {
      expect(p).not.toHaveProperty('userId');
      expect(p).not.toHaveProperty('paymentStatus');
      expect(p.inviteToken).toBeNull();
      expect(p.shareCents).toEqual(expect.any(Number));
    }
    const leaked = JSON.stringify(asFriend);
    for (const secret of ['nota interna', manager.id, 'recordedBy', 'reversedAt', 'payerUserId']) {
      expect(leaked).not.toContain(secret);
    }

    const asOrganizer = (
      await t
        .http()
        .get(`/v1/bookings/${booking.id}`)
        .set(...bearer(organizer))
        .expect(200)
    ).body;
    expect(asOrganizer).not.toHaveProperty('payments');
    expect(asOrganizer.paidCents).toBe(4_333);
    expect(asOrganizer.paymentStatus).toBe('PARTIALLY_PAID');
    expect(asOrganizer.myShare).toEqual({
      participantId: booking.participants[0]?.id,
      shareCents: 3_334,
    });
    for (const p of asOrganizer.participants) expect(p).not.toHaveProperty('paymentStatus');
    expect(JSON.stringify(asOrganizer)).not.toContain('nota interna');

    const lists = await t
      .http()
      .get('/v1/bookings')
      .set(...bearer(friend))
      .expect(200);
    const listed = lists.body.items.find((b: { id: string }) => b.id === booking.id);
    expect(listed.paidCents).toBeNull();

    // A gestão continua com o extrato completo, sem pagamento por participante.
    const staff = await staffDetail();
    expect(staff.payments).toHaveLength(3);
    expect(JSON.stringify(staff)).toContain('nota interna');
    expect(staff.participants.map((p) => p.shareCents)).toEqual([3_334, 3_333, 3_333]);
    for (const p of staff.participants) expect(p).not.toHaveProperty('paymentStatus');
  });

  it('registros e estornos ficam no audit_logs', async () => {
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.spaceId, space.id), eq(auditLogs.entity, 'payment_record')));
    expect(logs.filter((l) => l.action === 'payment.record')).toHaveLength(3);
    expect(logs.filter((l) => l.action === 'payment.reverse')).toHaveLength(1);
    expect(logs.every((l) => l.actorId === manager.id)).toBe(true);
    expect(
      logs.find((l) => l.action === 'payment.reverse' && l.diff?.reason === 'Pix não caiu'),
    ).toBeTruthy();
  });

  describe('registros antigos por participante (decisão 50)', () => {
    /** Reserva de R$ 100 para 2 pessoas, com um pagamento antigo de R$ 50 na parte do convidado. */
    async function bookingWithLegacyPayment(startsAt: Date) {
      const created = await t
        .http()
        .post('/v1/bookings')
        .set(...bearer(organizer))
        .send({
          spaceId: space.id,
          courtId: space.courtB,
          sportId: space.sportId,
          startsAt: startsAt.toISOString(),
          durationMin: 60,
          peopleCount: 2,
        })
        .expect(201);
      const invited = await t
        .http()
        .post(`/v1/bookings/${created.body.id}/invites`)
        .set(...bearer(organizer))
        .send({ names: ['Eva'] })
        .expect(201);
      const guest = invited.body.participants[1] as Participant;
      const legacy = first(
        await t.db
          .insert(paymentRecords)
          .values({
            spaceId: space.id,
            payableType: 'BOOKING_PARTICIPANT',
            payableId: guest.id,
            amountCents: 5_000,
            method: 'CASH',
            paidAt: new Date(),
            recordedBy: manager.id,
          })
          .returning(),
      );
      await t.db
        .update(bookings)
        .set({ paymentStatus: 'PARTIALLY_PAID' })
        .where(eq(bookings.id, created.body.id));
      return { bookingId: created.body.id as string, guest, legacy };
    }

    it('contam no total, no valor em aberto e no status da reserva', async () => {
      const { bookingId, legacy } = await bookingWithLegacyPayment(slotIn(38 * 60));
      let detail = await staffDetail(bookingId);
      expect(detail.paidCents).toBe(5_000);
      expect(detail.paymentStatus).toBe('PARTIALLY_PAID');
      expect(detail.payments).toEqual([
        expect.objectContaining({ id: legacy.id, payableType: 'BOOKING_PARTICIPANT' }),
      ]);

      const over = await pay({
        payableType: 'BOOKING',
        payableId: bookingId,
        amountCents: 5_001,
      }).expect(422);
      expect(over.body.error.details).toEqual({ dueCents: 5_000 });

      await pay({ payableType: 'BOOKING', payableId: bookingId, amountCents: 5_000 }).expect(201);
      detail = await staffDetail(bookingId);
      expect(detail.paidCents).toBe(10_000);
      expect(detail.paymentStatus).toBe('PAID');
    });

    it('seguem no extrato e podem ser estornados, recalculando o status', async () => {
      const { bookingId, guest, legacy } = await bookingWithLegacyPayment(slotIn(42 * 60));
      await pay({ payableType: 'BOOKING', payableId: bookingId, amountCents: 5_000 }).expect(201);

      const statement = await t
        .http()
        .get(`/v1/manage/spaces/${space.id}/statement`)
        .query({
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString(),
        })
        .set(...bearer(manager))
        .expect(200);
      expect(statement.body.items).toContainEqual(
        expect.objectContaining({
          id: legacy.id,
          payableType: 'BOOKING_PARTICIPANT',
          payableId: guest.id,
          bookingId,
          service: 'RENTAL',
          payerName: 'Eva',
        }),
      );

      await reverse(legacy.id, { reason: 'Registro errado' }).expect(200);
      const detail = await staffDetail(bookingId);
      expect(detail.paidCents).toBe(5_000);
      expect(detail.paymentStatus).toBe('PARTIALLY_PAID');
      expect(detail.payments).toHaveLength(2);
      await reverse(legacy.id).expect(409);
    });

    it('a parte com pagamento antigo não pode ser removida do convite', async () => {
      const { bookingId, guest } = await bookingWithLegacyPayment(slotIn(46 * 60));
      await t
        .http()
        .delete(`/v1/bookings/${bookingId}/invites/${guest.id}`)
        .set(...bearer(organizer))
        .expect(404);
      expect((await staffDetail(bookingId)).participants).toHaveLength(2);
    });

    it('estorna mesmo quando a parte não existe mais', async () => {
      const orphan = first(
        await t.db
          .insert(paymentRecords)
          .values({
            spaceId: space.id,
            payableType: 'BOOKING_PARTICIPANT',
            payableId: crypto.randomUUID(),
            amountCents: 1_000,
            method: 'CASH',
            paidAt: new Date(),
            recordedBy: manager.id,
          })
          .returning(),
      );
      const res = await reverse(orphan.id).expect(200);
      expect(res.body.reversedBy).toBe(manager.id);
    });
  });

  it('o organizador desfaz um convite pendente e a vaga volta', async () => {
    const pending = booking.participants[2] as Participant;
    const res = await t
      .http()
      .delete(`/v1/bookings/${booking.id}/invites/${pending.id}`)
      .set(...bearer(organizer))
      .expect(200);
    expect(res.body.participants).toHaveLength(2);
    await t
      .http()
      .post(`/v1/bookings/${booking.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Carla'] })
      .expect(201);
  });

  it('reserva de uma pessoa não divide; cancelada não recebe pagamento nem aceite', async () => {
    const solo = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtB,
        sportId: space.sportId,
        startsAt: slotIn(30 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 1,
      })
      .expect(201);
    expect(solo.body.myShare).toEqual({ participantId: null, shareCents: 10_000 });
    const split = await t
      .http()
      .post(`/v1/bookings/${solo.body.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Ninguém'] })
      .expect(422);
    expect(split.body.error.code).toBe('BOOKING_NOT_SPLITTABLE');

    const group = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtB,
        sportId: space.sportId,
        startsAt: slotIn(34 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
      })
      .expect(201);
    const invited = await t
      .http()
      .post(`/v1/bookings/${group.body.id}/invites`)
      .set(...bearer(organizer))
      .send({ names: ['Dani'] })
      .expect(201);
    await t
      .http()
      .post(`/v1/bookings/${group.body.id}/cancel`)
      .set(...bearer(organizer))
      .send({})
      .expect(200);
    const token = invited.body.participants[1].inviteToken;
    const accept = await t
      .http()
      .post(`/v1/invites/${token}/accept`)
      .set(...bearer(friend))
      .expect(409);
    expect(accept.body.error.code).toBe('INVITE_UNAVAILABLE');
    const payment = await pay({
      payableType: 'BOOKING',
      payableId: group.body.id,
      amountCents: 100,
    }).expect(409);
    expect(payment.body.error.code).toBe('BOOKING_NOT_PAYABLE');
  });
});

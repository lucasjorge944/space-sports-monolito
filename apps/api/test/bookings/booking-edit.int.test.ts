import { randomUUID } from 'node:crypto';
import { addDays, addMinutes, utcToZoned, zonedToUtc } from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingParticipants,
  bookings,
  courtOccupations,
  courtSports,
  courts,
  notificationPreferences,
  recurringBookings,
  spaceOpeningHours,
  spaceSettings,
  spaces,
} from '../../src/db/schema/index.js';
import { type SignedUp, signUp } from '../auth/helpers.js';
import { createNotificationsApp, type NotificationsTestApp } from '../notifications/fakes.js';
import { inbox } from '../notifications/helpers.js';
import {
  bearer,
  createSpace,
  currentSlot,
  member,
  PRICE_PER_HOUR,
  type Space,
  slotIn,
  useMiddayClock,
} from './fixtures.js';

// RF-BOOK-03, RN-BOOK-10 a RN-BOOK-13 (decisão 49): edição da reserva pelo organizador.

type EditBlock = { code: string; message: string } | null;
type Reply = { status: number; body: { error: { code: string } } };
type Detail = {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  peopleCount: number;
  pricePerHourCents: number;
  priceCents: number;
  paidCents: number | null;
  participants: {
    id: string;
    isOrganizer: boolean;
    shareCents: number;
    status: string;
    inviteToken: string | null;
  }[];
  myShare: { shareCents: number };
  canEditPeople: boolean;
  peopleEditBlock: EditBlock;
  canEditSchedule: boolean;
  scheduleEditBlock: EditBlock;
};

const TZ = 'America/Sao_Paulo';
const HOUR = 60;

/** Horário local do dia seguinte: `slotIn` depende da hora, e isto não. */
const tomorrowAt = (hour: number, minute = 0) =>
  zonedToUtc(addDays(utcToZoned(new Date(), TZ).date, 1), hour * 60 + minute, TZ);

useMiddayClock();

describe('edição da reserva pelo organizador (RF-BOOK-03)', () => {
  let t: NotificationsTestApp;
  let space: Space;
  let organizer: SignedUp;
  let friend: SignedUp;
  let stranger: SignedUp;
  let owner: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;

  beforeAll(async () => {
    t = await createNotificationsApp();
    space = await createSpace(t.db, 'arena-edicao');
    organizer = await signUp(t, 'organizador@exemplo.com', 'Organizador');
    friend = await signUp(t, 'amigo@exemplo.com', 'Amigo');
    stranger = await signUp(t, 'estranho@exemplo.com', 'Estranho');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await member(t, 'admin@exemplo.com', space.id, 'ADMIN');
    teacher = await member(t, 'professor@exemplo.com', space.id, 'TEACHER');
  });
  afterAll(() => t.close());

  // Cada teste fica no próprio horário, longe dos outros, dentro da janela de 30 dias.
  let slotOffsetHours = 24;
  const freshSlot = () => {
    slotOffsetHours += 6;
    return slotIn(slotOffsetHours * HOUR);
  };

  const book = async (extra: Record<string, unknown> = {}, target = space, user = organizer) => {
    const res = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(user))
      .send({
        spaceId: target.id,
        courtId: target.courtA,
        sportId: target.sportId,
        startsAt: freshSlot().toISOString(),
        durationMin: HOUR,
        peopleCount: 2,
        ...extra,
      })
      .expect(201);
    return res.body as Detail;
  };

  /** Reserva gravada direto no banco, para estados que a API não cria (já começou, terminou…). */
  const seed = async (values: Partial<typeof bookings.$inferInsert> & { startsAt: Date }) => {
    const durationMin = values.durationMin ?? HOUR;
    const [row] = await t.db
      .insert(bookings)
      .values({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        organizerUserId: organizer.id,
        endsAt: addMinutes(values.startsAt, durationMin),
        durationMin,
        peopleCount: 2,
        pricePerHourCents: PRICE_PER_HOUR,
        priceCents: PRICE_PER_HOUR,
        source: 'APP',
        ...values,
      })
      .returning();
    if (!row) throw new Error('Reserva não criada.');
    return row;
  };

  const recurring = async () => {
    const [row] = await t.db
      .insert(recurringBookings)
      .values({
        spaceId: space.id,
        courtId: space.courtA,
        userId: organizer.id,
        sportId: space.sportId,
        weekday: 1,
        startTime: '18:00',
        durationMin: HOUR,
        peopleCount: 2,
        startsOn: '2026-01-05',
        status: 'ACTIVE',
      })
      .returning();
    if (!row) throw new Error('Mensalista não criado.');
    return row;
  };

  const edit = (id: string, body: Record<string, unknown>, user = organizer) =>
    t
      .http()
      .patch(`/v1/bookings/${id}`)
      .set(...bearer(user))
      .send(body);

  const expectError = async (
    request: ReturnType<typeof edit>,
    status: number,
    code: string,
    details?: unknown,
  ) => {
    const res = await request;
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    if (details) expect(res.body.error.details).toMatchObject(details);
  };

  const detail = async (id: string, user = organizer) =>
    (
      await t
        .http()
        .get(`/v1/bookings/${id}`)
        .set(...bearer(user))
        .expect(200)
    ).body as Detail;

  const invite = async (id: string, names: string[]) =>
    (
      await t
        .http()
        .post(`/v1/bookings/${id}/invites`)
        .set(...bearer(organizer))
        .send({ names })
        .expect(201)
    ).body as Detail;

  const respond = (token: string | null, action: 'accept' | 'decline', user: SignedUp) =>
    t
      .http()
      .post(`/v1/invites/${token}/${action}`)
      .set(...bearer(user))
      .expect(200);

  const pay = async (id: string, amountCents: number) =>
    (
      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments`)
        .set(...bearer(owner))
        .send({ method: 'PIX', payableType: 'BOOKING', payableId: id, amountCents })
        .expect(201)
    ).body as { id: string };

  const occupation = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(courtOccupations)
      .where(and(eq(courtOccupations.kind, 'BOOKING'), eq(courtOccupations.refId, id)));
    return row;
  };

  const block = (start: Date, end: Date) => ({
    courtId: space.courtA,
    period: { start, end },
    kind: 'BLOCK' as const,
    refId: randomUUID(),
  });

  /** Espera alguma consulta do banco ficar parada numa trava (a edição na constraint). */
  const waitForLockWait = async () => {
    for (let attempt = 0; attempt < 250; attempt++) {
      const { rows } = await t.db.execute<{ waiting: number }>(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (rows[0]?.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Nenhuma consulta esperou a trava.');
  };

  describe('o que pode ser editado (RN-BOOK-10)', () => {
    it('só o organizador: participante e estranho recebem 404', async () => {
      const booking = await book({ peopleCount: 3 });
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'accept', friend);

      await expectError(edit(booking.id, { peopleCount: 4 }, friend), 404, 'BOOKING_NOT_FOUND');
      await expectError(edit(booking.id, { peopleCount: 4 }, stranger), 404, 'BOOKING_NOT_FOUND');
      expect((await detail(booking.id)).peopleCount).toBe(3);
    });

    it('recusa reserva cancelada e concluída', async () => {
      const cancelled = await book();
      await t
        .http()
        .post(`/v1/bookings/${cancelled.id}/cancel`)
        .set(...bearer(organizer))
        .send({})
        .expect(200);
      await expectError(edit(cancelled.id, { peopleCount: 3 }), 409, 'INVALID_BOOKING_STATUS', {
        status: 'CANCELLED',
      });

      const completed = await seed({ startsAt: slotIn(2 * HOUR), status: 'COMPLETED' });
      await expectError(edit(completed.id, { peopleCount: 3 }), 409, 'INVALID_BOOKING_STATUS', {
        status: 'COMPLETED',
      });
    });

    it('recusa reserva terminada', async () => {
      const ended = await seed({ startsAt: addMinutes(currentSlot(), -3 * HOUR) });
      await expectError(edit(ended.id, { peopleCount: 3 }), 422, 'BOOKING_ENDED');
      await expectError(edit(ended.id, { durationMin: 90 }), 422, 'BOOKING_ENDED');
    });

    it('recusa reserva de balcão', async () => {
      const desk = await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/bookings`)
        .set(...bearer(owner))
        .send({
          courtId: space.courtA,
          sportId: space.sportId,
          startsAt: freshSlot().toISOString(),
          durationMin: HOUR,
          peopleCount: 2,
          customerUserId: organizer.id,
        })
        .expect(201);
      await expectError(edit(desk.body.id, { peopleCount: 3 }), 422, 'BOOKING_NOT_EDITABLE');
      await expectError(edit(desk.body.id, { durationMin: 90 }), 422, 'BOOKING_NOT_EDITABLE');
    });

    it('recusa ocorrência de mensalista, pela origem e pelo vínculo', async () => {
      const { id: recurringBookingId } = await recurring();
      const occurrence = await seed({
        startsAt: slotIn(2 * HOUR),
        source: 'RECURRING',
        recurringBookingId,
      });
      await expectError(edit(occurrence.id, { peopleCount: 3 }), 422, 'BOOKING_NOT_EDITABLE');

      const linked = await seed({ startsAt: slotIn(3 * HOUR), recurringBookingId });
      await expectError(edit(linked.id, { peopleCount: 3 }), 422, 'BOOKING_NOT_EDITABLE');
    });

    it('espaço suspenso fica só leitura', async () => {
      const suspended = await createSpace(t.db, 'arena-edicao-suspensa');
      const booking = await book({}, suspended);
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, suspended.id));
      await expectError(edit(booking.id, { peopleCount: 3 }), 403, 'SPACE_READ_ONLY');
    });

    it('recusa quadra inativa, nas pessoas e no horário', async () => {
      const closed = await createSpace(t.db, 'arena-edicao-quadra');
      const booking = await book({}, closed);
      await t.db.update(courts).set({ status: 'INACTIVE' }).where(eq(courts.id, closed.courtA));
      await expectError(edit(booking.id, { peopleCount: 3 }), 422, 'COURT_UNAVAILABLE');
      await expectError(edit(booking.id, { durationMin: 90 }), 422, 'COURT_UNAVAILABLE');
    });

    it('recusa esporte que a quadra deixou de oferecer, nas pessoas e no horário', async () => {
      const retired = await createSpace(t.db, 'arena-edicao-esporte');
      const booking = await book({}, retired);
      await t.db.delete(courtSports).where(eq(courtSports.courtId, retired.courtA));
      await expectError(edit(booking.id, { peopleCount: 3 }), 422, 'SPORT_NOT_OFFERED');
      await expectError(edit(booking.id, { durationMin: 90 }), 422, 'SPORT_NOT_OFFERED');
    });

    it('a quadra não muda: corpo com courtId ou vazio é inválido', async () => {
      const booking = await book();
      await expectError(edit(booking.id, { courtId: space.courtB }), 400, 'VALIDATION_ERROR');
      await expectError(
        edit(booking.id, { courtId: space.courtB, peopleCount: 3 }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(edit(booking.id, {}), 400, 'VALIDATION_ERROR');
    });
  });

  describe('nº de pessoas (RN-BOOK-11)', () => {
    it('edita até o início, mesmo depois do prazo de cancelamento', async () => {
      const booking = await seed({ startsAt: slotIn(30) });
      const res = await edit(booking.id, { peopleCount: 4 }).expect(200);
      expect(res.body).toMatchObject({ peopleCount: 4, priceCents: PRICE_PER_HOUR });
    });

    it('recusa depois do início', async () => {
      const started = await seed({ startsAt: currentSlot() });
      await expectError(edit(started.id, { peopleCount: 3 }), 422, 'BOOKING_STARTED');
    });

    it('aceita com pagamento registrado', async () => {
      const booking = await book();
      await pay(booking.id, PRICE_PER_HOUR);
      const res = await edit(booking.id, { peopleCount: 4 }).expect(200);
      expect(res.body).toMatchObject({ peopleCount: 4, paidCents: PRICE_PER_HOUR });
    });

    it('fica entre 1 e o máximo da quadra para o esporte (RN-BOOK-04)', async () => {
      const booking = await book();
      await expectError(edit(booking.id, { peopleCount: 0 }), 400, 'VALIDATION_ERROR');
      await expectError(edit(booking.id, { peopleCount: 5 }), 422, 'PEOPLE_EXCEED_CAPACITY', {
        maxPlayers: 4,
      });
      await edit(booking.id, { peopleCount: 1 }).expect(200);
      await edit(booking.id, { peopleCount: 4 }).expect(200);
    });

    it('nunca fica abaixo de 1 + convidados não recusados, e diz o número', async () => {
      const booking = await book({ peopleCount: 4 });
      const invited = await invite(booking.id, ['Ana', 'Bruno', 'Carla']);
      const guests = invited.participants.filter((p) => !p.isOrganizer);

      const refused = await edit(booking.id, { peopleCount: 3 });
      expect(refused.status).toBe(422);
      expect(refused.body.error).toMatchObject({
        code: 'PEOPLE_BELOW_PARTICIPANTS',
        details: { minPeople: 4 },
      });
      expect(refused.body.error.message).toContain('4');

      // Convidado pendente e quem aceitou contam; quem recusou, não.
      await respond(guests[0]?.inviteToken ?? null, 'accept', friend);
      await respond(guests[1]?.inviteToken ?? null, 'decline', stranger);
      await expectError(edit(booking.id, { peopleCount: 2 }), 422, 'PEOPLE_BELOW_PARTICIPANTS', {
        minPeople: 3,
      });
      await edit(booking.id, { peopleCount: 3 }).expect(200);
    });

    it('com o convidado já aceito, a recusa não manda desfazer convite', async () => {
      const booking = await book({ peopleCount: 3 });
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'accept', friend);

      const refused = await edit(booking.id, { peopleCount: 1 });
      expect(refused.status).toBe(422);
      expect(refused.body.error.message).toContain('2');
      expect(refused.body.error.message).not.toMatch(/desfa/i);
    });
  });

  describe('data, horário e duração (RN-BOOK-12)', () => {
    it('move para outra data e libera o horário antigo', async () => {
      const booking = await book();
      const target = freshSlot();
      const res = await edit(booking.id, { startsAt: target.toISOString() }).expect(200);
      expect(res.body).toMatchObject({
        startsAt: target.toISOString(),
        endsAt: addMinutes(target, HOUR).toISOString(),
        durationMin: HOUR,
      });
      expect(await occupation(booking.id)).toMatchObject({
        active: true,
        period: { start: target, end: addMinutes(target, HOUR) },
      });
      // O horário antigo volta a ser reservável por outra pessoa.
      await book({ startsAt: booking.startsAt }, space, friend);
    });

    it('edita até o prazo de cancelamento, contado do início atual', async () => {
      const inTime = await seed({ startsAt: slotIn(HOUR) });
      await t.db.insert(courtOccupations).values({
        courtId: space.courtB,
        period: { start: inTime.startsAt, end: inTime.endsAt },
        kind: 'BOOKING',
        refId: inTime.id,
      });
      await t.db.update(bookings).set({ courtId: space.courtB }).where(eq(bookings.id, inTime.id));
      await edit(inTime.id, { startsAt: freshSlot().toISOString() }).expect(200);

      const late = await seed({ startsAt: slotIn(30) });
      await expectError(
        edit(late.id, { startsAt: freshSlot().toISOString() }),
        422,
        'BOOKING_EDIT_DEADLINE_PASSED',
      );
      await expectError(edit(late.id, { durationMin: 90 }), 422, 'BOOKING_EDIT_DEADLINE_PASSED');
    });

    it('recusa com pagamento registrado e volta a aceitar depois do estorno', async () => {
      const booking = await book();
      const payment = await pay(booking.id, 1_000);
      const refused = await edit(booking.id, { durationMin: 90 });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('BOOKING_HAS_PAYMENT');
      expect(refused.body.error.message).toContain('fale com o espaço');
      await expectError(
        edit(booking.id, { startsAt: freshSlot().toISOString() }),
        422,
        'BOOKING_HAS_PAYMENT',
      );

      await t
        .http()
        .post(`/v1/manage/spaces/${space.id}/payments/${payment.id}/reverse`)
        .set(...bearer(owner))
        .send({})
        .expect(200);
      await edit(booking.id, { durationMin: 90 }).expect(200);
    });

    it('o início fica em múltiplos de 30 min (RN-BOOK-02)', async () => {
      const booking = await book();
      await expectError(
        edit(booking.id, { startsAt: addMinutes(freshSlot(), 15).toISOString() }),
        422,
        'MISALIGNED_START',
      );
      await expectError(edit(booking.id, { durationMin: 45 }), 400, 'VALIDATION_ERROR');
    });

    it('respeita a duração mínima e a máxima', async () => {
      const booking = await book();
      await expectError(edit(booking.id, { durationMin: 30 }), 422, 'DURATION_OUT_OF_RANGE');
      await expectError(edit(booking.id, { durationMin: 240 }), 422, 'DURATION_OUT_OF_RANGE');
    });

    it('respeita a antecedência e a janela (RN-BOOK-06)', async () => {
      const booking = await book();
      await expectError(
        edit(booking.id, { startsAt: currentSlot().toISOString() }),
        422,
        'BOOKING_IN_THE_PAST',
      );
      await expectError(
        edit(booking.id, { startsAt: slotIn(0).toISOString() }),
        422,
        'BOOKING_TOO_SOON',
      );
      await expectError(
        edit(booking.id, { startsAt: slotIn(31 * 24 * HOUR).toISOString() }),
        422,
        'BOOKING_BEYOND_WINDOW',
      );
    });

    it('respeita o funcionamento, também ao esticar a duração', async () => {
      const limited = await createSpace(t.db, 'arena-edicao-horario');
      await t.db
        .update(spaceOpeningHours)
        .set({ opensAt: '08:00', closesAt: '22:00' })
        .where(eq(spaceOpeningHours.spaceId, limited.id));
      const booking = await book({ startsAt: tomorrowAt(21).toISOString() }, limited);
      await expectError(
        edit(booking.id, { startsAt: tomorrowAt(23).toISOString() }),
        422,
        'OUTSIDE_OPENING_HOURS',
      );
      await expectError(edit(booking.id, { durationMin: 120 }), 422, 'OUTSIDE_OPENING_HOURS');
      await edit(booking.id, { startsAt: tomorrowAt(20).toISOString(), durationMin: 120 }).expect(
        200,
      );
    });

    it('encurtar, mover 30 min e esticar não conflitam com a própria reserva', async () => {
      const start = freshSlot();
      const booking = await book({ startsAt: start.toISOString(), durationMin: 120 });

      await edit(booking.id, { durationMin: HOUR }).expect(200);
      expect((await occupation(booking.id))?.period).toEqual({
        start,
        end: addMinutes(start, HOUR),
      });

      const shifted = addMinutes(start, 30);
      await edit(booking.id, { startsAt: shifted.toISOString() }).expect(200);
      await edit(booking.id, { durationMin: 120 }).expect(200);
      expect((await occupation(booking.id))?.period).toEqual({
        start: shifted,
        end: addMinutes(shifted, 120),
      });
    });

    it('conflito com outra reserva ou bloqueio responde 409 e não muda nada', async () => {
      const taken = freshSlot();
      await book({ startsAt: taken.toISOString() }, space, friend);
      const booking = await book();

      await expectError(
        edit(booking.id, { startsAt: taken.toISOString() }),
        409,
        'SLOT_UNAVAILABLE',
      );
      const blocked = freshSlot();
      await t.db.insert(courtOccupations).values(block(blocked, addMinutes(blocked, HOUR)));
      await expectError(
        edit(booking.id, { startsAt: blocked.toISOString(), peopleCount: 3 }),
        409,
        'SLOT_UNAVAILABLE',
      );

      expect(await detail(booking.id)).toMatchObject({
        startsAt: booking.startsAt,
        peopleCount: 2,
      });
      expect((await occupation(booking.id))?.period.start).toEqual(new Date(booking.startsAt));
    });

    it('reenviar os valores atuais não conta como mudança, mesmo fora do prazo', async () => {
      const late = await seed({ startsAt: slotIn(30) });
      const res = await edit(late.id, {
        peopleCount: 3,
        startsAt: late.startsAt.toISOString(),
        durationMin: late.durationMin,
      }).expect(200);
      expect(res.body.peopleCount).toBe(3);

      const booking = await book();
      await edit(booking.id, {
        peopleCount: booking.peopleCount,
        startsAt: booking.startsAt,
      }).expect(200);
      const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, booking.id));
      expect(logs).toHaveLength(0);
    });
  });

  describe('o que a edição recalcula (RN-BOOK-13)', () => {
    it('preço pelo valor/hora guardado, mesmo com o preço do espaço já alterado', async () => {
      const repriced = await createSpace(t.db, 'arena-edicao-preco');
      const booking = await book({}, repriced);
      await t.db
        .update(spaceSettings)
        .set({ pricePerHourCents: PRICE_PER_HOUR * 3 })
        .where(eq(spaceSettings.spaceId, repriced.id));

      const res = await edit(booking.id, { durationMin: 90 }).expect(200);
      expect(res.body).toMatchObject({
        durationMin: 90,
        pricePerHourCents: PRICE_PER_HOUR,
        priceCents: 15_000,
      });
    });

    it('partes de todos os participantes ao mudar pessoas ou duração (RN-BOOK-09)', async () => {
      const booking = await book({ peopleCount: 4 });
      await invite(booking.id, ['Ana', 'Bruno']);

      // R$ 100 para 3: o organizador fica com a diferença do arredondamento.
      let body = (await edit(booking.id, { peopleCount: 3 }).expect(200)).body as Detail;
      expect(body.participants.map((p) => p.shareCents)).toEqual([3334, 3333, 3333]);
      expect(body.myShare.shareCents).toBe(3334);

      // R$ 200 para 3.
      body = (await edit(booking.id, { durationMin: 120 }).expect(200)).body as Detail;
      expect(body.participants.map((p) => p.shareCents)).toEqual([6668, 6666, 6666]);
      expect(body.priceCents).toBe(20_000);
    });

    it('o convidado que recusou acompanha a parte, para voltar certo se for reconvidado', async () => {
      const booking = await book({ peopleCount: 3 });
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'decline', stranger);
      await edit(booking.id, { peopleCount: 2 }).expect(200);
      const rows = await t.db
        .select({ shareCents: bookingParticipants.shareCents })
        .from(bookingParticipants)
        .where(eq(bookingParticipants.id, guest?.id ?? ''));
      expect(rows).toEqual([{ shareCents: 5_000 }]);
    });

    it('reserva sem divisão: a parte do organizador segue o preço novo', async () => {
      const booking = await book();
      const res = await edit(booking.id, { durationMin: 90 }).expect(200);
      expect(res.body.myShare.shareCents).toBe(15_000);
      expect(res.body.participants).toEqual([]);
    });

    it('o lembrete volta a nulo só quando o início muda', async () => {
      const booking = await book();
      const mark = () =>
        t.db
          .update(bookings)
          .set({ reminderSentAt: new Date() })
          .where(eq(bookings.id, booking.id));
      const reminder = async () => {
        const [row] = await t.db
          .select({ reminderSentAt: bookings.reminderSentAt })
          .from(bookings)
          .where(eq(bookings.id, booking.id));
        return row?.reminderSentAt;
      };

      await mark();
      await edit(booking.id, { peopleCount: 3 }).expect(200);
      expect(await reminder()).not.toBeNull();
      await edit(booking.id, { durationMin: 90 }).expect(200);
      expect(await reminder()).not.toBeNull();

      await edit(booking.id, { startsAt: freshSlot().toISOString() }).expect(200);
      expect(await reminder()).toBeNull();
    });

    it('audita o antes e o depois', async () => {
      const booking = await book();
      const target = freshSlot();
      await edit(booking.id, {
        peopleCount: 3,
        startsAt: target.toISOString(),
        durationMin: 90,
      }).expect(200);

      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'booking.update'), eq(auditLogs.entityId, booking.id)));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorId: organizer.id,
        actingAsSuper: false,
        spaceId: space.id,
        entity: 'booking',
        diff: {
          from: {
            peopleCount: 2,
            startsAt: booking.startsAt,
            durationMin: HOUR,
            priceCents: PRICE_PER_HOUR,
          },
          to: {
            peopleCount: 3,
            startsAt: target.toISOString(),
            durationMin: 90,
            priceCents: 15_000,
          },
        },
      });
    });
  });

  describe('concorrência (RN-BOOK-03)', () => {
    /**
     * Deadlock na constraint: a escrita espera esta transação e depois esta espera a escrita. O
     * Postgres derruba a escrita, que começou a esperar antes.
     */
    const inDeadlock = async (target: Date, write: () => Promise<Reply>) => {
      const middle = addMinutes(target, HOUR);
      let pending: Promise<Reply> | undefined;
      await t.db.transaction(async (tx) => {
        await tx.insert(courtOccupations).values(block(middle, addMinutes(middle, HOUR)));
        pending = write();
        await waitForLockWait();
        await tx.insert(courtOccupations).values(block(target, middle));
      });
      return pending;
    };

    const activeIn = async (start: Date, end: Date) => {
      const rows = await t.db
        .select()
        .from(courtOccupations)
        .where(
          and(
            eq(courtOccupations.courtId, space.courtA),
            eq(courtOccupations.active, true),
            sql`${courtOccupations.period} && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`,
          ),
        );
      return rows;
    };

    it('edição e reserva nova no mesmo horário: só uma fica com ele', async () => {
      const booking = await book();
      const target = freshSlot();
      const [edited, created] = await Promise.all([
        edit(booking.id, { startsAt: target.toISOString() }).then((res) => res),
        t
          .http()
          .post('/v1/bookings')
          .set(...bearer(friend))
          .send({
            spaceId: space.id,
            courtId: space.courtA,
            sportId: space.sportId,
            startsAt: target.toISOString(),
            durationMin: HOUR,
            peopleCount: 2,
          })
          .then((res) => res),
      ]);

      const statuses = [edited.status, created.status];
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);
      expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);
      const loser = edited.status === 409 ? edited : created;
      expect(loser.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await activeIn(target, addMinutes(target, HOUR))).toHaveLength(1);
    });

    it('duas edições para o mesmo horário: a perdedora fica onde estava', async () => {
      const first = await book();
      const second = await book();
      const target = freshSlot();
      const responses = await Promise.all(
        [first, second].map((b) =>
          edit(b.id, { startsAt: target.toISOString() }).then((res) => res),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = responses[0]?.status === 409 ? first : second;
      expect((await detail(loser.id)).startsAt).toBe(loser.startsAt);
      expect((await occupation(loser.id))?.period.start).toEqual(new Date(loser.startsAt));
      expect(await activeIn(target, addMinutes(target, HOUR))).toHaveLength(1);
    });

    it('espera a transação em andamento e recebe 409 quando ela confirma', async () => {
      const booking = await book();
      const target = freshSlot();
      let pending: Promise<Reply> | undefined;
      await t.db.transaction(async (tx) => {
        await tx.insert(courtOccupations).values(block(target, addMinutes(target, HOUR)));
        pending = edit(booking.id, { startsAt: target.toISOString() }).then((res) => res);
        await waitForLockWait();
      });
      const res = await pending;
      expect(res?.status).toBe(409);
      expect(res?.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect((await detail(booking.id)).startsAt).toBe(booking.startsAt);
    });

    it('conflito que vira deadlock na constraint também responde 409, não 500', async () => {
      const booking = await book();
      const target = freshSlot();
      const res = await inDeadlock(target, () =>
        edit(booking.id, { startsAt: target.toISOString(), durationMin: 120 }).then((r) => r),
      );
      expect(res?.status).toBe(409);
      expect(res?.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('bloqueio da gestão que vira deadlock também responde 409, não 500', async () => {
      const target = freshSlot();
      const res = await inDeadlock(target, () =>
        t
          .http()
          .post(`/v1/manage/spaces/${space.id}/court-blocks`)
          .set(...bearer(owner))
          .send({
            courtId: space.courtA,
            startsAt: target.toISOString(),
            endsAt: addMinutes(target, 120).toISOString(),
          })
          .then((r) => r),
      );
      expect(res?.status).toBe(409);
      expect(res?.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('não troca as partes de um convite aceito em paralelo pela metade', async () => {
      const booking = await book({ peopleCount: 3 });
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      const [edited] = await Promise.all([
        edit(booking.id, { peopleCount: 2 }).then((res) => res),
        respond(guest?.inviteToken ?? null, 'accept', friend).then((res) => res),
      ]);
      expect(edited.status).toBe(200);
      const { participants } = await detail(booking.id);
      expect(participants.map((p) => p.shareCents)).toEqual([5_000, 5_000]);
    });
  });

  describe('notificações', () => {
    const received = async (user: SignedUp, bookingId: string) =>
      (await inbox(t, user, '?limit=100')).items.filter(
        (n) => n.data?.bookingId === bookingId || n.data?.spaceBookingId === bookingId,
      );

    it('avisa quem aceitou e a gestão; não avisa quem editou, pendente nem Professor', async () => {
      const booking = await book({ peopleCount: 4 });
      const invited = await invite(booking.id, ['Ana', 'Bruno']);
      const [accepted] = invited.participants.filter((p) => !p.isOrganizer);
      await respond(accepted?.inviteToken ?? null, 'accept', friend);

      await edit(booking.id, { durationMin: 90, peopleCount: 3 }).expect(200);

      const player = await received(friend, booking.id);
      expect(player.filter((n) => n.type === 'BOOKING_UPDATED')).toHaveLength(1);
      expect(player.find((n) => n.type === 'BOOKING_UPDATED')).toMatchObject({
        title: 'Reserva alterada',
        data: { bookingId: booking.id, spaceId: space.id },
      });
      expect(player.find((n) => n.type === 'BOOKING_UPDATED')?.body).toContain('3 pessoas');

      for (const manager of [owner, admin]) {
        const items = await received(manager, booking.id);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          type: 'SPACE_BOOKING_UPDATED',
          title: 'Organizador alterou a reserva',
          data: { spaceBookingId: booking.id, spaceId: space.id },
        });
        // `bookingId` abriria a reserva do jogador no app, que dá 404 para a gestão.
        expect(items[0]?.data).not.toHaveProperty('bookingId');
      }

      expect(
        (await received(organizer, booking.id)).filter((n) => n.type === 'BOOKING_UPDATED'),
      ).toHaveLength(0);
      expect(await received(teacher, booking.id)).toHaveLength(0);
    });

    it('cada público segue a própria preferência', async () => {
      await t
        .http()
        .patch('/v1/me/notification-preferences')
        .set(...bearer(admin))
        .send({ items: [{ type: 'SPACE_BOOKING_UPDATED', inApp: false, push: false }] })
        .expect(200);
      await t
        .http()
        .patch('/v1/me/notification-preferences')
        .set(...bearer(friend))
        .send({ items: [{ type: 'BOOKING_UPDATED', inApp: false, push: false }] })
        .expect(200);
      try {
        const booking = await book({ peopleCount: 3 });
        const invited = await invite(booking.id, ['Ana']);
        const guest = invited.participants.find((p) => !p.isOrganizer);
        await respond(guest?.inviteToken ?? null, 'accept', friend);
        await edit(booking.id, { durationMin: 90 }).expect(200);

        expect(await received(admin, booking.id)).toHaveLength(0);
        expect(
          (await received(friend, booking.id)).filter((n) => n.type === 'BOOKING_UPDATED'),
        ).toHaveLength(0);
        expect(await received(owner, booking.id)).toHaveLength(1);
      } finally {
        await t.db
          .delete(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.userId, admin.id),
              eq(notificationPreferences.type, 'SPACE_BOOKING_UPDATED'),
            ),
          );
        await t.db
          .delete(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.userId, friend.id),
              eq(notificationPreferences.type, 'BOOKING_UPDATED'),
            ),
          );
      }
    });

    it('quem é da gestão e joga recebe só o aviso de jogador; o organizador da gestão, nada', async () => {
      const booking = await book({ peopleCount: 3 }, space, organizer);
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'accept', owner);
      await edit(booking.id, { durationMin: 90 }).expect(200);
      expect((await received(owner, booking.id)).map((n) => n.type)).toEqual(['BOOKING_UPDATED']);

      const own = await book({}, space, admin);
      await edit(own.id, { durationMin: 90 }, admin).expect(200);
      expect(
        (await received(admin, own.id)).filter((n) => n.type.endsWith('BOOKING_UPDATED')),
      ).toHaveLength(0);
    });

    it('reenviar os valores atuais não notifica', async () => {
      const booking = await book();
      await edit(booking.id, { peopleCount: booking.peopleCount }).expect(200);
      expect(await received(owner, booking.id)).toHaveLength(0);
    });

    it('edição recusada não notifica', async () => {
      const booking = await book();
      await edit(booking.id, { durationMin: 30 }).expect(422);
      expect(await received(owner, booking.id)).toHaveLength(0);
    });
  });

  describe('disponibilidade com excludeBookingId (RN-BOOK-12)', () => {
    const availability = (query: Record<string, string | number>, user?: SignedUp) => {
      const request = t.http().get(`/v1/spaces/${space.id}/availability`).query(query);
      return user ? request.set(...bearer(user)) : request;
    };
    const query = (startsAt: Date, durationMin = HOUR) => ({
      date: utcToZoned(startsAt, TZ).date,
      durationMin,
      sportId: space.sportId,
      courtId: space.courtA,
    });
    const slot = (
      body: { courts: { slots: { startsAt: string; available: boolean }[] }[] },
      startsAt: Date,
    ) => body.courts[0]?.slots.find((s) => s.startsAt === startsAt.toISOString());

    it('oferece o horário da própria reserva só para a edição dela', async () => {
      const start = freshSlot();
      const booking = await book({ startsAt: start.toISOString() });

      const anonymous = await availability(query(start)).expect(200);
      expect(slot(anonymous.body, start)?.available).toBe(false);

      const editing = await availability(
        { ...query(start), excludeBookingId: booking.id },
        organizer,
      ).expect(200);
      expect(slot(editing.body, start)?.available).toBe(true);
    });

    it('a reserva de outra pessoa continua ocupada', async () => {
      const start = freshSlot();
      const taken = addMinutes(start, 120);
      const booking = await book({ startsAt: start.toISOString() });
      await book({ startsAt: taken.toISOString() }, space, friend);
      const editing = await availability(
        { ...query(start), excludeBookingId: booking.id },
        organizer,
      ).expect(200);
      expect(slot(editing.body, taken)?.available).toBe(false);
    });

    it('exige sessão, e sessão só vale para quem organiza a reserva neste espaço', async () => {
      const start = freshSlot();
      const booking = await book({ startsAt: start.toISOString() });
      const params = { ...query(start), excludeBookingId: booking.id };

      const anonymous = await availability(params);
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

      const other = await availability(params, stranger);
      expect(other.status).toBe(404);
      expect(other.body.error.code).toBe('BOOKING_NOT_FOUND');

      // Participante vê a reserva, mas não a edita.
      const shared = await book({ peopleCount: 3 });
      const invited = await invite(shared.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'accept', friend);
      await availability({ ...params, excludeBookingId: shared.id }, friend).expect(404);

      const elsewhere = await createSpace(t.db, 'arena-edicao-outra');
      await t
        .http()
        .get(`/v1/spaces/${elsewhere.id}/availability`)
        .query({ ...params, sportId: elsewhere.sportId, courtId: elsewhere.courtA })
        .set(...bearer(organizer))
        .expect(404);
    });

    it('conta bloqueada ou inativa não usa excludeBookingId, como nas rotas com sessão', async () => {
      const blockedUser = await signUp(t, 'bloqueado@exemplo.com', 'Bloqueado');
      const booking = await book({}, space, blockedUser);
      const params = { ...query(new Date(booking.startsAt)), excludeBookingId: booking.id };

      await t.db.execute(sql`UPDATE users SET status = 'BLOCKED' WHERE id = ${blockedUser.id}`);
      const blocked = await availability(params, blockedUser);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('USER_BLOCKED');

      await t.db.execute(sql`UPDATE users SET status = 'INACTIVE' WHERE id = ${blockedUser.id}`);
      const inactive = await availability(params, blockedUser);
      expect(inactive.status).toBe(403);
      expect(inactive.body.error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('sem excludeBookingId a rota segue pública, mesmo com token inválido', async () => {
      await t
        .http()
        .get(`/v1/spaces/${space.id}/availability`)
        .query(query(freshSlot()))
        .set('authorization', 'Bearer token-invalido')
        .expect(200);
    });

    it('os preços usam o valor/hora guardado na reserva', async () => {
      const repriced = await createSpace(t.db, 'arena-edicao-grade');
      const start = freshSlot();
      const booking = await book({ startsAt: start.toISOString() }, repriced);
      await t.db
        .update(spaceSettings)
        .set({ pricePerHourCents: PRICE_PER_HOUR * 3 })
        .where(eq(spaceSettings.spaceId, repriced.id));
      const res = await t
        .http()
        .get(`/v1/spaces/${repriced.id}/availability`)
        .query({
          date: utcToZoned(start, TZ).date,
          durationMin: 90,
          sportId: repriced.sportId,
          excludeBookingId: booking.id,
        })
        .set(...bearer(organizer))
        .expect(200);
      expect(res.body).toMatchObject({ pricePerHourCents: PRICE_PER_HOUR, priceCents: 15_000 });
    });
  });

  describe('flags no detalhe', () => {
    const flags = ({
      canEditPeople,
      peopleEditBlock,
      canEditSchedule,
      scheduleEditBlock,
    }: Detail) => ({
      canEditPeople,
      people: peopleEditBlock?.code ?? null,
      canEditSchedule,
      schedule: scheduleEditBlock?.code ?? null,
    });

    it('reserva nova: tudo liberado e sem motivo', async () => {
      const booking = await book();
      expect(flags(booking)).toEqual({
        canEditPeople: true,
        people: null,
        canEditSchedule: true,
        schedule: null,
      });
    });

    it('depois do prazo: só as pessoas, com o motivo em texto', async () => {
      const late = await seed({ startsAt: slotIn(30) });
      const body = await detail(late.id);
      expect(flags(body)).toEqual({
        canEditPeople: true,
        people: null,
        canEditSchedule: false,
        schedule: 'BOOKING_EDIT_DEADLINE_PASSED',
      });
      expect(body.scheduleEditBlock?.message).toContain('Fale com o espaço');
    });

    it('com pagamento: só as pessoas', async () => {
      const booking = await book();
      await pay(booking.id, PRICE_PER_HOUR);
      const body = await detail(booking.id);
      expect(flags(body)).toMatchObject({
        canEditPeople: true,
        canEditSchedule: false,
        schedule: 'BOOKING_HAS_PAYMENT',
      });
      expect(body.scheduleEditBlock?.message).toContain('fale com o espaço');
    });

    it('depois do início e depois do fim: nada', async () => {
      const started = await seed({ startsAt: currentSlot() });
      expect(flags(await detail(started.id))).toEqual({
        canEditPeople: false,
        people: 'BOOKING_STARTED',
        canEditSchedule: false,
        schedule: 'BOOKING_EDIT_DEADLINE_PASSED',
      });
      const ended = await seed({ startsAt: addMinutes(currentSlot(), -3 * HOUR) });
      expect(flags(await detail(ended.id))).toMatchObject({
        people: 'BOOKING_ENDED',
        schedule: 'BOOKING_ENDED',
      });
    });

    it('balcão, mensalista, cancelada e espaço suspenso: nada, com o motivo de cada um', async () => {
      const desk = await seed({ startsAt: slotIn(2 * HOUR), source: 'DESK' });
      expect(flags(await detail(desk.id)).people).toBe('BOOKING_NOT_EDITABLE');

      const { id: recurringBookingId } = await recurring();
      const occurrence = await seed({
        startsAt: slotIn(3 * HOUR),
        source: 'RECURRING',
        recurringBookingId,
      });
      expect(flags(await detail(occurrence.id)).schedule).toBe('BOOKING_NOT_EDITABLE');

      const cancelled = await seed({ startsAt: slotIn(4 * HOUR), status: 'CANCELLED' });
      expect(flags(await detail(cancelled.id)).schedule).toBe('INVALID_BOOKING_STATUS');

      const suspended = await createSpace(t.db, 'arena-edicao-flags');
      const booking = await book({}, suspended);
      await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, suspended.id));
      expect(flags(await detail(booking.id))).toMatchObject({
        people: 'SPACE_READ_ONLY',
        schedule: 'SPACE_READ_ONLY',
      });
    });

    it('quadra inativa e esporte retirado: nada, com o motivo de cada um', async () => {
      const closed = await createSpace(t.db, 'arena-edicao-flag-quadra');
      const inactive = await book({}, closed);
      await t.db.update(courts).set({ status: 'INACTIVE' }).where(eq(courts.id, closed.courtA));
      const inactiveDetail = await detail(inactive.id);
      expect(flags(inactiveDetail)).toEqual({
        canEditPeople: false,
        people: 'COURT_UNAVAILABLE',
        canEditSchedule: false,
        schedule: 'COURT_UNAVAILABLE',
      });
      expect(inactiveDetail.peopleEditBlock?.message).toContain('Fale com o espaço');

      const retired = await createSpace(t.db, 'arena-edicao-flag-esporte');
      const noSport = await book({}, retired);
      await t.db.delete(courtSports).where(eq(courtSports.courtId, retired.courtA));
      expect(flags(await detail(noSport.id))).toMatchObject({
        people: 'SPORT_NOT_OFFERED',
        schedule: 'SPORT_NOT_OFFERED',
      });
    });

    it('participante vê a reserva, mas as flags vêm falsas', async () => {
      const booking = await book({ peopleCount: 3 });
      const invited = await invite(booking.id, ['Ana']);
      const guest = invited.participants.find((p) => !p.isOrganizer);
      await respond(guest?.inviteToken ?? null, 'accept', friend);
      expect(flags(await detail(booking.id, friend))).toEqual({
        canEditPeople: false,
        people: 'NOT_BOOKING_ORGANIZER',
        canEditSchedule: false,
        schedule: 'NOT_BOOKING_ORGANIZER',
      });
    });
  });
});

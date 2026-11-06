import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attendances,
  bookingParticipants,
  bookings,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  courts,
  plans,
  spaceMembers,
  spaceSettings,
  subscriptions,
} from '../../src/db/schema/index.js';
import { Geocoder } from '../../src/geocoding/geocoder.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';
import { bearer, type Row } from '../super/fixtures.js';
import {
  type Catalog,
  createSpace,
  FakeGeocoder,
  member,
  seedCatalog,
  setSpaceStatus,
} from './fixtures.js';

// QA (AD.5), RF-SPACE-12: bordas do critério dos espaços recentes que recent.int.test.ts não
// cobre (aula cancelada ou com presença cancelada, falta, convite recusado, assinatura recusada,
// reserva do balcão, vitrine por preço/quadra, repetição do mesmo espaço).

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('GET /v1/me/recent-spaces: bordas (QA, RF-SPACE-12)', () => {
  let t: TestApp;
  let catalog: Catalog;

  beforeAll(async () => {
    t = await createTestApp({ providers: [{ provide: Geocoder, useValue: new FakeGeocoder() }] });
    catalog = await seedCatalog(t.db);
  });
  afterAll(() => t.close());

  const names = async (user: SignedUp) =>
    (
      (
        await t
          .http()
          .get('/v1/me/recent-spaces')
          .set(...bearer(user))
          .expect(200)
      ).body.items as Row[]
    ).map((row) => row.name);

  const courtOf = async (spaceId: string) =>
    first(await t.db.select().from(courts).where(eq(courts.spaceId, spaceId)));

  async function booking(
    spaceId: string,
    organizerUserId: string | null,
    startsInMs: number,
    status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' = 'CONFIRMED',
  ) {
    const court = await courtOf(spaceId);
    const startsAt = new Date(Date.now() + startsInMs);
    return first(
      await t.db
        .insert(bookings)
        .values({
          spaceId,
          courtId: court.id,
          organizerUserId,
          guestName: organizerUserId ? null : 'Cliente do balcão',
          sportId: catalog.sport('futevolei').id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR),
          durationMin: 60,
          peopleCount: 4,
          pricePerHourCents: 10_000,
          priceCents: 10_000,
          source: organizerUserId ? 'APP' : 'DESK',
          status,
        })
        .returning(),
    );
  }

  async function attendance(
    spaceId: string,
    userId: string,
    startsInMs: number,
    status: 'CONFIRMED' | 'WAITLIST' | 'PRESENT' | 'ABSENT' | 'CANCELLED',
    sessionStatus: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED',
  ) {
    const court = await courtOf(spaceId);
    const teacher = await member(t, `prof-${randomUUID()}@exemplo.com`, spaceId, 'TEACHER');
    const [teacherMember] = await t.db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, teacher.id));
    const teacherMemberId = teacherMember?.id ?? '';
    const group = await t.db.transaction(async (tx) => {
      const row = first(
        await tx
          .insert(classGroups)
          .values({
            spaceId,
            courtId: court.id,
            sportId: catalog.sport('futevolei').id,
            name: `Turma ${randomUUID()}`,
            weekday: 1,
            startTime: '19:00',
            durationMin: 60,
            capacity: 8,
          })
          .returning(),
      );
      await tx
        .insert(classGroupTeachers)
        .values({ classGroupId: row.id, spaceId, teacherMemberId });
      return row;
    });
    const startsAt = new Date(Date.now() + startsInMs);
    const session = await t.db.transaction(async (tx) => {
      const row = first(
        await tx
          .insert(classSessions)
          .values({
            classGroupId: group.id,
            spaceId,
            courtId: court.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + HOUR),
            capacity: 8,
            status: sessionStatus,
          })
          .returning(),
      );
      await tx
        .insert(classSessionTeachers)
        .values({ classSessionId: row.id, spaceId, teacherMemberId });
      return row;
    });
    await t.db.insert(attendances).values({
      sessionId: session.id,
      userId,
      status,
      waitlistPosition: status === 'WAITLIST' ? 1 : null,
    });
  }

  async function subscription(
    spaceId: string,
    userId: string,
    createdAt: Date,
    extra: { status?: 'PENDING_APPROVAL' | 'ACTIVE' | 'CANCELLED'; rejectedAt?: Date } = {},
  ) {
    const plan = first(
      await t.db
        .insert(plans)
        .values({
          spaceId,
          sportId: catalog.sport('futevolei').id,
          name: `Plano ${randomUUID()}`,
          priceCents: 20_000,
          billingDay: 10,
        })
        .returning(),
    );
    await t.db.insert(subscriptions).values({
      userId,
      planId: plan.id,
      spaceId,
      priceCents: 20_000,
      status: extra.status ?? 'ACTIVE',
      createdAt,
      ...(extra.rejectedAt ? { rejectedAt: extra.rejectedAt } : {}),
    });
  }

  const space = (name: string) => createSpace(t.db, catalog, { name, photos: 1 });

  it('aula: falta e presença contam; presença cancelada, aula cancelada e lista de espera não', async () => {
    const user = await signUp(t, 'qa-recentes-aula@exemplo.com');
    const absent = await space('QA Faltei');
    const confirmed = await space('QA Aula confirmada futura');
    const cancelledAttendance = await space('QA Presença cancelada');
    const cancelledSession = await space('QA Aula cancelada');
    const waitlist = await space('QA Lista de espera');
    await attendance(absent.id, user.id, -2 * DAY, 'ABSENT');
    await attendance(confirmed.id, user.id, 3 * DAY, 'CONFIRMED');
    await attendance(cancelledAttendance.id, user.id, -1 * DAY, 'CANCELLED');
    await attendance(cancelledSession.id, user.id, -1 * DAY, 'CONFIRMED', 'CANCELLED');
    await attendance(waitlist.id, user.id, 1 * DAY, 'WAITLIST');
    // Aula futura vale pela data em que o aluno entrou (agora): vem antes da falta de 2 dias atrás.
    expect(await names(user)).toEqual(['QA Aula confirmada futura', 'QA Faltei']);
  });

  it('reserva: convite recusado, reserva do balcão e reserva de outra pessoa não contam', async () => {
    const user = await signUp(t, 'qa-recentes-reserva@exemplo.com');
    const other = await signUp(t, 'qa-recentes-outro@exemplo.com');
    const declined = await space('QA Convite recusado');
    const counter = await space('QA Balcão');
    const mine = await space('QA Minha reserva');
    const completed = await space('QA Reserva concluída');
    const declinedBooking = await booking(declined.id, other.id, -1 * DAY);
    await t.db.insert(bookingParticipants).values({
      bookingId: declinedBooking.id,
      userId: user.id,
      inviteToken: randomUUID(),
      shareCents: 2500,
      status: 'DECLINED',
    });
    await booking(counter.id, null, -1 * DAY);
    await booking(mine.id, user.id, -3 * HOUR);
    await booking(completed.id, user.id, -5 * DAY, 'COMPLETED');
    expect(await names(user)).toEqual(['QA Minha reserva', 'QA Reserva concluída']);
  });

  it('assinatura: recusada não conta; pendente e cancelada (não recusadas) contam pela data do pedido', async () => {
    const user = await signUp(t, 'qa-recentes-assinatura@exemplo.com');
    const rejected = await space('QA Assinatura recusada');
    const pending = await space('QA Assinatura pendente');
    const cancelled = await space('QA Assinatura cancelada');
    await subscription(rejected.id, user.id, new Date(Date.now() - 1 * DAY), {
      status: 'PENDING_APPROVAL',
      rejectedAt: new Date(),
    });
    await subscription(pending.id, user.id, new Date(Date.now() - 2 * DAY), {
      status: 'PENDING_APPROVAL',
    });
    await subscription(cancelled.id, user.id, new Date(Date.now() - 3 * DAY), {
      status: 'CANCELLED',
    });
    expect(await names(user)).toEqual(['QA Assinatura pendente', 'QA Assinatura cancelada']);
  });

  it('o mesmo espaço aparece uma vez, na posição da interação mais recente', async () => {
    const user = await signUp(t, 'qa-recentes-repetido@exemplo.com');
    const repeated = await space('QA Repetido');
    const older = await space('QA Mais antigo');
    const newer = await space('QA Mais novo');
    await booking(older.id, user.id, -4 * DAY);
    await booking(repeated.id, user.id, -10 * DAY);
    await booking(repeated.id, user.id, -6 * DAY);
    await attendance(repeated.id, user.id, -5 * DAY, 'PRESENT');
    await subscription(repeated.id, user.id, new Date(Date.now() - 8 * DAY));
    await booking(newer.id, user.id, -1 * DAY);
    // 'Repetido' tem a interação mais recente em -5 dias: depois de 'Mais antigo' (-4 dias).
    expect(await names(user)).toEqual(['QA Mais novo', 'QA Mais antigo', 'QA Repetido']);
    // Dá a 'Repetido' uma reserva ontem à noite: sobe para o topo, ainda uma vez só.
    await booking(repeated.id, user.id, -2 * HOUR);
    expect(await names(user)).toEqual(['QA Repetido', 'QA Mais novo', 'QA Mais antigo']);
  });

  it('sai da vitrine por falta de preço ou de quadra ativa, e volta quando resolver', async () => {
    const user = await signUp(t, 'qa-recentes-vitrine@exemplo.com');
    const noPrice = await space('QA Sem preço');
    const noCourt = await space('QA Sem quadra');
    const closed = await space('QA Fechado');
    const fine = await space('QA Normal');
    for (const s of [noPrice, noCourt, closed, fine]) await booking(s.id, user.id, -2 * HOUR);
    await t.db
      .update(spaceSettings)
      .set({ pricePerHourCents: null })
      .where(eq(spaceSettings.spaceId, noPrice.id));
    await t.db.update(courts).set({ status: 'INACTIVE' }).where(eq(courts.spaceId, noCourt.id));
    await setSpaceStatus(t.db, closed.id, 'CLOSED');
    expect(await names(user)).toEqual(['QA Normal']);
    await t.db
      .update(spaceSettings)
      .set({ pricePerHourCents: 10_000 })
      .where(eq(spaceSettings.spaceId, noPrice.id));
    expect(await names(user)).toContain('QA Sem preço');
  });

  it('convite aceito de reserva futura vale pela data do aceite; o card traz só dados públicos', async () => {
    const user = await signUp(t, 'qa-recentes-aceite@exemplo.com');
    const other = await signUp(t, 'qa-recentes-dono@exemplo.com');
    const target = await space('QA Aceitou convite');
    const past = await space('QA Reserva de ontem');
    await booking(past.id, user.id, -1 * DAY);
    const future = await booking(target.id, other.id, 5 * DAY);
    await t.db.insert(bookingParticipants).values({
      bookingId: future.id,
      userId: user.id,
      inviteToken: randomUUID(),
      shareCents: 2500,
      status: 'ACCEPTED',
    });
    expect(await names(user)).toEqual(['QA Aceitou convite', 'QA Reserva de ontem']);
    const res = await t
      .http()
      .get('/v1/me/recent-spaces')
      .set(...bearer(user))
      .expect(200);
    const dump = JSON.stringify(res.body);
    for (const leak of ['qa-recentes-dono@exemplo.com', 'inviteToken', 'organizer', 'guestName']) {
      expect(dump, leak).not.toContain(leak);
    }
    expect(Object.keys(res.body)).toEqual(['items']);
  });
});

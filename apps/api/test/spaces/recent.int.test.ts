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

// RF-SPACE-12 (decisão 79): espaços recentes do usuário logado, a partir das reservas e aulas.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('GET /v1/me/recent-spaces (RF-SPACE-12)', () => {
  let t: TestApp;
  let catalog: Catalog;

  beforeAll(async () => {
    t = await createTestApp({ providers: [{ provide: Geocoder, useValue: new FakeGeocoder() }] });
    catalog = await seedCatalog(t.db);
  });
  afterAll(() => t.close());

  const recent = async (user: SignedUp) =>
    (
      await t
        .http()
        .get('/v1/me/recent-spaces')
        .set(...bearer(user))
        .expect(200)
    ).body.items as Row[];

  async function courtOf(spaceId: string) {
    return first(await t.db.select().from(courts).where(eq(courts.spaceId, spaceId)));
  }

  /** Reserva direta no banco (`startsAt` relativo a agora). */
  async function booking(
    spaceId: string,
    organizerUserId: string | null,
    startsInMs: number,
    extra: { status?: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'; createdAt?: Date } = {},
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
          source: 'APP',
          status: extra.status ?? 'CONFIRMED',
          ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
        })
        .returning(),
    );
  }

  async function participant(
    bookingId: string,
    userId: string,
    status: 'INVITED' | 'ACCEPTED' | 'DECLINED',
  ) {
    await t.db.insert(bookingParticipants).values({
      bookingId,
      userId,
      inviteToken: randomUUID(),
      shareCents: 2500,
      status,
    });
  }

  async function attendance(
    spaceId: string,
    userId: string,
    startsInMs: number,
    status: 'CONFIRMED' | 'WAITLIST' | 'PRESENT',
  ) {
    const court = await courtOf(spaceId);
    const teacher = await member(t, `prof-${randomUUID()}@exemplo.com`, spaceId, 'TEACHER');
    const [teacherMember] = await t.db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, teacher.id));
    const teacherMemberId = teacherMember?.id ?? '';
    // A turma e a sessão exigem professor (trigger): tudo na mesma transação.
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

  async function subscription(spaceId: string, userId: string, createdAt: Date) {
    const plan = first(
      await t.db
        .insert(plans)
        .values({
          spaceId,
          sportId: catalog.sport('futevolei').id,
          name: 'Plano 2x',
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
      status: 'ACTIVE',
      createdAt,
    });
  }

  it('ordena pela interação mais recente e ignora o que não conta', async () => {
    const user = await signUp(t, 'recentes@exemplo.com');
    const other = await signUp(t, 'outro-recentes@exemplo.com');
    const space = async (name: string) => createSpace(t.db, catalog, { name, photos: 1 });
    const pastBooking = await space('Reserva há 2 dias');
    const futureBooking = await space('Reserva futura feita agora');
    const accepted = await space('Convite aceito ontem');
    const invited = await space('Convite não aceito');
    const cancelled = await space('Reserva cancelada');
    const classSpace = await space('Aula há 3 dias');
    const waitlist = await space('Lista de espera');
    const subscribed = await space('Assinatura há 4 dias');
    const othersOnly = await space('Só do outro usuário');
    const suspended = await space('Suspenso');

    await booking(pastBooking.id, user.id, -2 * DAY);
    await booking(pastBooking.id, user.id, -20 * DAY);
    // Reserva para daqui a 10 dias, feita agora: vale a data em que foi feita.
    await booking(futureBooking.id, user.id, 10 * DAY);
    const acceptedBooking = await booking(accepted.id, other.id, -1 * DAY);
    await participant(acceptedBooking.id, user.id, 'ACCEPTED');
    const invitedBooking = await booking(invited.id, other.id, -HOUR);
    await participant(invitedBooking.id, user.id, 'INVITED');
    await booking(cancelled.id, user.id, -HOUR, { status: 'CANCELLED' });
    await attendance(classSpace.id, user.id, -3 * DAY, 'PRESENT');
    await attendance(waitlist.id, user.id, -HOUR, 'WAITLIST');
    await subscription(subscribed.id, user.id, new Date(Date.now() - 4 * DAY));
    await booking(othersOnly.id, other.id, -HOUR);
    await booking(suspended.id, user.id, -HOUR);
    await setSpaceStatus(t.db, suspended.id, 'SUSPENDED');

    const items = await recent(user);
    expect(items.map((row) => row.name)).toEqual([
      'Reserva futura feita agora',
      'Convite aceito ontem',
      'Reserva há 2 dias',
      'Aula há 3 dias',
      'Assinatura há 4 dias',
    ]);
    // Formato do card da vitrine.
    expect(items[0]).toMatchObject({
      id: futureBooking.id,
      slug: futureBooking.slug,
      city: 'Belo Horizonte',
      cover: { url: `https://fotos.test/${futureBooking.slug}/0.jpg` },
      pricePerHourCents: 10_000,
      distanceMeters: null,
      sports: [{ slug: 'futevolei', name: expect.any(String) }],
      services: ['RENTAL'],
    });

    // Só do próprio usuário (as reservas de 1 h atrás: a criada por último começa depois).
    expect((await recent(other)).map((row) => row.name)).toEqual([
      'Só do outro usuário',
      'Convite não aceito',
      'Convite aceito ontem',
    ]);
  });

  it('até 10 espaços, e o espaço que volta à vitrine reaparece', async () => {
    const user = await signUp(t, 'muitos-recentes@exemplo.com');
    const spaces = [];
    for (let i = 0; i < 12; i++) {
      const space = await createSpace(t.db, catalog, {
        name: `Recente ${String(i).padStart(2, '0')}`,
      });
      await booking(space.id, user.id, -(i + 1) * HOUR);
      spaces.push(space);
    }
    const items = await recent(user);
    expect(items.map((row) => row.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Recente ${String(i).padStart(2, '0')}`),
    );

    // O mais recente sai da vitrine: o 11º entra.
    await setSpaceStatus(t.db, spaces[0]?.id ?? '', 'SUSPENDED');
    expect((await recent(user)).map((row) => row.name).at(-1)).toBe('Recente 10');
    await setSpaceStatus(t.db, spaces[0]?.id ?? '', 'ACTIVE');
    expect((await recent(user))[0]?.name).toBe('Recente 00');
  });

  it('sem reservas nem aulas: lista vazia; sem login: 401', async () => {
    const user = await signUp(t, 'sem-recentes@exemplo.com');
    expect(await recent(user)).toEqual([]);
    await t.http().get('/v1/me/recent-spaces').expect(401);
  });
});

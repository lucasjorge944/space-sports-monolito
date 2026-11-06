import { addMinutes } from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import {
  attendances,
  bookingParticipants,
  bookings,
  classSessions,
  spaceReviews,
  spaces,
} from '../../src/db/schema/index.js';
import type { SignedUp, TestApp } from '../auth/helpers.js';
import { bearer, member, type Space } from '../bookings/fixtures.js';
import { insertGroup, insertSession } from '../classes/attendance-fixtures.js';
import { teacherMemberId } from '../classes/fixtures.js';
import { first } from '../db/helpers.js';

// Avaliações (AV.2): usos inseridos direto no banco, com o horário que o teste precisa.

export const DAY_MIN = 24 * 60;

let shift = 0;

/**
 * Reserva que terminou (ou termina) `endedMinAgo` minutos atrás (negativo = no futuro), de 60
 * min, sem ocupação de quadra (os testes se sobrepõem).
 */
export async function insertBooking(
  db: Database,
  space: Space,
  organizer: SignedUp | null,
  endedMinAgo: number,
  overrides: Partial<typeof bookings.$inferInsert> = {},
) {
  const endsAt = new Date(Date.now() - endedMinAgo * 60_000 - shift++ * 1000);
  return first(
    await db
      .insert(bookings)
      .values({
        spaceId: space.id,
        courtId: space.courtA,
        organizerUserId: organizer?.id ?? null,
        guestName: organizer ? null : 'Cliente de balcão',
        sportId: space.sportId,
        startsAt: addMinutes(endsAt, -60),
        endsAt,
        durationMin: 60,
        peopleCount: 2,
        pricePerHourCents: 10_000,
        priceCents: 10_000,
        source: 'APP',
        ...overrides,
      })
      .returning(),
  );
}

export async function addParticipant(
  db: Database,
  bookingId: string,
  user: SignedUp,
  status: 'INVITED' | 'ACCEPTED' | 'DECLINED' = 'ACCEPTED',
) {
  await db.insert(bookingParticipants).values({
    bookingId,
    userId: user.id,
    inviteToken: crypto.randomUUID(),
    shareCents: 5_000,
    status,
  });
}

/** Professor do espaço para as turmas dos testes (uma vez por espaço). */
const teachers = new Map<string, string>();
async function teacherOf(t: TestApp, space: Space) {
  const cached = teachers.get(space.id);
  if (cached) return cached;
  const teacher = await member(t, `prof-${space.id.slice(0, 8)}@exemplo.com`, space.id, 'TEACHER');
  const id = await teacherMemberId(t.db, teacher.id, space.id);
  teachers.set(space.id, id);
  return id;
}

/** Aula que terminou `endedMinAgo` minutos atrás, com a presença do aluno no status dado. */
export async function insertClassUse(
  t: TestApp,
  space: Space,
  student: SignedUp,
  endedMinAgo: number,
  attendance: 'CONFIRMED' | 'PRESENT' | 'ABSENT' | 'CANCELLED' | 'WAITLIST' = 'PRESENT',
  sessionOverrides: Partial<typeof classSessions.$inferInsert> = {},
) {
  const group = await insertGroup(t.db, space, await teacherOf(t, space));
  const session = await insertSession(t.db, group, -(endedMinAgo + 60), sessionOverrides);
  await t.db.insert(attendances).values({
    sessionId: session.id,
    userId: student.id,
    status: attendance,
    ...(attendance === 'WAITLIST' ? { waitlistPosition: 1 } : {}),
  });
  return session;
}

export const putReview = (t: TestApp, user: SignedUp, spaceId: string, body: object) =>
  t
    .http()
    .put(`/v1/spaces/${spaceId}/reviews/me`)
    .set(...bearer(user))
    .send(body);

export const eligibility = async (t: TestApp, user: SignedUp, spaceId: string) =>
  (
    await t
      .http()
      .get(`/v1/spaces/${spaceId}/reviews/eligibility`)
      .set(...bearer(user))
      .expect(200)
  ).body as {
    canReview: boolean;
    reason: string | null;
    myReview: Record<string, unknown> | null;
  };

/** Contagem e soma guardadas no espaço e as recalculadas das avaliações que contam. */
export async function ratingOf(db: Database, spaceId: string) {
  const stored = first(
    await db
      .select({ count: spaces.ratingCount, sum: spaces.ratingSum })
      .from(spaces)
      .where(eq(spaces.id, spaceId)),
  );
  const actual = first(
    await db
      .select({
        count: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${spaceReviews.rating}), 0)::int`,
      })
      .from(spaceReviews)
      .where(and(eq(spaceReviews.spaceId, spaceId), eq(spaceReviews.counted, true))),
  );
  return { stored, actual };
}

/** Jogador com uma reserva terminada há 3 h no espaço (pode avaliar). */
export async function playerWithUse(t: TestApp, space: Space, user: SignedUp) {
  await insertBooking(t.db, space, user, 180);
  return user;
}

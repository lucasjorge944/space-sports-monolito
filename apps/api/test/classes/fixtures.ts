import { and, eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import {
  attendances,
  cities,
  classSessions,
  classSessionTeachers,
  courtOccupations,
  enrollments,
  plans,
  spaceMembers,
  spaces,
  subscriptions,
} from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';

export { occurrenceDate, occurrenceStart, slotWeekday, today } from '../recurring/fixtures.js';

/** `space_members.id` do vínculo TEACHER (o que vai em `teacherMemberIds`). */
export async function teacherMemberId(db: Database, userId: string, spaceId: string) {
  const row = first(
    await db
      .select({ id: spaceMembers.id })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.userId, userId),
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.role, 'TEACHER'),
        ),
      ),
  );
  return row.id;
}

/** Ocupação avulsa da quadra (reserva/bloqueio), sem a linha de origem. */
export async function occupy(
  db: Database,
  courtId: string,
  start: Date,
  end: Date,
  kind: 'BOOKING' | 'BLOCK' = 'BOOKING',
) {
  return first(
    await db
      .insert(courtOccupations)
      .values({ courtId, period: { start, end }, kind, refId: crypto.randomUUID() })
      .returning(),
  );
}

/** Sessões da turma, por horário. */
export const sessionsOf = (db: Database, classGroupId: string) =>
  db
    .select()
    .from(classSessions)
    .where(eq(classSessions.classGroupId, classGroupId))
    .orderBy(classSessions.startsAt);

/** `teacherMemberIds` da aula, em ordem de id. */
export async function sessionTeacherIds(db: Database, sessionId: string) {
  const rows = await db
    .select({ id: classSessionTeachers.teacherMemberId })
    .from(classSessionTeachers)
    .where(eq(classSessionTeachers.classSessionId, sessionId))
    .orderBy(classSessionTeachers.teacherMemberId);
  return rows.map((row) => row.id);
}

/** Ocupações CLASS ativas das sessões. */
export async function classOccupations(db: Database, sessionIds: string[]) {
  const rows = await db
    .select()
    .from(courtOccupations)
    .where(and(eq(courtOccupations.kind, 'CLASS'), eq(courtOccupations.active, true)));
  return rows.filter((row) => sessionIds.includes(row.refId));
}

/**
 * Assinatura e matrícula ACTIVE direto no banco (a lógica de assinatura é da tarefa 2.2).
 * Devolve a assinatura.
 */
export async function enroll(
  db: Database,
  input: { userId: string; spaceId: string; sportId: string; classGroupId: string },
) {
  const plan = first(
    await db
      .insert(plans)
      .values({
        spaceId: input.spaceId,
        sportId: input.sportId,
        name: `Plano ${crypto.randomUUID().slice(0, 8)}`,
        weeklyFrequency: 1,
        priceCents: 15_000,
        billingDay: 10,
      })
      .returning(),
  );
  const subscription = first(
    await db
      .insert(subscriptions)
      .values({
        userId: input.userId,
        planId: plan.id,
        spaceId: input.spaceId,
        status: 'ACTIVE',
        priceCents: plan.priceCents,
      })
      .returning(),
  );
  await db.insert(enrollments).values({
    subscriptionId: subscription.id,
    classGroupId: input.classGroupId,
    startedOn: '2026-01-01',
  });
  return subscription;
}

export async function confirm(db: Database, sessionId: string, userId: string) {
  await db.insert(attendances).values({ sessionId, userId, status: 'CONFIRMED' });
}

/** Leva o espaço para Manaus (UTC−4, uma hora atrás de Belo Horizonte); cria a cidade se preciso. */
export async function moveToManaus(db: Database, spaceId: string) {
  const [existing] = await db.select().from(cities).where(eq(cities.name, 'Manaus'));
  const city =
    existing ??
    first(
      await db
        .insert(cities)
        .values({ name: 'Manaus', state: 'AM', timezone: 'America/Manaus' })
        .returning(),
    );
  await db.update(spaces).set({ cityId: city.id }).where(eq(spaces.id, spaceId));
}

/** Cancelamento pedido: a assinatura segue em curso até `endsOn` (RN-CLASS-08). */
export async function cancelUntil(db: Database, subscriptionId: string, endsOn: string) {
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, endsOn })
    .where(eq(subscriptions.id, subscriptionId));
}

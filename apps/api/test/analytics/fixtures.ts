import { addMinutes, zonedToUtc } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import {
  attendances,
  bookings,
  classGroups,
  classGroupTeachers,
  classSessions,
  classSessionTeachers,
  courtOccupations,
  paymentRecords,
  spaceOpeningHours,
} from '../../src/db/schema/index.js';
import type { Space } from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';

// Camada de métricas (docs/14-mcp.md 8.4): dados inseridos direto no banco, em datas fixas do
// passado, para os valores esperados não dependerem do relógio.

export const TZ = 'America/Sao_Paulo';

/** Instante de uma data e hora locais de São Paulo (`'2026-03-02', '23:30'`). */
export const local = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, TZ);
};

/** Funcionamento de todos os dias das 08:00 à meia-noite (16 h por dia e quadra). */
export async function openEightToMidnight(db: Database, spaceId: string) {
  await db.delete(spaceOpeningHours).where(eq(spaceOpeningHours.spaceId, spaceId));
  await db.insert(spaceOpeningHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      spaceId,
      weekday,
      opensAt: '08:00',
      closesAt: '00:00',
    })),
  );
}

type BookingInput = Partial<typeof bookings.$inferInsert> & {
  courtId: string;
  startsAt: Date;
  durationMin: number;
};

/**
 * Reserva com a ocupação da quadra: ativa para as que seguram o horário, inativa para as
 * canceladas (como o cancelamento deixa). Preço padrão: R$ 100/h.
 */
export async function insertBooking(db: Database, space: Space, input: BookingInput) {
  const { courtId, startsAt, durationMin, ...rest } = input;
  const status = rest.status ?? 'CONFIRMED';
  const row = first(
    await db
      .insert(bookings)
      .values({
        spaceId: space.id,
        courtId,
        sportId: space.sportId,
        startsAt,
        endsAt: addMinutes(startsAt, durationMin),
        durationMin,
        peopleCount: 2,
        pricePerHourCents: 10_000,
        priceCents: (10_000 * durationMin) / 60,
        source: 'APP',
        ...rest,
        status,
      })
      .returning(),
  );
  await db.insert(courtOccupations).values({
    courtId,
    period: { start: row.startsAt, end: row.endsAt },
    kind: 'BOOKING',
    refId: row.id,
    active: status !== 'CANCELLED',
  });
  return row;
}

/** Bloqueio da quadra (só a ocupação, que é o que a agenda e a ocupação leem). */
export async function insertBlock(db: Database, courtId: string, start: Date, end: Date) {
  await db
    .insert(courtOccupations)
    .values({ courtId, period: { start, end }, kind: 'BLOCK', refId: crypto.randomUUID() });
}

export async function insertGroup(
  db: Database,
  space: Space,
  input: { name: string; courtId: string; teacherMemberIds: string[]; sportId?: string },
) {
  // A turma precisa de professor ao fim da transação (trigger diferida).
  return db.transaction(async (tx) => {
    const group = first(
      await tx
        .insert(classGroups)
        .values({
          spaceId: space.id,
          sportId: input.sportId ?? space.sportId,
          courtId: input.courtId,
          name: input.name,
          weekday: 1,
          startTime: '08:00',
          durationMin: 60,
          capacity: 10,
        })
        .returning(),
    );
    await tx.insert(classGroupTeachers).values(
      input.teacherMemberIds.map((teacherMemberId) => ({
        classGroupId: group.id,
        spaceId: space.id,
        teacherMemberId,
      })),
    );
    return group;
  });
}

/**
 * Aula de 60 min com os professores e as marcações; a aula dada ocupa a quadra (`CLASS`), como
 * a geração faria.
 */
export async function insertSession(
  db: Database,
  group: typeof classGroups.$inferSelect,
  input: {
    startsAt: Date;
    status: 'DONE' | 'CANCELLED' | 'SCHEDULED';
    teacherMemberIds: string[];
    marks?: [string, 'PRESENT' | 'ABSENT' | 'CONFIRMED'][];
  },
) {
  const session = await db.transaction(async (tx) => {
    const row = first(
      await tx
        .insert(classSessions)
        .values({
          classGroupId: group.id,
          spaceId: group.spaceId,
          courtId: group.courtId,
          startsAt: input.startsAt,
          endsAt: addMinutes(input.startsAt, 60),
          capacity: group.capacity,
          status: input.status,
        })
        .returning(),
    );
    await tx.insert(classSessionTeachers).values(
      input.teacherMemberIds.map((teacherMemberId) => ({
        classSessionId: row.id,
        spaceId: group.spaceId,
        teacherMemberId,
      })),
    );
    return row;
  });
  for (const [userId, status] of input.marks ?? []) {
    await db.insert(attendances).values({ sessionId: session.id, userId, status });
  }
  if (input.status === 'DONE') {
    await db.insert(courtOccupations).values({
      courtId: group.courtId,
      period: { start: session.startsAt, end: session.endsAt },
      kind: 'CLASS',
      refId: session.id,
    });
  }
  return session;
}

/** Pagamento registrado no espaço (opcionalmente estornado). */
export async function insertPayment(
  db: Database,
  input: Omit<typeof paymentRecords.$inferInsert, 'channel'> & { reversed?: boolean },
) {
  const { reversed, ...values } = input;
  await db.insert(paymentRecords).values({
    ...values,
    channel: 'ON_SITE',
    ...(reversed
      ? { reversedAt: new Date(values.paidAt as Date), reversedBy: values.recordedBy }
      : {}),
  });
}

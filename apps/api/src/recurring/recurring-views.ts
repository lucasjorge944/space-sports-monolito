import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  type OccupationKind,
  type RecurringBooking,
  type RecurringBookingDetail,
  type RecurringConflict,
} from '@space-sports/shared';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import {
  cities,
  courts,
  recurringBookingConflicts,
  recurringBookings,
  spaces,
  sports,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';

const recurringColumns = {
  recurring: recurringBookings,
  spaceName: spaces.name,
  spaceSlug: spaces.slug,
  timeZone: cities.timezone,
  courtName: courts.name,
  sportName: sports.name,
  sportSlug: sports.slug,
  userName: users.name,
};

type RecurringRow = {
  recurring: typeof recurringBookings.$inferSelect;
  spaceName: string;
  spaceSlug: string;
  timeZone: string;
  courtName: string;
  sportName: string;
  sportSlug: string;
  userName: string | null;
};

export interface RecurringViewOptions {
  /** Gestão do espaço: vê o telefone do cliente cadastrado sem app. */
  staff: boolean;
}

/** Leitura dos mensalistas no formato da API (shared `RecurringBooking`). */
@Injectable()
export class RecurringViews {
  constructor(@Inject(DB) private readonly db: Database) {}

  query(db: DbOrTx = this.db) {
    return db
      .select(recurringColumns)
      .from(recurringBookings)
      .innerJoin(spaces, eq(spaces.id, recurringBookings.spaceId))
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .innerJoin(courts, eq(courts.id, recurringBookings.courtId))
      .innerJoin(sports, eq(sports.id, recurringBookings.sportId))
      .leftJoin(users, eq(users.id, recurringBookings.userId))
      .$dynamic();
  }

  async list(
    where: SQL | undefined,
    limit: number,
    options: RecurringViewOptions,
    db: DbOrTx = this.db,
  ): Promise<RecurringBooking[]> {
    // O id é UUID v7 (ordenado no tempo): mais recentes primeiro e cursor estável.
    const rows = await this.query(db).where(where).orderBy(desc(recurringBookings.id)).limit(limit);
    return rows.map((row) => toRecurringBooking(row, options));
  }

  async one(
    where: SQL,
    options: RecurringViewOptions,
    db: DbOrTx = this.db,
  ): Promise<RecurringBooking | null> {
    const [row] = await this.query(db).where(where);
    return row ? toRecurringBooking(row, options) : null;
  }

  /** Conflitos em aberto do mensalista. */
  async detail(
    recurring: RecurringBooking,
    options: RecurringViewOptions,
    db: DbOrTx = this.db,
  ): Promise<RecurringBookingDetail> {
    const conflicts = await this.conflicts(
      eq(recurringBookingConflicts.recurringBookingId, recurring.id),
      options,
      db,
    );
    return { ...recurring, conflicts };
  }

  /** Ocorrências que não couberam na agenda e seguem em aberto, da mais próxima para a mais distante. */
  async conflicts(
    where: SQL | undefined,
    options: RecurringViewOptions,
    db: DbOrTx = this.db,
  ): Promise<RecurringConflict[]> {
    const rows = await db
      .select({
        conflict: recurringBookingConflicts,
        recurring: recurringBookings,
        courtName: courts.name,
        userName: users.name,
      })
      .from(recurringBookingConflicts)
      .innerJoin(
        recurringBookings,
        eq(recurringBookings.id, recurringBookingConflicts.recurringBookingId),
      )
      .innerJoin(courts, eq(courts.id, recurringBookings.courtId))
      .leftJoin(users, eq(users.id, recurringBookings.userId))
      .where(and(isNull(recurringBookingConflicts.resolvedAt), where))
      .orderBy(asc(recurringBookingConflicts.startsAt), asc(recurringBookingConflicts.id))
      .limit(200);
    return rows.map(({ conflict: c, recurring: r, courtName, userName }) => ({
      id: c.id,
      recurringBookingId: r.id,
      court: { id: r.courtId, name: courtName },
      customer: {
        userId: r.userId,
        name: r.guestName ?? userName ?? '',
        phone: options.staff ? r.guestPhone : null,
      },
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      conflictsWith: c.conflictsWith as OccupationKind,
      createdAt: c.createdAt.toISOString(),
    }));
  }
}

function toRecurringBooking(row: RecurringRow, { staff }: RecurringViewOptions): RecurringBooking {
  const r = row.recurring;
  return {
    id: r.id,
    space: {
      id: r.spaceId,
      name: row.spaceName,
      slug: row.spaceSlug,
      timeZone: row.timeZone || DEFAULT_TIME_ZONE,
    },
    court: { id: r.courtId, name: row.courtName },
    sport: { id: r.sportId, name: row.sportName, slug: row.sportSlug },
    customer: {
      userId: r.userId,
      name: r.guestName ?? row.userName ?? '',
      phone: staff ? r.guestPhone : null,
    },
    weekday: r.weekday,
    // time do Postgres vem como HH:MM:SS.
    startTime: r.startTime.slice(0, 5),
    durationMin: r.durationMin,
    peopleCount: r.peopleCount,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    status: r.status,
    statusReason: r.statusReason,
    createdAt: r.createdAt.toISOString(),
  };
}

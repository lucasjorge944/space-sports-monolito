import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  type StaffSpace,
  type StaffSpacesResponse,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, gt, lt, ne, or, type SQL } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { staffTodayClassSessions } from '../classes/staff-class-sessions.js';
import type { Database } from '../db/client.js';
import { bookings, cities, courts, spaces, sports, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';

/**
 * Visão de equipe do app (RN-AUTH-04): os espaços onde o usuário tem vínculo ativo, com os papéis
 * e a agenda de hoje (reservas e aulas com as listas; o Professor só vê as aulas dele). Só leitura e sem valores; qualquer papel vê a agenda (matriz: "Ver agenda
 * e reservas"), então não há checagem por papel além do vínculo.
 */
@Injectable()
export class StaffSpacesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  async list(userId: string, now = new Date()): Promise<StaffSpacesResponse> {
    const memberships = await this.auth.memberships(userId);
    if (!memberships.length) return { items: [] };

    const zones = await this.db
      .select({ id: spaces.id, timeZone: cities.timezone })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(or(...memberships.map((m) => eq(spaces.id, m.space.id))));
    const zoneOf = new Map(zones.map((z) => [z.id, z.timeZone || DEFAULT_TIME_ZONE]));

    // Um dia local por espaço: [00:00 de hoje, 00:00 de amanhã) no fuso dele, em UTC.
    const days = new Map(
      memberships.map(({ space }) => {
        const timeZone = zoneOf.get(space.id) ?? DEFAULT_TIME_ZONE;
        const date = utcToZoned(now, timeZone).date;
        return [
          space.id,
          {
            timeZone,
            date,
            from: zonedToUtc(date, 0, timeZone),
            to: zonedToUtc(addDays(date, 1), 0, timeZone),
          },
        ] as const;
      }),
    );

    const rows = await this.db
      .select({
        id: bookings.id,
        spaceId: bookings.spaceId,
        courtId: bookings.courtId,
        courtName: courts.name,
        sportName: sports.name,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        source: bookings.source,
        peopleCount: bookings.peopleCount,
        organizerName: users.name,
        guestName: bookings.guestName,
      })
      .from(bookings)
      .innerJoin(courts, eq(courts.id, bookings.courtId))
      .innerJoin(sports, eq(sports.id, bookings.sportId))
      .leftJoin(users, eq(users.id, bookings.organizerUserId))
      .where(
        and(
          ne(bookings.status, 'CANCELLED'),
          or(
            ...[...days].map(([spaceId, day]) =>
              and(
                eq(bookings.spaceId, spaceId),
                gt(bookings.endsAt, day.from),
                lt(bookings.startsAt, day.to),
              ),
            ),
          ) as SQL,
        ),
      )
      .orderBy(asc(bookings.startsAt), asc(courts.name), asc(bookings.id));

    const classSessions = await staffTodayClassSessions(
      this.db,
      userId,
      memberships.flatMap(({ space, roles }) => {
        const day = days.get(space.id);
        return day ? [{ spaceId: space.id, roles, from: day.from, to: day.to }] : [];
      }),
    );

    return {
      items: memberships.map(({ space, roles }): StaffSpace => {
        const day = days.get(space.id);
        return {
          space: { ...space, timeZone: day?.timeZone ?? DEFAULT_TIME_ZONE },
          roles,
          today: {
            date: day?.date ?? utcToZoned(now, DEFAULT_TIME_ZONE).date,
            bookings: rows
              .filter((row) => row.spaceId === space.id)
              .map((row) => ({
                id: row.id,
                court: { id: row.courtId, name: row.courtName },
                sportName: row.sportName,
                startsAt: row.startsAt.toISOString(),
                endsAt: row.endsAt.toISOString(),
                status: row.status,
                source: row.source,
                peopleCount: row.peopleCount,
                customerName: row.organizerName ?? row.guestName,
              })),
            classSessions: classSessions.get(space.id) ?? [],
          },
        };
      }),
    };
  }
}

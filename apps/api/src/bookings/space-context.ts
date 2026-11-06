import { Inject, Injectable } from '@nestjs/common';
import {
  type BookingRules,
  DEFAULT_BOOKING_RULES,
  DEFAULT_TIME_ZONE,
  type OpeningHour,
} from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  cities,
  courtSports,
  courts,
  spaceOpeningHours,
  spaceSettings,
  spaces,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import {
  courtNotFound,
  courtUnavailable,
  peopleExceedCapacity,
  spaceNotBookable,
  spaceNotFound,
  sportNotOffered,
} from './bookings.errors.js';
import type { DbOrTx } from './db-utils.js';

/** O que as regras de reserva precisam saber do espaço. */
export interface SpaceContext {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  timeZone: string;
  /** Nulo enquanto o espaço não definiu o preço/hora (sem aluguel). */
  pricePerHourCents: number | null;
  rules: BookingRules;
  openingHours: OpeningHour[];
}

/** Espaço pronto para receber reservas: ativo e com preço definido (RN-SPACE-01). */
export type BookableSpace = SpaceContext & { pricePerHourCents: number };

@Injectable()
export class SpaceContextService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async load(spaceId: string, db: DbOrTx = this.db): Promise<SpaceContext> {
    const [row] = await db
      .select({
        id: spaces.id,
        name: spaces.name,
        slug: spaces.slug,
        status: spaces.status,
        timeZone: cities.timezone,
        settings: spaceSettings,
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .leftJoin(spaceSettings, eq(spaceSettings.spaceId, spaces.id))
      .where(eq(spaces.id, spaceId));
    if (!row) throw spaceNotFound();

    const hours = await db
      .select({
        weekday: spaceOpeningHours.weekday,
        opensAt: spaceOpeningHours.opensAt,
        closesAt: spaceOpeningHours.closesAt,
      })
      .from(spaceOpeningHours)
      .where(eq(spaceOpeningHours.spaceId, spaceId));

    const s = row.settings;
    const d = DEFAULT_BOOKING_RULES;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      timeZone: row.timeZone || DEFAULT_TIME_ZONE,
      pricePerHourCents: s?.pricePerHourCents ?? null,
      // Configuração nula = padrão da seção 2.1 de docs/02.
      rules: {
        minDurationMin: s?.bookingMinDurationMin ?? d.minDurationMin,
        maxDurationMin: s?.bookingMaxDurationMin ?? d.maxDurationMin,
        minAdvanceMin: s?.bookingMinAdvanceMin ?? d.minAdvanceMin,
        windowDays: s?.bookingWindowDays ?? d.windowDays,
        cancellationDeadlineMin: s?.cancellationDeadlineMin ?? d.cancellationDeadlineMin,
      },
      openingHours: hours,
    };
  }

  async loadBookable(spaceId: string, db: DbOrTx = this.db): Promise<BookableSpace> {
    const space = await this.load(spaceId, db);
    if (space.status !== 'ACTIVE' || space.pricePerHourCents === null) throw spaceNotBookable();
    return space as BookableSpace;
  }

  /** Quadra ativa do espaço que oferece o esporte, com a capacidade (RN-BOOK-04). */
  async court(
    spaceId: string,
    courtId: string,
    sportId: string,
    peopleCount: number,
    db: DbOrTx = this.db,
  ): Promise<{ id: string; maxPlayers: number }> {
    const [court] = await db
      .select({ id: courts.id, status: courts.status })
      .from(courts)
      .where(and(eq(courts.id, courtId), eq(courts.spaceId, spaceId)));
    if (!court) throw courtNotFound();
    if (court.status !== 'ACTIVE') throw courtUnavailable();
    const [sport] = await db
      .select({ maxPlayers: courtSports.maxPlayers })
      .from(courtSports)
      .where(and(eq(courtSports.courtId, courtId), eq(courtSports.sportId, sportId)));
    if (!sport) throw sportNotOffered();
    if (peopleCount > sport.maxPlayers) throw peopleExceedCapacity(sport.maxPlayers);
    return { id: court.id, maxPlayers: sport.maxPlayers };
  }
}

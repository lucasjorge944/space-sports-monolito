import { Inject, Injectable } from '@nestjs/common';
import {
  type AvailabilityQuery,
  type AvailabilityResponse,
  addDays,
  buildAvailability,
  calculateBookingPriceCents,
  zonedToUtc,
} from '@space-sports/shared';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { bookings, courtOccupations, courtSports, courts } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { OnlineChargesService } from '../payments/online-charges.service.js';
import { bookingNotFound, bookingTimeInvalid } from './bookings.errors.js';
import { SpaceContextService } from './space-context.js';

/**
 * RF-BOOK-01/RF-BOOK-02: grade de horários de 30 em 30 min por quadra para a data local, a
 * duração e o esporte pedidos, respeitando funcionamento, duração mín./máx., antecedência e
 * janela (RN-BOOK-02, RN-BOOK-06). A grade é informativa: quem garante o horário na criação é a
 * constraint de exclusão. Com `excludeBookingId` (RN-BOOK-12), o organizador vê a grade da edição:
 * a própria reserva conta como livre e o preço vem do valor/hora guardado nela.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
    private readonly online: OnlineChargesService,
  ) {}

  async forDate(
    spaceId: string,
    query: AvailabilityQuery,
    userId?: string,
  ): Promise<AvailabilityResponse> {
    const space = await this.spaces.loadBookable(spaceId);
    // RN-ONPAY-02: o prazo do pagamento também vence na leitura, e o horário volta para a grade.
    await this.online.expireHolds(new Date(), { spaceId: space.id });
    const editing = query.excludeBookingId
      ? await this.ownBooking(space.id, query.excludeBookingId, userId)
      : null;
    const pricePerHourCents = editing?.pricePerHourCents ?? space.pricePerHourCents;
    const { minDurationMin, maxDurationMin } = space.rules;
    if (query.durationMin < minDurationMin || query.durationMin > maxDurationMin) {
      throw bookingTimeInvalid('DURATION_OUT_OF_RANGE', { minDurationMin, maxDurationMin });
    }

    const courtRows = await this.db
      .select({
        id: courts.id,
        name: courts.name,
        covered: courts.covered,
        maxPlayers: courtSports.maxPlayers,
      })
      .from(courts)
      .innerJoin(courtSports, eq(courtSports.courtId, courts.id))
      .where(
        and(
          eq(courts.spaceId, space.id),
          eq(courts.status, 'ACTIVE'),
          eq(courtSports.sportId, query.sportId),
          query.courtId ? eq(courts.id, query.courtId) : undefined,
        ),
      )
      .orderBy(asc(courts.name), asc(courts.id));

    // Ocupações que podem tocar algum slot da data (inclui a madrugada do dia seguinte).
    const from = zonedToUtc(query.date, 0, space.timeZone);
    const to = zonedToUtc(addDays(query.date, 2), 0, space.timeZone);
    const occupations = courtRows.length
      ? await this.db
          .select({ courtId: courtOccupations.courtId, period: courtOccupations.period })
          .from(courtOccupations)
          .where(
            and(
              inArray(
                courtOccupations.courtId,
                courtRows.map((c) => c.id),
              ),
              eq(courtOccupations.active, true),
              editing ? ne(courtOccupations.refId, editing.id) : undefined,
              sql`${courtOccupations.period} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`,
            ),
          )
      : [];

    const grid = buildAvailability({
      date: query.date,
      durationMin: query.durationMin,
      openingHours: space.openingHours,
      timeZone: space.timeZone,
      rules: space.rules,
      now: new Date(),
      courts: courtRows.map((court) => ({
        courtId: court.id,
        occupied: occupations.filter((o) => o.courtId === court.id).map((o) => o.period),
      })),
    });

    return {
      date: query.date,
      timeZone: space.timeZone,
      durationMin: query.durationMin,
      pricePerHourCents,
      priceCents: calculateBookingPriceCents(pricePerHourCents, query.durationMin),
      courts: courtRows.map((court, i) => ({
        id: court.id,
        name: court.name,
        covered: court.covered,
        maxPlayers: court.maxPlayers,
        slots: (grid[i]?.slots ?? []).map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          available: slot.available,
        })),
      })),
    };
  }

  /** A reserva a ignorar precisa ser do espaço e do próprio organizador. */
  private async ownBooking(spaceId: string, bookingId: string, userId: string | undefined) {
    const [booking] = userId
      ? await this.db
          .select({ id: bookings.id, pricePerHourCents: bookings.pricePerHourCents })
          .from(bookings)
          .where(
            and(
              eq(bookings.id, bookingId),
              eq(bookings.spaceId, spaceId),
              eq(bookings.organizerUserId, userId),
            ),
          )
      : [];
    if (!booking) throw bookingNotFound();
    return booking;
  }
}

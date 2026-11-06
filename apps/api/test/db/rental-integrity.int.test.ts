import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bookings,
  cities,
  courts,
  recurringBookings,
  spaces,
  sports,
} from '../../src/db/schema/index.js';
import { createTestDatabase, expectPgError, first, type TestDatabase } from './helpers.js';

const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

describe('integridade de bookings e recurring_bookings', () => {
  let t: TestDatabase;
  let spaceA: string;
  let spaceB: string;
  let courtOfA: string;
  let courtOfB: string;
  let sportId: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    const city = first(
      await t.db
        .insert(cities)
        .values({ name: 'Cidade', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
    [spaceA, spaceB] = (
      await t.db
        .insert(spaces)
        .values([
          { name: 'Espaço A', slug: 'espaco-a', cityId: city.id },
          { name: 'Espaço B', slug: 'espaco-b', cityId: city.id },
        ])
        .returning()
    ).map((space) => space.id) as [string, string];
    [courtOfA, courtOfB] = (
      await t.db
        .insert(courts)
        .values([
          { spaceId: spaceA, name: 'Quadra 1' },
          { spaceId: spaceB, name: 'Quadra 1' },
        ])
        .returning()
    ).map((court) => court.id) as [string, string];
    sportId = first(
      await t.db.insert(sports).values({ slug: 'futevolei', name: 'Futevôlei' }).returning(),
    ).id;
  });
  afterAll(() => t.drop());

  const booking = (overrides: Partial<typeof bookings.$inferInsert> = {}) => ({
    spaceId: spaceA,
    courtId: courtOfA,
    guestName: 'Cliente do balcão',
    sportId,
    startsAt: new Date('2026-11-02T10:00:00Z'),
    endsAt: new Date('2026-11-02T11:30:00Z'),
    durationMin: 90,
    peopleCount: 4,
    pricePerHourCents: 10_000,
    priceCents: 15_000,
    source: 'DESK' as const,
    ...overrides,
  });

  const recurring = (overrides: Partial<typeof recurringBookings.$inferInsert> = {}) => ({
    spaceId: spaceA,
    courtId: courtOfA,
    guestName: 'Mensalista',
    sportId,
    weekday: 1,
    startTime: '19:00',
    durationMin: 60,
    peopleCount: 4,
    startsOn: '2026-11-02',
    ...overrides,
  });

  it('aceita reserva e mensalista com a quadra do próprio espaço', async () => {
    await t.db.insert(bookings).values(booking());
    await t.db.insert(recurringBookings).values(recurring());
  });

  it('rejeita reserva com quadra de outro espaço', async () => {
    const err = await expectPgError(
      t.db.insert(bookings).values(booking({ spaceId: spaceA, courtId: courtOfB })),
    );
    expect(err).toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'bookings_court_space_fk',
    });
  });

  it('rejeita mensalista com quadra de outro espaço', async () => {
    const err = await expectPgError(
      t.db.insert(recurringBookings).values(recurring({ spaceId: spaceB, courtId: courtOfA })),
    );
    expect(err).toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'recurring_bookings_court_space_fk',
    });
  });

  it('rejeita reserva cuja duração não bate com o período', async () => {
    const err = await expectPgError(t.db.insert(bookings).values(booking({ durationMin: 60 })));
    expect(err).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'bookings_duration_matches_period',
    });
  });

  it('aceita duração que passa da meia-noite e de 24h', async () => {
    await t.db.insert(bookings).values(
      booking({
        startsAt: new Date('2026-11-02T23:00:00Z'),
        endsAt: new Date('2026-11-04T01:00:00Z'),
        durationMin: 26 * 60,
      }),
    );
  });
});

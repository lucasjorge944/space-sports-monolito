import { utcToZoned, zonedToUtc } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, vi } from 'vitest';
import type { Database } from '../../src/db/client.js';
import {
  cities,
  courtSports,
  courts,
  spaceMembers,
  spaceOpeningHours,
  spaceSettings,
  spaces,
  sports,
} from '../../src/db/schema/index.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { first } from '../db/helpers.js';

const HALF_HOUR_MS = 30 * 60_000;

/**
 * Congela o relógio (só `Date`) às 12:10 de hoje em America/Sao_Paulo, para os horários dos
 * testes não dependerem da hora real: a grade de disponibilidade é por data local, e um slot
 * perto da meia-noite local (ou o de 30 min antes dele) cairia em outro dia. 12:10 fica fora da
 * fronteira de slot, então `slotIn(0)` é futuro e `currentSlot()` já começou. Chamar no topo do
 * arquivo, antes do `describe`.
 */
export function useMiddayClock() {
  beforeAll(() => {
    const { date } = utcToZoned(new Date(), 'America/Sao_Paulo');
    vi.useFakeTimers({
      toFake: ['Date'],
      now: zonedToUtc(date, 12 * 60 + 10, 'America/Sao_Paulo'),
    });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

/** Início de slot (múltiplo de 30 min) pelo menos `minutes` à frente de agora. */
export const slotIn = (minutes: number) =>
  new Date(Math.ceil((Date.now() + minutes * 60_000) / HALF_HOUR_MS) * HALF_HOUR_MS);

/** Slot de 30 min em andamento agora (começou há menos de 30 min). */
export const currentSlot = () => new Date(Math.floor(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS);

export type Space = {
  id: string;
  courtA: string;
  courtB: string;
  sportId: string;
};

export const PRICE_PER_HOUR = 10_000;

/** Espaço ativo, R$ 100/h, aberto 24h todos os dias, duas quadras de futevôlei (máx. 4). */
export async function createSpace(db: Database, slug: string): Promise<Space> {
  const [existingCity] = await db.select().from(cities).where(eq(cities.name, 'Belo Horizonte'));
  const city =
    existingCity ??
    first(
      await db
        .insert(cities)
        .values({ name: 'Belo Horizonte', state: 'MG', timezone: 'America/Sao_Paulo' })
        .returning(),
    );
  const [existingSport] = await db.select().from(sports).where(eq(sports.slug, 'futevolei'));
  const sport =
    existingSport ??
    first(await db.insert(sports).values({ slug: 'futevolei', name: 'Futevôlei' }).returning());
  const space = first(
    await db
      .insert(spaces)
      .values({ name: `Espaço ${slug}`, slug, cityId: city.id })
      .returning(),
  );
  await db.insert(spaceSettings).values({
    spaceId: space.id,
    pricePerHourCents: PRICE_PER_HOUR,
    bookingMinDurationMin: 60,
    bookingMaxDurationMin: 180,
    bookingMinAdvanceMin: 60,
    bookingWindowDays: 30,
    cancellationDeadlineMin: 60,
    acceptedPaymentMethods: ['PIX', 'CASH'],
  });
  // 00:00 → 00:00 = 24h (passa da meia-noite).
  await db.insert(spaceOpeningHours).values(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      spaceId: space.id,
      weekday,
      opensAt: '00:00',
      closesAt: '00:00',
    })),
  );
  const [courtA, courtB] = await db
    .insert(courts)
    .values([
      { spaceId: space.id, name: 'Quadra A' },
      { spaceId: space.id, name: 'Quadra B' },
    ])
    .returning();
  if (!courtA || !courtB) throw new Error('Quadras não criadas.');
  await db.insert(courtSports).values([
    { courtId: courtA.id, sportId: sport.id, maxPlayers: 4 },
    { courtId: courtB.id, sportId: sport.id, maxPlayers: 4 },
  ]);
  return { id: space.id, courtA: courtA.id, courtB: courtB.id, sportId: sport.id };
}

export async function member(
  t: TestApp,
  email: string,
  spaceId: string,
  role: 'OWNER' | 'ADMIN' | 'TEACHER',
): Promise<SignedUp> {
  const user = await signUp(t, email);
  await t.db.insert(spaceMembers).values({ userId: user.id, spaceId, role, status: 'ACTIVE' });
  return user;
}

export const bearer = (user: SignedUp) => ['authorization', `Bearer ${user.token}`] as const;

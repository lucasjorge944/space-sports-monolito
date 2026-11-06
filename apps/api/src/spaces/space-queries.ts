import {
  type Amenity,
  type Court,
  type OpeningHour,
  type Photo,
  SPACE_SETTINGS_DEFAULTS,
  type SpaceSettings,
} from '@space-sports/shared';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  amenities,
  courtSports,
  courts,
  spaceAmenities,
  spaceOpeningHours,
  spacePhotos,
  spaceSettings,
  spaces,
  sports,
} from '../db/schema/index.js';

// Leituras compartilhadas pelo painel e pelas rotas públicas.

type Tx = Pick<Database, 'select' | 'selectDistinct' | 'selectDistinctOn'>;

/**
 * RN-SPACE-01: o espaço aparece na vitrine se está ACTIVE, tem preço/hora e ao menos uma quadra
 * ativa. Condição SQL sobre a tabela `spaces`.
 */
export const visibleInShowcase: SQL = sql`(
  ${spaces.status} = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM ${spaceSettings}
    WHERE ${spaceSettings.spaceId} = ${spaces.id} AND ${spaceSettings.pricePerHourCents} IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM ${courts} WHERE ${courts.spaceId} = ${spaces.id} AND ${courts.status} = 'ACTIVE'
  )
)`;

export async function loadPhotos(db: Tx, spaceId: string): Promise<Photo[]> {
  return db
    .select({
      id: spacePhotos.id,
      url: spacePhotos.url,
      blurhash: spacePhotos.blurhash,
      position: spacePhotos.position,
    })
    .from(spacePhotos)
    .where(eq(spacePhotos.spaceId, spaceId))
    .orderBy(asc(spacePhotos.position), asc(spacePhotos.id));
}

export async function loadAmenities(db: Tx, spaceId: string): Promise<Amenity[]> {
  return db
    .select({ id: amenities.id, slug: amenities.slug, name: amenities.name, icon: amenities.icon })
    .from(spaceAmenities)
    .innerJoin(amenities, eq(amenities.id, spaceAmenities.amenityId))
    .where(eq(spaceAmenities.spaceId, spaceId))
    .orderBy(asc(amenities.name));
}

export async function loadOpeningHours(db: Tx, spaceId: string): Promise<OpeningHour[]> {
  const rows = await db
    .select({
      weekday: spaceOpeningHours.weekday,
      opensAt: spaceOpeningHours.opensAt,
      closesAt: spaceOpeningHours.closesAt,
    })
    .from(spaceOpeningHours)
    .where(eq(spaceOpeningHours.spaceId, spaceId))
    .orderBy(asc(spaceOpeningHours.weekday), asc(spaceOpeningHours.opensAt));
  // O Postgres devolve `time` como HH:MM:SS.
  return rows.map((row) => ({
    weekday: row.weekday,
    opensAt: row.opensAt.slice(0, 5),
    closesAt: row.closesAt.slice(0, 5),
  }));
}

/** Quadras do espaço com os esportes; `onlyActive` para a página pública. */
export async function loadCourts(
  db: Tx,
  spaceId: string,
  { onlyActive = false, courtId }: { onlyActive?: boolean; courtId?: string } = {},
): Promise<Court[]> {
  const conditions = [eq(courts.spaceId, spaceId)];
  if (onlyActive) conditions.push(eq(courts.status, 'ACTIVE'));
  if (courtId) conditions.push(eq(courts.id, courtId));
  const rows = await db
    .select({
      id: courts.id,
      name: courts.name,
      covered: courts.covered,
      status: courts.status,
      sportId: sports.id,
      sportSlug: sports.slug,
      sportName: sports.name,
      maxPlayers: courtSports.maxPlayers,
    })
    .from(courts)
    .leftJoin(courtSports, eq(courtSports.courtId, courts.id))
    .leftJoin(sports, eq(sports.id, courtSports.sportId))
    .where(and(...conditions))
    .orderBy(asc(courts.name), asc(courts.id), asc(sports.name));

  const byId = new Map<string, Court>();
  for (const row of rows) {
    const court = byId.get(row.id) ?? {
      id: row.id,
      name: row.name,
      covered: row.covered,
      status: row.status,
      sports: [],
    };
    if (row.sportId && row.sportSlug && row.sportName && row.maxPlayers !== null) {
      court.sports.push({
        sportId: row.sportId,
        slug: row.sportSlug,
        name: row.sportName,
        maxPlayers: row.maxPlayers,
      });
    }
    byId.set(row.id, court);
  }
  return [...byId.values()];
}

/** Esportes das quadras ativas de cada espaço (para os cards), em ordem de nome. */
export async function loadSportsBySpace(
  db: Tx,
  spaceIds: string[],
): Promise<Map<string, { slug: string; name: string }[]>> {
  const result = new Map<string, { slug: string; name: string }[]>();
  if (!spaceIds.length) return result;
  const rows = await db
    .selectDistinct({ spaceId: courts.spaceId, slug: sports.slug, name: sports.name })
    .from(courts)
    .innerJoin(courtSports, eq(courtSports.courtId, courts.id))
    .innerJoin(sports, eq(sports.id, courtSports.sportId))
    .where(and(inArray(courts.spaceId, spaceIds), eq(courts.status, 'ACTIVE')))
    .orderBy(asc(courts.spaceId), asc(sports.name));
  for (const row of rows) {
    const list = result.get(row.spaceId) ?? [];
    list.push({ slug: row.slug, name: row.name });
    result.set(row.spaceId, list);
  }
  return result;
}

/** Capa (foto na menor posição) de cada espaço. */
export async function loadCovers(
  db: Tx,
  spaceIds: string[],
): Promise<Map<string, { url: string; blurhash: string | null }>> {
  const result = new Map<string, { url: string; blurhash: string | null }>();
  if (!spaceIds.length) return result;
  const rows = await db
    .selectDistinctOn([spacePhotos.spaceId], {
      spaceId: spacePhotos.spaceId,
      url: spacePhotos.url,
      blurhash: spacePhotos.blurhash,
    })
    .from(spacePhotos)
    .where(inArray(spacePhotos.spaceId, spaceIds))
    .orderBy(asc(spacePhotos.spaceId), asc(spacePhotos.position), asc(spacePhotos.id));
  for (const row of rows) result.set(row.spaceId, { url: row.url, blurhash: row.blurhash });
  return result;
}

type SettingsRow = typeof spaceSettings.$inferSelect;

/** Configurações efetivas: o valor salvo ou o padrão de docs/02 seção 2.1. */
export function effectiveSettings(row: SettingsRow | undefined): SpaceSettings {
  const d = SPACE_SETTINGS_DEFAULTS;
  return {
    pricePerHourCents: row?.pricePerHourCents ?? null,
    bookingMinDurationMin: row?.bookingMinDurationMin ?? d.bookingMinDurationMin,
    bookingMaxDurationMin: row?.bookingMaxDurationMin ?? d.bookingMaxDurationMin,
    bookingMinAdvanceMin: row?.bookingMinAdvanceMin ?? d.bookingMinAdvanceMin,
    bookingWindowDays: row?.bookingWindowDays ?? d.bookingWindowDays,
    cancellationDeadlineMin: row?.cancellationDeadlineMin ?? d.cancellationDeadlineMin,
    attendanceMode: row?.attendanceMode ?? d.attendanceMode,
    attendanceOpenBeforeMin: row?.attendanceOpenBeforeMin ?? d.attendanceOpenBeforeMin,
    attendanceCloseBeforeMin: row?.attendanceCloseBeforeMin ?? d.attendanceCloseBeforeMin,
    attendanceCancelDeadlineMin: row?.attendanceCancelDeadlineMin ?? d.attendanceCancelDeadlineMin,
    pastDueBlockEnabled: row?.pastDueBlockEnabled ?? d.pastDueBlockEnabled,
    pastDueBlockDays: row?.pastDueBlockDays ?? d.pastDueBlockDays,
    // Vazio = não configurado (o seed cria a linha com a lista vazia).
    acceptedPaymentMethods: row?.acceptedPaymentMethods.length
      ? row.acceptedPaymentMethods
      : [...d.acceptedPaymentMethods],
  };
}

export async function loadSettings(db: Tx, spaceId: string): Promise<SpaceSettings> {
  const [row] = await db.select().from(spaceSettings).where(eq(spaceSettings.spaceId, spaceId));
  return effectiveSettings(row);
}

/** Há ao menos uma quadra ativa? */
export async function hasActiveCourt(db: Tx, spaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: courts.id })
    .from(courts)
    .where(and(eq(courts.spaceId, spaceId), eq(courts.status, 'ACTIVE')))
    .limit(1);
  return Boolean(row);
}

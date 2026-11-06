import { ONBOARDING_ITEMS, type OnboardingChecklist } from '@space-sports/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  courtSports,
  courts,
  spaceMembers,
  spaceOpeningHours,
  spacePhotos,
  spaceSettings,
  spaces,
} from '../db/schema/index.js';

type Key = (typeof ONBOARDING_ITEMS)[number];

/**
 * Checklist de implantação (RF-SUPER-02), calculado a partir dos dados do espaço, para vários
 * espaços de uma vez. Turmas e planos entram com a Fase 2.
 */
export async function loadChecklists(
  db: Database,
  spaceIds: string[],
): Promise<Map<string, OnboardingChecklist>> {
  const result = new Map<string, OnboardingChecklist>();
  if (!spaceIds.length) return result;

  const [spaceRows, photoRows, hourRows, courtRows, priceRows, ownerRows] = await Promise.all([
    db.select().from(spaces).where(inArray(spaces.id, spaceIds)),
    db
      .select({ spaceId: spacePhotos.spaceId })
      .from(spacePhotos)
      .where(inArray(spacePhotos.spaceId, spaceIds))
      .groupBy(spacePhotos.spaceId),
    db
      .select({ spaceId: spaceOpeningHours.spaceId })
      .from(spaceOpeningHours)
      .where(inArray(spaceOpeningHours.spaceId, spaceIds))
      .groupBy(spaceOpeningHours.spaceId),
    db
      .select({ spaceId: courts.spaceId })
      .from(courts)
      .where(
        and(
          inArray(courts.spaceId, spaceIds),
          eq(courts.status, 'ACTIVE'),
          sql`EXISTS (SELECT 1 FROM ${courtSports} WHERE ${courtSports.courtId} = ${courts.id})`,
        ),
      )
      .groupBy(courts.spaceId),
    db
      .select({ spaceId: spaceSettings.spaceId, price: spaceSettings.pricePerHourCents })
      .from(spaceSettings)
      .where(inArray(spaceSettings.spaceId, spaceIds)),
    db
      .select({ spaceId: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(
        and(
          inArray(spaceMembers.spaceId, spaceIds),
          eq(spaceMembers.role, 'OWNER'),
          eq(spaceMembers.status, 'ACTIVE'),
        ),
      )
      .groupBy(spaceMembers.spaceId),
  ]);

  const has = (rows: { spaceId: string }[]) => new Set(rows.map((row) => row.spaceId));
  const withPhotos = has(photoRows);
  const withHours = has(hourRows);
  const withCourts = has(courtRows);
  const withOwner = has(ownerRows);
  const priced = new Set(priceRows.filter((row) => row.price !== null).map((row) => row.spaceId));

  for (const space of spaceRows) {
    const dataMissing: string[] = [];
    if (!space.description) dataMissing.push('description');
    if (
      !space.addressStreet ||
      !space.addressNumber ||
      !space.addressNeighborhood ||
      !space.addressPostalCode
    ) {
      dataMissing.push('address');
    }
    if (!space.location) dataMissing.push('location');
    if (!space.phone && !space.whatsapp) dataMissing.push('contact');
    if (!withHours.has(space.id)) dataMissing.push('openingHours');

    const missing: Record<Key, string[]> = {
      DATA: dataMissing,
      PHOTOS: withPhotos.has(space.id) ? [] : ['photos'],
      COURTS: withCourts.has(space.id) ? [] : ['activeCourtWithSport'],
      PRICE: priced.has(space.id) ? [] : ['pricePerHour'],
      TEAM: withOwner.has(space.id) ? [] : ['activeOwner'],
    };
    const items = ONBOARDING_ITEMS.map((key) => ({
      key,
      done: missing[key].length === 0,
      missing: missing[key],
    }));
    const doneCount = items.filter((item) => item.done).length;
    result.set(space.id, {
      items,
      doneCount,
      total: items.length,
      completed: doneCount === items.length,
    });
  }
  return result;
}

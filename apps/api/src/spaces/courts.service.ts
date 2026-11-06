import { Inject, Injectable } from '@nestjs/common';
import {
  type Court,
  type CreateCourt,
  courtCapacity,
  type UpdateCourt,
} from '@space-sports/shared';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { classGroups, classSessions, courtSports, courts, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { pgErrorOf } from './pg-error.js';
import { loadCourts } from './space-queries.js';
import {
  courtHasBookings,
  courtHasClassGroups,
  courtNameTaken,
  courtNotFound,
  unknownSport,
} from './spaces.errors.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Quadras do espaço (RF-SPACE-03): nome, esportes, coberta e status. */
@Injectable()
export class CourtsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(spaceId: string): Promise<Court[]> {
    return loadCourts(this.db, spaceId);
  }

  async get(spaceId: string, courtId: string): Promise<Court> {
    const [court] = await loadCourts(this.db, spaceId, { courtId });
    if (!court) throw courtNotFound();
    return court;
  }

  async create(spaceId: string, input: CreateCourt): Promise<Court> {
    const id = await this.db
      .transaction(async (tx) => {
        const [court] = await tx
          .insert(courts)
          .values({ spaceId, name: input.name, covered: input.covered, status: input.status })
          .returning({ id: courts.id });
        if (!court) throw new Error('Insert da quadra sem retorno.');
        await replaceSports(tx, court.id, input.sportIds);
        return court.id;
      })
      .catch(mapCourtErrors);
    return this.get(spaceId, id);
  }

  async update(spaceId: string, courtId: string, patch: UpdateCourt): Promise<Court> {
    await this.db
      .transaction(async (tx) => {
        const { sportIds, ...fields } = patch;
        const where = and(eq(courts.id, courtId), eq(courts.spaceId, spaceId));
        const [court] = Object.keys(fields).length
          ? await tx.update(courts).set(fields).where(where).returning({ id: courts.id })
          : await tx.select({ id: courts.id }).from(courts).where(where).for('update');
        if (!court) throw courtNotFound();
        // A linha da quadra já está travada: a criação/edição de turma (que trava a quadra) espera.
        if (fields.status === 'INACTIVE') {
          const active = await classGroupsOnCourt(tx, courtId, { activeOnly: true });
          if (active.length) throw courtHasClassGroups('inactivate', active);
        }
        if (sportIds) await replaceSports(tx, courtId, sportIds);
      })
      .catch(mapCourtErrors);
    return this.get(spaceId, courtId);
  }

  /**
   * Exclui a quadra; com turmas (409 COURT_HAS_CLASS_GROUPS, citando as turmas) ou com
   * reservas/mensalistas (409 COURT_HAS_BOOKINGS), use o status INACTIVE.
   */
  async delete(spaceId: string, courtId: string): Promise<void> {
    const deleted = await this.db
      .transaction(async (tx) => {
        const [court] = await tx
          .select({ id: courts.id })
          .from(courts)
          .where(and(eq(courts.id, courtId), eq(courts.spaceId, spaceId)))
          .for('update');
        if (!court) return [];
        const groups = await classGroupsOnCourt(tx, courtId, { activeOnly: false });
        if (groups.length) throw courtHasClassGroups('delete', groups);
        return tx.delete(courts).where(eq(courts.id, courtId)).returning({ id: courts.id });
      })
      .catch((err: unknown) => {
        // FK de bookings/recurring_bookings (as ocupações caem em cascata).
        if (pgErrorOf(err)?.code === '23503') throw courtHasBookings();
        throw err;
      });
    if (!deleted.length) throw courtNotFound();
  }
}

/**
 * Turmas da quadra: as que estão nela hoje e as que deixaram sessões nela (a sessão com
 * confirmação fica na quadra antiga quando a turma muda de quadra).
 */
async function classGroupsOnCourt(
  tx: Tx,
  courtId: string,
  { activeOnly }: { activeOnly: boolean },
): Promise<{ id: string; name: string }[]> {
  if (activeOnly) {
    return tx
      .select({ id: classGroups.id, name: classGroups.name })
      .from(classGroups)
      .where(and(eq(classGroups.courtId, courtId), eq(classGroups.active, true)))
      .orderBy(asc(classGroups.name), asc(classGroups.id));
  }
  return tx
    .selectDistinct({ id: classGroups.id, name: classGroups.name })
    .from(classGroups)
    .leftJoin(classSessions, eq(classSessions.classGroupId, classGroups.id))
    .where(or(eq(classGroups.courtId, courtId), eq(classSessions.courtId, courtId)))
    .orderBy(asc(classGroups.name), asc(classGroups.id));
}

/** Substitui os esportes da quadra; a capacidade é o padrão de cada esporte (decisão 51). */
async function replaceSports(tx: Tx, courtId: string, sportIds: string[]): Promise<void> {
  const found = await tx
    .select({ id: sports.id, defaultMaxPlayers: sports.defaultMaxPlayers })
    .from(sports)
    .where(inArray(sports.id, sportIds));
  if (found.length !== sportIds.length) throw unknownSport();

  await tx.delete(courtSports).where(eq(courtSports.courtId, courtId));
  await tx.insert(courtSports).values(
    found.map((sport) => ({
      courtId,
      sportId: sport.id,
      maxPlayers: courtCapacity(sport.defaultMaxPlayers),
    })),
  );
}

function mapCourtErrors(err: unknown): never {
  const pg = pgErrorOf(err);
  if (pg?.code === '23505' && pg.constraint === 'courts_space_name_unique') throw courtNameTaken();
  throw err;
}

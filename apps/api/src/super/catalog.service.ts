import { Inject, Injectable } from '@nestjs/common';
import {
  type Amenity,
  type CreateAmenity,
  type CreateCity,
  type CreateSport,
  courtCapacity,
  type Sport,
  type SuperCity,
  type UpdateAmenity,
  type UpdateCity,
  type UpdateSport,
} from '@space-sports/shared';
import { asc, eq } from 'drizzle-orm';
import { isUniqueViolation, pgError } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { amenities, cities, courtSports, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import {
  amenityNotFound,
  catalogInUse,
  catalogSlugTaken,
  cityAlreadyExists,
  cityIdNotFound,
  sportNotFound,
} from './super.errors.js';
import { superAudit } from './super-audit.js';

const FOREIGN_KEY_VIOLATION = '23503';

const sportColumns = {
  id: sports.id,
  slug: sports.slug,
  name: sports.name,
  icon: sports.icon,
  defaultMaxPlayers: sports.defaultMaxPlayers,
};
const amenityColumns = {
  id: amenities.id,
  slug: amenities.slug,
  name: amenities.name,
  icon: amenities.icon,
};
const cityColumns = {
  id: cities.id,
  name: cities.name,
  state: cities.state,
  timezone: cities.timezone,
  active: cities.active,
};

/** Catálogos geridos pelo Super: esportes, infraestrutura e cidades (RF-SUPER-06). */
@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Esportes ------------------------------------------------------------------------------------

  listSports(): Promise<Sport[]> {
    return this.db.select(sportColumns).from(sports).orderBy(asc(sports.name), asc(sports.id));
  }

  async createSport(actorId: string, input: CreateSport): Promise<Sport> {
    const [row] = await this.write(
      'sports_slug_unique',
      this.db
        .insert(sports)
        .values({
          slug: input.slug,
          name: input.name,
          icon: input.icon ?? null,
          defaultMaxPlayers: input.defaultMaxPlayers ?? null,
        })
        .returning(sportColumns),
    );
    if (!row) throw new Error('Insert do esporte sem retorno.');
    await this.audit(actorId, 'sport.create', row.id, { ...input });
    return row;
  }

  async updateSport(actorId: string, id: string, patch: UpdateSport): Promise<Sport> {
    const [row] = patchHasChanges(patch)
      ? await this.write(
          'sports_slug_unique',
          this.db.transaction(async (tx) => {
            const rows = await tx
              .update(sports)
              .set(patch)
              .where(eq(sports.id, id))
              .returning(sportColumns);
            // Decisão 51: a capacidade das quadras acompanha o padrão do esporte.
            if (rows[0] && patch.defaultMaxPlayers !== undefined) {
              await tx
                .update(courtSports)
                .set({ maxPlayers: courtCapacity(rows[0].defaultMaxPlayers) })
                .where(eq(courtSports.sportId, id));
            }
            return rows;
          }),
        )
      : await this.db.select(sportColumns).from(sports).where(eq(sports.id, id));
    if (!row) throw sportNotFound();
    await this.audit(actorId, 'sport.update', id, { ...patch });
    return row;
  }

  async deleteSport(actorId: string, id: string): Promise<void> {
    const [row] = await this.inUse(
      this.db.delete(sports).where(eq(sports.id, id)).returning({ slug: sports.slug }),
    );
    if (!row) throw sportNotFound();
    await this.audit(actorId, 'sport.delete', id, { slug: row.slug });
  }

  // Infraestrutura -------------------------------------------------------------------------------

  listAmenities(): Promise<Amenity[]> {
    return this.db
      .select(amenityColumns)
      .from(amenities)
      .orderBy(asc(amenities.name), asc(amenities.id));
  }

  async createAmenity(actorId: string, input: CreateAmenity): Promise<Amenity> {
    const [row] = await this.write(
      'amenities_slug_unique',
      this.db
        .insert(amenities)
        .values({ slug: input.slug, name: input.name, icon: input.icon ?? null })
        .returning(amenityColumns),
    );
    if (!row) throw new Error('Insert da infraestrutura sem retorno.');
    await this.audit(actorId, 'amenity.create', row.id, { ...input });
    return row;
  }

  async updateAmenity(actorId: string, id: string, patch: UpdateAmenity): Promise<Amenity> {
    const [row] = patchHasChanges(patch)
      ? await this.write(
          'amenities_slug_unique',
          this.db
            .update(amenities)
            .set(patch)
            .where(eq(amenities.id, id))
            .returning(amenityColumns),
        )
      : await this.db.select(amenityColumns).from(amenities).where(eq(amenities.id, id));
    if (!row) throw amenityNotFound();
    await this.audit(actorId, 'amenity.update', id, { ...patch });
    return row;
  }

  async deleteAmenity(actorId: string, id: string): Promise<void> {
    const [row] = await this.inUse(
      this.db.delete(amenities).where(eq(amenities.id, id)).returning({ slug: amenities.slug }),
    );
    if (!row) throw amenityNotFound();
    await this.audit(actorId, 'amenity.delete', id, { slug: row.slug });
  }

  // Cidades --------------------------------------------------------------------------------------

  listCities(): Promise<SuperCity[]> {
    return this.db
      .select(cityColumns)
      .from(cities)
      .orderBy(asc(cities.state), asc(cities.name), asc(cities.id));
  }

  async createCity(actorId: string, input: CreateCity): Promise<SuperCity> {
    const [row] = await this.write(
      'cities_name_state_unique',
      this.db.insert(cities).values(input).returning(cityColumns),
    );
    if (!row) throw new Error('Insert da cidade sem retorno.');
    await this.audit(actorId, 'city.create', row.id, { ...input });
    return row;
  }

  async updateCity(actorId: string, id: string, patch: UpdateCity): Promise<SuperCity> {
    const [row] = patchHasChanges(patch)
      ? await this.write(
          'cities_name_state_unique',
          this.db.update(cities).set(patch).where(eq(cities.id, id)).returning(cityColumns),
        )
      : await this.db.select(cityColumns).from(cities).where(eq(cities.id, id));
    if (!row) throw cityIdNotFound();
    await this.audit(actorId, 'city.update', id, { ...patch });
    return row;
  }

  async deleteCity(actorId: string, id: string): Promise<void> {
    const [row] = await this.inUse(
      this.db
        .delete(cities)
        .where(eq(cities.id, id))
        .returning({ name: cities.name, state: cities.state }),
    );
    if (!row) throw cityIdNotFound();
    await this.audit(actorId, 'city.delete', id, { name: row.name, state: row.state });
  }

  // ---------------------------------------------------------------------------------------------

  /** Executa a escrita traduzindo violação de unicidade/FK do catálogo em erro de domínio. */
  private async write<T>(uniqueConstraint: string, query: Promise<T>): Promise<T> {
    try {
      return await query;
    } catch (err) {
      if (isUniqueViolation(err, uniqueConstraint)) {
        throw uniqueConstraint === 'cities_name_state_unique'
          ? cityAlreadyExists()
          : catalogSlugTaken();
      }
      throw err;
    }
  }

  /** Exclusão: item em uso (FK de espaços, quadras, perfis…) vira `CATALOG_IN_USE`. */
  private async inUse<T>(query: Promise<T>): Promise<T> {
    try {
      return await query;
    } catch (err) {
      if (pgError(err).code === FOREIGN_KEY_VIOLATION) throw catalogInUse();
      throw err;
    }
  }

  private audit(actorId: string, action: string, entityId: string, diff: Record<string, unknown>) {
    return superAudit(this.db, actorId, {
      action: `super.catalog.${action}`,
      entity: action.split('.')[0] ?? 'catalog',
      entityId,
      diff,
    });
  }
}

const patchHasChanges = (patch: object) => Object.keys(patch).length > 0;

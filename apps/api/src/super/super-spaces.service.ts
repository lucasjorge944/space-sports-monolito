import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateSuperSpace,
  type ManagedSpace,
  type OwnerInviteResult,
  type ReplaceAmenities,
  type ReplaceOpeningHours,
  type SpaceSettings,
  type SuperSpace,
  type SuperSpaceListItem,
  type SuperSpacesQuery,
  spaceRating,
  type UpdateSpaceSettings,
  type UpdateSuperSpace,
} from '@space-sports/shared';
import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { type DbOrTx, isUniqueViolation } from '../bookings/db-utils.js';
import { maskEmail } from '../common/mask-email.js';
import type { Database } from '../db/client.js';
import {
  cities,
  courtSports,
  courts,
  spaceMembers,
  spaceSettings,
  spaces,
  sports,
  users,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { ManageSpacesService } from '../spaces/manage-spaces.service.js';
import { loadSportsBySpace, visibleInShowcase } from '../spaces/space-queries.js';
import { cityNotFound, spaceNotFound } from '../spaces/spaces.errors.js';
import { loadChecklists } from './onboarding.js';
import { OwnerInviter } from './owner-inviter.js';
import { invalidStatusTransition, slugTaken } from './super.errors.js';
import { likePattern, superAudit } from './super-audit.js';

export type StatusAction = 'suspend' | 'reactivate' | 'close';
type SpaceStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/** Status de origem permitidos e o destino de cada ação (RF-SUPER-03). */
const TRANSITIONS: Record<StatusAction, { from: SpaceStatus[]; to: SpaceStatus }> = {
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  reactivate: { from: ['SUSPENDED', 'CLOSED'], to: 'ACTIVE' },
  close: { from: ['ACTIVE', 'SUSPENDED'], to: 'CLOSED' },
};

type Owner = { id: string; name: string; email: string | null };

/** `Arena Sol & Mar` → `arena-sol-mar`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : 'espaco';
}

// `${spaces}.id` (tabela qualificada): numa consulta sem JOIN o Drizzle omite o prefixo de
// `${spaces.id}` e a coluna resolveria para a tabela da subconsulta.
const courtsCountSql = sql<number>`(SELECT count(*)::int FROM ${courts} WHERE ${courts.spaceId} = ${spaces}.id)`;

/** Gestão de espaços pelo Super (RF-SUPER-01..04). */
@Injectable()
export class SuperSpacesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly manage: ManageSpacesService,
    private readonly ownerInviter: OwnerInviter,
    private readonly events: DomainEvents,
  ) {}

  async list(query: SuperSpacesQuery) {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(or(ilike(spaces.name, pattern), ilike(spaces.slug, pattern)) as SQL);
    }
    if (query.status) conditions.push(eq(spaces.status, query.status));
    if (query.cityId) conditions.push(eq(spaces.cityId, query.cityId));
    if (query.sports?.length) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${courts}
        JOIN ${courtSports} ON ${courtSports.courtId} = ${courts.id}
        JOIN ${sports} ON ${sports.id} = ${courtSports.sportId}
        WHERE ${courts.spaceId} = ${spaces.id} AND ${inArray(sports.slug, query.sports)}
      )`);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ total: count() }).from(spaces).where(where);
    const rows = await this.db
      .select({
        id: spaces.id,
        name: spaces.name,
        slug: spaces.slug,
        status: spaces.status,
        logoUrl: spaces.logoUrl,
        neighborhood: spaces.addressNeighborhood,
        createdAt: spaces.createdAt,
        city: { id: cities.id, name: cities.name, state: cities.state },
        visible: sql<boolean>`${visibleInShowcase}`,
        courtsCount: courtsCountSql,
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(where)
      .orderBy(asc(spaces.name), asc(spaces.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const ids = rows.map((row) => row.id);
    const [sportsBySpace, owners, checklists] = await Promise.all([
      loadSportsBySpace(this.db, ids),
      this.loadOwners(ids),
      loadChecklists(this.db, ids),
    ]);
    const items: SuperSpaceListItem[] = rows.map((row) => {
      const checklist = checklists.get(row.id);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        logoUrl: row.logoUrl,
        city: row.city,
        neighborhood: row.neighborhood,
        sports: sportsBySpace.get(row.id) ?? [],
        courtsCount: row.courtsCount,
        owners: owners.get(row.id) ?? [],
        showcaseVisible: row.visible,
        onboarding: { doneCount: checklist?.doneCount ?? 0, total: checklist?.total ?? 0 },
        createdAt: row.createdAt.toISOString(),
      };
    });
    return { items, page: query.page, pageSize: query.pageSize, total: totalRow?.total ?? 0 };
  }

  async get(spaceId: string): Promise<SuperSpace> {
    const managed = await this.manage.get(spaceId);
    const [row] = await this.db
      .select({
        createdAt: spaces.createdAt,
        courtsCount: courtsCountSql,
        ratingCount: spaces.ratingCount,
        ratingSum: spaces.ratingSum,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    if (!row) throw spaceNotFound();
    const [owners, checklists] = await Promise.all([
      this.loadOwners([spaceId]),
      loadChecklists(this.db, [spaceId]),
    ]);
    const checklist = checklists.get(spaceId);
    if (!checklist) throw spaceNotFound();
    return {
      ...managed,
      createdAt: row.createdAt.toISOString(),
      courtsCount: row.courtsCount,
      owners: owners.get(spaceId) ?? [],
      checklist,
      // Avaliações que contam (RN-REVIEW-03), como no card da vitrine.
      rating: spaceRating(row.ratingCount, row.ratingSum),
    };
  }

  /** Cria o espaço já ACTIVE (RN-SPACE-01) e, se pedido, convida o Dono (RF-SUPER-02). */
  async create(
    actorId: string,
    input: CreateSuperSpace,
  ): Promise<{ space: SuperSpace; ownerInvite: OwnerInviteResult | null }> {
    const [city] = await this.db
      .select({ name: cities.name, state: cities.state, active: cities.active })
      .from(cities)
      .where(eq(cities.id, input.cityId));
    if (!city?.active) throw cityNotFound();

    let location = input.location ?? null;
    if (!location && input.address) {
      location = await this.manage.geocode({
        ...input.address,
        city: city.name,
        state: city.state,
      });
    }
    const spaceId = await this.insertSpace(actorId, input, location);

    let ownerInvite: OwnerInviteResult | null = null;
    if (input.ownerEmail) ownerInvite = await this.inviteOwner(actorId, spaceId, input.ownerEmail);
    return { space: await this.get(spaceId), ownerInvite };
  }

  private async insertSpace(
    actorId: string,
    input: CreateSuperSpace,
    location: { lat: number; lng: number } | null,
  ): Promise<string> {
    const base = input.slug ?? slugify(input.name);
    // Slug gerado: tenta `base`, `base-2`, `base-3`…; slug pedido: conflito é erro.
    for (let attempt = 1; attempt <= 20; attempt++) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`.slice(0, 80);
      try {
        return await this.db.transaction(async (tx) => {
          const [space] = await tx
            .insert(spaces)
            .values({
              name: input.name,
              slug,
              description: input.description || null,
              cityId: input.cityId,
              addressStreet: input.address?.street ?? null,
              addressNumber: input.address?.number ?? null,
              addressNeighborhood: input.address?.neighborhood ?? null,
              addressPostalCode: input.address?.postalCode ?? null,
              location,
              phone: input.phone ?? null,
              whatsapp: input.whatsapp ?? null,
              instagram: input.instagram ?? null,
              status: 'ACTIVE',
            })
            .returning({ id: spaces.id });
          if (!space) throw new Error('Insert do espaço sem retorno.');
          await tx.insert(spaceSettings).values({ spaceId: space.id });
          await superAudit(tx, actorId, {
            action: 'super.space.create',
            entity: 'space',
            entityId: space.id,
            spaceId: space.id,
            diff: { name: input.name, slug, cityId: input.cityId },
          });
          return space.id;
        });
      } catch (err) {
        if (!isUniqueViolation(err, 'spaces_slug_unique')) throw err;
        if (input.slug) throw slugTaken();
      }
    }
    throw slugTaken();
  }

  /**
   * Edita nome, slug e os demais dados do espaço (RF-SUPER-04). Validação e geocodificação vêm
   * antes; a gravação e a auditoria acontecem numa transação só (sem meia edição nem edição sem
   * registro).
   */
  async update(actorId: string, spaceId: string, patch: UpdateSuperSpace): Promise<SuperSpace> {
    const { name, slug, ...rest } = patch;
    try {
      await this.manage.update(spaceId, rest, {
        extra: {
          ...(name !== undefined ? { name } : {}),
          ...(slug !== undefined ? { slug } : {}),
        },
        inTx: (tx) => this.auditSpace(actorId, spaceId, 'update', { ...patch }, tx),
      });
    } catch (err) {
      if (isUniqueViolation(err, 'spaces_slug_unique')) throw slugTaken();
      throw err;
    }
    return this.get(spaceId);
  }

  /** Suspender, reativar ou encerrar (RF-SUPER-03). A troca é atômica e valida a origem. */
  async changeStatus(
    actorId: string,
    spaceId: string,
    action: StatusAction,
    reason?: string,
  ): Promise<SuperSpace> {
    const { from, to } = TRANSITIONS[action];
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ status: spaces.status })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .for('update');
      if (!before) throw spaceNotFound();
      if (!from.includes(before.status)) throw invalidStatusTransition();
      await tx.update(spaces).set({ status: to }).where(eq(spaces.id, spaceId));
      await superAudit(tx, actorId, {
        action: `super.space.${action}`,
        entity: 'space',
        entityId: spaceId,
        spaceId,
        diff: { from: before.status, to, ...(reason ? { reason } : {}) },
      });
    });
    // RN-ONPAY-09: espaço fora de ACTIVE não recebe cobrança nova e as abertas são canceladas.
    if (to !== 'ACTIVE') await this.events.publish({ type: 'space.deactivated', spaceId });
    return this.get(spaceId);
  }

  async inviteOwner(actorId: string, spaceId: string, email: string): Promise<OwnerInviteResult> {
    await this.assertExists(spaceId);
    const result = await this.ownerInviter.inviteOwner({ spaceId, email, invitedBy: actorId });
    await this.auditSpace(actorId, spaceId, 'invite_owner', {
      ...result,
      email: maskEmail(result.email),
    });
    return result;
  }

  // Infraestrutura, horário e configurações: a mesma regra do painel, sem a matriz de papéis e
  // com auditoria do Super.

  async replaceAmenities(
    actorId: string,
    spaceId: string,
    body: ReplaceAmenities,
  ): Promise<ManagedSpace> {
    return this.manage.replaceAmenities(spaceId, body, (tx) =>
      this.auditSpace(actorId, spaceId, 'amenities', { amenityIds: body.amenityIds }, tx),
    );
  }

  async replaceOpeningHours(
    actorId: string,
    spaceId: string,
    body: ReplaceOpeningHours,
  ): Promise<ManagedSpace> {
    return this.manage.replaceOpeningHours(spaceId, body, (tx) =>
      this.auditSpace(actorId, spaceId, 'opening_hours', { openingHours: body.openingHours }, tx),
    );
  }

  async getSettings(spaceId: string): Promise<SpaceSettings> {
    await this.assertExists(spaceId);
    return this.manage.getSettings(spaceId);
  }

  async updateSettings(
    actorId: string,
    spaceId: string,
    patch: UpdateSpaceSettings,
  ): Promise<SpaceSettings> {
    return this.manage.updateSettings(spaceId, patch, (tx) =>
      this.auditSpace(actorId, spaceId, 'settings', { ...patch }, tx),
    );
  }

  async assertExists(spaceId: string): Promise<void> {
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    if (!space) throw spaceNotFound();
  }

  private auditSpace(
    actorId: string,
    spaceId: string,
    action: string,
    diff: Record<string, unknown>,
    db: DbOrTx = this.db,
  ): Promise<void> {
    return superAudit(db, actorId, {
      action: `super.space.${action}`,
      entity: 'space',
      entityId: spaceId,
      spaceId,
      diff,
    });
  }

  private async loadOwners(spaceIds: string[]): Promise<Map<string, Owner[]>> {
    const result = new Map<string, Owner[]>();
    if (!spaceIds.length) return result;
    const rows = await this.db
      .select({
        spaceId: spaceMembers.spaceId,
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(
        and(
          inArray(spaceMembers.spaceId, spaceIds),
          eq(spaceMembers.role, 'OWNER'),
          eq(spaceMembers.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(users.name), asc(users.id));
    for (const { spaceId, ...owner } of rows) {
      const list = result.get(spaceId) ?? [];
      list.push(owner);
      result.set(spaceId, list);
    }
    return result;
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  Advertiser,
  AdvertiserList,
  AdvertisersQuery,
  CreateAdvertiser,
  UpdateAdvertiser,
} from '@space-sports/shared';
import { and, asc, count, eq, ilike, type SQL, sql } from 'drizzle-orm';
import { isUniqueViolation, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { adCampaigns, advertisers, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { likePattern } from '../super/super-audit.js';
import { AdCandidatesCache } from './ad-candidates.cache.js';
import { advertiserNotFound, advertiserSpaceNotFound, advertiserSpaceTaken } from './ads.errors.js';
import { adsAudit, changes, lockAdvertiser } from './ads-common.js';

const SPACE_TAKEN = 'advertisers_space_id_active_unique';

const columns = {
  id: advertisers.id,
  name: advertisers.name,
  kind: advertisers.kind,
  category: advertisers.category,
  spaceId: advertisers.spaceId,
  spaceName: spaces.name,
  spaceSlug: spaces.slug,
  contactName: advertisers.contactName,
  contactEmail: advertisers.contactEmail,
  contactPhone: advertisers.contactPhone,
  notes: advertisers.notes,
  active: advertisers.active,
  campaignsCount: sql<number>`(
    SELECT count(*)::int FROM ${adCampaigns} WHERE ${adCampaigns.advertiserId} = ${advertisers.id}
  )`,
  createdAt: advertisers.createdAt,
  updatedAt: advertisers.updatedAt,
};

type Row = {
  id: string;
  name: string;
  kind: Advertiser['kind'];
  category: Advertiser['category'];
  spaceId: string | null;
  spaceName: string | null;
  spaceSlug: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  active: boolean;
  campaignsCount: number;
  createdAt: Date;
  updatedAt: Date;
};

const toAdvertiser = ({ spaceId, spaceName, spaceSlug, ...row }: Row): Advertiser => ({
  ...row,
  space:
    spaceId && spaceName !== null && spaceSlug !== null
      ? { id: spaceId, name: spaceName, slug: spaceSlug }
      : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Anunciantes (RF-ADS-01, RN-ADS-01, decisão 74). Só o Super chega aqui (RN-ADS-02). */
@Injectable()
export class AdvertisersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Optional() private readonly cache?: AdCandidatesCache,
  ) {}

  async list(query: AdvertisersQuery): Promise<AdvertiserList> {
    const conditions: SQL[] = [];
    if (query.q) conditions.push(ilike(advertisers.name, likePattern(query.q)));
    if (query.active !== undefined) conditions.push(eq(advertisers.active, query.active));
    if (query.kind) conditions.push(eq(advertisers.kind, query.kind));
    if (query.category) conditions.push(eq(advertisers.category, query.category));
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await this.db.select({ total: count() }).from(advertisers).where(where);
    const rows = await this.db
      .select(columns)
      .from(advertisers)
      .leftJoin(spaces, eq(spaces.id, advertisers.spaceId))
      .where(where)
      .orderBy(asc(advertisers.name), asc(advertisers.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: rows.map(toAdvertiser),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.total ?? 0,
    };
  }

  async get(id: string): Promise<Advertiser> {
    const [row] = await this.db
      .select(columns)
      .from(advertisers)
      .leftJoin(spaces, eq(spaces.id, advertisers.spaceId))
      .where(eq(advertisers.id, id));
    if (!row) throw advertiserNotFound();
    return toAdvertiser(row);
  }

  /** Cria o anunciante (auditado: `super.advertiser.create`). */
  async create(actorId: string | null, input: CreateAdvertiser): Promise<Advertiser> {
    const id = await this.db
      .transaction(async (tx) => {
        if (input.spaceId) await assertActiveSpace(tx, input.spaceId);
        const [row] = await tx
          .insert(advertisers)
          .values({
            name: input.name,
            kind: input.kind,
            spaceId: input.spaceId ?? null,
            category: input.category,
            contactName: input.contactName ?? null,
            contactEmail: input.contactEmail ?? null,
            contactPhone: input.contactPhone ?? null,
            notes: input.notes ?? null,
          })
          .returning({ id: advertisers.id });
        if (!row) throw new Error('Insert de anunciante sem retorno.');
        await adsAudit(tx, actorId, {
          action: 'super.advertiser.create',
          entity: 'advertiser',
          entityId: row.id,
          diff: { name: input.name, kind: input.kind, category: input.category },
        });
        return row.id;
      })
      .catch((err) => {
        throw isUniqueViolation(err, SPACE_TAKEN) ? advertiserSpaceTaken() : err;
      });
    return this.get(id);
  }

  /**
   * Edita os dados e ativa/desativa (`active`). Auditado: `super.advertiser.update` para os dados
   * e `super.advertiser.activate`/`deactivate` para a ativação. Desativar tira do ar todas as
   * campanhas do anunciante; reativar o de espaço exige o espaço ativo (`AD_SPACE_NOT_FOUND`).
   */
  async update(actorId: string, id: string, input: UpdateAdvertiser): Promise<Advertiser> {
    await this.db
      .transaction(async (tx) => {
        await lockAdvertiser(tx, id);
        const [current] = await tx.select().from(advertisers).where(eq(advertisers.id, id));
        if (!current) throw advertiserNotFound();
        const { active, ...fields } = input;
        const diff = changes(current, fields);
        const toggled = active !== undefined && active !== current.active;
        if (!diff && !toggled) return;
        // Reativar o anunciante de espaço só com o espaço ativo (como na criação).
        if (toggled && active && current.spaceId) await assertActiveSpace(tx, current.spaceId);
        await tx
          .update(advertisers)
          .set({ ...fields, ...(toggled ? { active } : {}) })
          .where(eq(advertisers.id, id));
        if (diff) {
          await adsAudit(tx, actorId, {
            action: 'super.advertiser.update',
            entity: 'advertiser',
            entityId: id,
            diff,
          });
        }
        if (toggled) {
          await adsAudit(tx, actorId, {
            action: active ? 'super.advertiser.activate' : 'super.advertiser.deactivate',
            entity: 'advertiser',
            entityId: id,
          });
        }
      })
      .catch((err) => {
        throw isUniqueViolation(err, SPACE_TAKEN) ? advertiserSpaceTaken() : err;
      });
    this.cache?.clear();
    return this.get(id);
  }
}

/**
 * O espaço do anunciante existe e está ativo (`AD_SPACE_NOT_FOUND` se não). Trava a linha em modo
 * compartilhado: o espaço não muda de status até o fim da transação.
 */
async function assertActiveSpace(tx: Tx, spaceId: string): Promise<void> {
  const [space] = await tx
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.status, 'ACTIVE')))
    .for('share');
  if (!space) throw advertiserSpaceNotFound();
}

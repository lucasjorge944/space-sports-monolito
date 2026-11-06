import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AD_CAMPAIGN_STATUS_TRANSITIONS,
  type AdCampaign,
  type AdCampaignDetail,
  type AdCampaignList,
  type AdCampaignStatusChange,
  type AdCampaignsQuery,
  type CreateAdCampaign,
  type UpdateAdCampaign,
} from '@space-sports/shared';
import { and, count, eq, ilike, inArray, not, or, type SQL, sql } from 'drizzle-orm';
import type { Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { adCampaigns, adCreatives, advertisers, cities, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { storageUnavailable } from '../storage/storage.errors.js';
import { likePattern } from '../super/super-audit.js';
import { AdCandidatesCache } from './ad-candidates.cache.js';
import { copiedImageKey } from './ad-images.js';
import { loadCampaigns, loadCreatives, onAirNow } from './ad-views.js';
import {
  advertiserNotFound,
  campaignNotFound,
  cityNotFound,
  invalidPeriod,
  invalidStatusTransition,
  placementLocked,
  sportNotFound,
} from './ads.errors.js';
import { adsAudit, changes, lockCampaign } from './ads-common.js';

const COPY_SUFFIX = ' (cópia)';

/** Campanhas (RF-ADS-02): cadastro, status, duplicação e situação "no ar". Só o Super. */
@Injectable()
export class AdCampaignsService {
  private readonly logger = new Logger(AdCampaignsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: PhotoStorage,
    @Optional() private readonly cache?: AdCandidatesCache,
  ) {}

  async list(query: AdCampaignsQuery): Promise<AdCampaignList> {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(
        or(ilike(adCampaigns.name, pattern), ilike(advertisers.name, pattern)) as SQL,
      );
    }
    if (query.advertiserId) conditions.push(eq(adCampaigns.advertiserId, query.advertiserId));
    if (query.placement) conditions.push(eq(adCampaigns.placement, query.placement));
    if (query.status) conditions.push(eq(adCampaigns.status, query.status));
    if (query.onAir !== undefined) conditions.push(query.onAir ? onAirNow : not(onAirNow));
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await this.db
      .select({ total: count() })
      .from(adCampaigns)
      .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
      .where(where);
    const items = await loadCampaigns(this.db, where, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items, page: query.page, pageSize: query.pageSize, total: totalRow?.total ?? 0 };
  }

  async get(id: string): Promise<AdCampaignDetail> {
    const [campaign] = await loadCampaigns(this.db, eq(adCampaigns.id, id));
    if (!campaign) throw campaignNotFound();
    return { ...campaign, creatives: await loadCreatives(this.db, eq(adCreatives.campaignId, id)) };
  }

  /** Cria a campanha (auditado: `super.ad_campaign.create`). */
  async create(actorId: string | null, input: CreateAdCampaign): Promise<AdCampaign> {
    const id = await this.db.transaction(async (tx) => {
      const [advertiser] = await tx
        .select({ id: advertisers.id })
        .from(advertisers)
        .where(eq(advertisers.id, input.advertiserId));
      if (!advertiser) throw advertiserNotFound();
      const cityIds = unique(input.cityIds);
      const sportIds = unique(input.sportIds);
      await assertTargeting(tx, cityIds, sportIds);
      const [row] = await tx
        .insert(adCampaigns)
        .values({
          advertiserId: input.advertiserId,
          name: input.name,
          placement: input.placement,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          cityIds,
          sportIds,
          weight: input.weight,
          status: input.status,
          createdBy: actorId,
        })
        .returning({ id: adCampaigns.id });
      if (!row) throw new Error('Insert de campanha sem retorno.');
      await adsAudit(tx, actorId, {
        action: 'super.ad_campaign.create',
        entity: 'ad_campaign',
        entityId: row.id,
        diff: { ...input, cityIds, sportIds },
      });
      return row.id;
    });
    this.cache?.clear();
    return this.campaign(id);
  }

  /**
   * Edita a campanha (auditado: `super.ad_campaign.update`). A vaga só muda sem peças
   * (`AD_PLACEMENT_LOCKED`); o período final precisa ter fim depois do início.
   */
  async update(actorId: string, id: string, input: UpdateAdCampaign): Promise<AdCampaign> {
    await this.db.transaction(async (tx) => {
      await lockCampaign(tx, id);
      const [current] = await tx.select().from(adCampaigns).where(eq(adCampaigns.id, id));
      if (!current) throw campaignNotFound();
      const next = {
        name: input.name,
        placement: input.placement,
        startsAt: input.startsAt === undefined ? undefined : new Date(input.startsAt),
        endsAt: input.endsAt === undefined ? undefined : new Date(input.endsAt),
        cityIds: input.cityIds && unique(input.cityIds),
        sportIds: input.sportIds && unique(input.sportIds),
        weight: input.weight,
      };
      const diff = changes(current, next);
      if (!diff) return;
      if ((next.endsAt ?? current.endsAt) <= (next.startsAt ?? current.startsAt)) {
        throw invalidPeriod();
      }
      if (next.placement && next.placement !== current.placement) {
        const creatives = await tx.$count(adCreatives, eq(adCreatives.campaignId, id));
        if (creatives > 0) throw placementLocked();
      }
      await assertTargeting(tx, next.cityIds ?? [], next.sportIds ?? []);
      await tx.update(adCampaigns).set(next).where(eq(adCampaigns.id, id));
      await adsAudit(tx, actorId, {
        action: 'super.ad_campaign.update',
        entity: 'ad_campaign',
        entityId: id,
        diff,
      });
    });
    this.cache?.clear();
    return this.campaign(id);
  }

  /**
   * Muda o status (`AD_CAMPAIGN_STATUS_TRANSITIONS`; auditado: `super.ad_campaign.status`).
   * Repetir o status atual não muda nada.
   */
  async changeStatus(
    actorId: string,
    id: string,
    { status }: AdCampaignStatusChange,
  ): Promise<AdCampaign> {
    await this.db.transaction(async (tx) => {
      await lockCampaign(tx, id);
      const [current] = await tx
        .select({ status: adCampaigns.status })
        .from(adCampaigns)
        .where(eq(adCampaigns.id, id));
      if (!current) throw campaignNotFound();
      if (current.status === status) return;
      if (!AD_CAMPAIGN_STATUS_TRANSITIONS[current.status].includes(status)) {
        throw invalidStatusTransition();
      }
      await tx.update(adCampaigns).set({ status }).where(eq(adCampaigns.id, id));
      await adsAudit(tx, actorId, {
        action: 'super.ad_campaign.status',
        entity: 'ad_campaign',
        entityId: id,
        diff: { before: current.status, after: status },
      });
    });
    this.cache?.clear();
    return this.campaign(id);
  }

  /**
   * Copia a campanha como `DRAFT`, com as peças e cópias das imagens em `ads/<nova>/`
   * (auditado: `super.ad_campaign.duplicate`). Sem storage, campanha com imagem responde 503.
   */
  async duplicate(actorId: string, id: string): Promise<AdCampaignDetail> {
    const [source] = await this.db.select().from(adCampaigns).where(eq(adCampaigns.id, id));
    if (!source) throw campaignNotFound();
    const creatives = await this.db
      .select()
      .from(adCreatives)
      .where(eq(adCreatives.campaignId, id))
      .orderBy(adCreatives.position, adCreatives.id);
    const withImage = creatives.filter((creative) => creative.imageUrl);
    if (withImage.length && !this.storage.enabled) throw storageUnavailable();

    const newId = await newCampaignId(this.db);
    // As imagens são copiadas antes do commit; se a transação falhar, as cópias são apagadas.
    const images = new Map<string, string>();
    try {
      for (const creative of withImage) {
        const sourceKey = creative.imageUrl && this.storage.keyFromUrl(creative.imageUrl);
        if (!sourceKey) continue;
        const target = copiedImageKey(newId, sourceKey);
        if (await this.storage.copy(sourceKey, target)) {
          images.set(creative.id, this.storage.publicUrl(target));
        }
      }
      await this.db.transaction(async (tx) => {
        const name = `${source.name.slice(0, 120 - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
        await tx.insert(adCampaigns).values({
          id: newId,
          advertiserId: source.advertiserId,
          name,
          placement: source.placement,
          startsAt: source.startsAt,
          endsAt: source.endsAt,
          cityIds: source.cityIds,
          sportIds: source.sportIds,
          weight: source.weight,
          status: 'DRAFT',
          createdBy: actorId,
        });
        if (creatives.length) {
          await tx.insert(adCreatives).values(
            creatives.map(({ id: creativeId, createdAt: _c, updatedAt: _u, ...creative }) => ({
              ...creative,
              campaignId: newId,
              // Imagem que sumiu do storage: a cópia fica sem imagem e o Super troca.
              imageUrl: creative.imageUrl ? (images.get(creativeId) ?? null) : null,
            })),
          );
        }
        await adsAudit(tx, actorId, {
          action: 'super.ad_campaign.duplicate',
          entity: 'ad_campaign',
          entityId: newId,
          diff: { sourceId: id, creatives: creatives.length },
        });
      });
    } catch (err) {
      await this.discardImages([...images.values()]);
      throw err;
    }
    return this.get(newId);
  }

  private async campaign(id: string): Promise<AdCampaign> {
    const [campaign] = await loadCampaigns(this.db, eq(adCampaigns.id, id));
    if (!campaign) throw campaignNotFound();
    return campaign;
  }

  private async discardImages(urls: string[]): Promise<void> {
    for (const url of urls) {
      const key = this.storage.keyFromUrl(url);
      if (key?.startsWith('ads/')) await this.storage.delete(key);
    }
    if (urls.length) this.logger.warn({ count: urls.length }, 'Cópias de imagens descartadas');
  }
}

/** Id da campanha antes do insert (as cópias das imagens vão para `ads/<id>/`). */
async function newCampaignId(db: Database): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`SELECT uuid_generate_v7() AS id`);
  const id = rows[0]?.id;
  if (!id) throw new Error('uuid_generate_v7 sem retorno.');
  return id;
}

const unique = (ids: string[]) => [...new Set(ids)];

/** Cidades e esportes da segmentação existem (o array não tem FK). */
async function assertTargeting(tx: Tx, cityIds: string[], sportIds: string[]): Promise<void> {
  if (cityIds.length) {
    const found = await tx.$count(cities, inArray(cities.id, cityIds));
    if (found !== cityIds.length) throw cityNotFound();
  }
  if (sportIds.length) {
    const found = await tx.$count(sports, inArray(sports.id, sportIds));
    if (found !== sportIds.length) throw sportNotFound();
  }
}

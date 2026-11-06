import type { AdCampaign, AdCreative, AdOffAirReason } from '@space-sports/shared';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { adCampaigns, adCreatives, advertisers, spaces } from '../db/schema/index.js';
import { visibleInShowcase } from '../spaces/space-queries.js';

// Leituras dos anúncios no formato da API (Super).

/** O espaço do `spaces` da consulta está na vitrine (falso sem espaço). */
const showcaseVisible = sql<boolean>`COALESCE(${visibleInShowcase}, false)`;

/**
 * Peça ativa que pode ser entregue, com as mesmas regras da entrega: com imagem ou com destino em
 * espaço (a peça de espaço usa a capa), e destino que não é espaço ou espaço na vitrine
 * (RN-ADS-05). Correlacionada com `ad_campaigns` da consulta de fora.
 */
export const hasDeliverableCreative = sql<boolean>`EXISTS (
  SELECT 1 FROM ${adCreatives}
  WHERE ${adCreatives.campaignId} = ${adCampaigns.id} AND ${adCreatives.active}
    AND (${adCreatives.imageUrl} IS NOT NULL OR ${adCreatives.destinationType} = 'SPACE')
    AND (
      ${adCreatives.destinationType} <> 'SPACE'
      OR EXISTS (
        SELECT 1 FROM ${spaces}
        WHERE ${spaces.id} = ${adCreatives.destinationSpaceId} AND ${visibleInShowcase}
      )
    )
)`;

/** No ar agora (RF-ADS-02). Precisa de `advertisers` na consulta. */
export const onAirNow = sql<boolean>`(
  ${adCampaigns.status} = 'ACTIVE'
  AND ${adCampaigns.startsAt} <= now() AND ${adCampaigns.endsAt} > now()
  AND ${advertisers.active}
  AND ${hasDeliverableCreative}
)`;

export const campaignColumns = {
  id: adCampaigns.id,
  name: adCampaigns.name,
  placement: adCampaigns.placement,
  startsAt: adCampaigns.startsAt,
  endsAt: adCampaigns.endsAt,
  cityIds: adCampaigns.cityIds,
  sportIds: adCampaigns.sportIds,
  weight: adCampaigns.weight,
  status: adCampaigns.status,
  createdAt: adCampaigns.createdAt,
  updatedAt: adCampaigns.updatedAt,
  advertiserId: advertisers.id,
  advertiserName: advertisers.name,
  advertiserKind: advertisers.kind,
  advertiserCategory: advertisers.category,
  advertiserActive: advertisers.active,
  creativesCount: sql<number>`(
    SELECT count(*)::int FROM ${adCreatives} WHERE ${adCreatives.campaignId} = ${adCampaigns.id}
  )`,
  activeCreativesCount: sql<number>`(
    SELECT count(*)::int FROM ${adCreatives}
    WHERE ${adCreatives.campaignId} = ${adCampaigns.id} AND ${adCreatives.active}
  )`,
  started: sql<boolean>`${adCampaigns.startsAt} <= now()`,
  ended: sql<boolean>`${adCampaigns.endsAt} <= now()`,
  deliverable: hasDeliverableCreative,
};

export type CampaignRow = {
  id: string;
  name: string;
  placement: AdCampaign['placement'];
  startsAt: Date;
  endsAt: Date;
  cityIds: string[];
  sportIds: string[];
  weight: number;
  status: AdCampaign['status'];
  createdAt: Date;
  updatedAt: Date;
  advertiserId: string;
  advertiserName: string;
  advertiserKind: AdCampaign['advertiser']['kind'];
  advertiserCategory: AdCampaign['advertiser']['category'];
  advertiserActive: boolean;
  creativesCount: number;
  activeCreativesCount: number;
  started: boolean;
  ended: boolean;
  deliverable: boolean;
};

export function toCampaign(row: CampaignRow): AdCampaign {
  const reasons: AdOffAirReason[] = [];
  if (row.status !== 'ACTIVE') reasons.push('NOT_ACTIVE');
  if (!row.started) reasons.push('NOT_STARTED');
  if (row.ended) reasons.push('ENDED');
  if (!row.advertiserActive) reasons.push('ADVERTISER_INACTIVE');
  if (!row.deliverable) reasons.push('NO_CREATIVES');
  return {
    id: row.id,
    advertiser: {
      id: row.advertiserId,
      name: row.advertiserName,
      kind: row.advertiserKind,
      category: row.advertiserCategory,
      active: row.advertiserActive,
    },
    name: row.name,
    placement: row.placement,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    cityIds: row.cityIds,
    sportIds: row.sportIds,
    weight: row.weight,
    status: row.status,
    creativesCount: row.creativesCount,
    activeCreativesCount: row.activeCreativesCount,
    delivery: { onAir: reasons.length === 0, reasons },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Campanhas com o anunciante, no formato da API. */
export async function loadCampaigns(
  db: DbOrTx,
  where: SQL | undefined,
  page?: { limit: number; offset: number },
): Promise<AdCampaign[]> {
  const query = db
    .select(campaignColumns)
    .from(adCampaigns)
    .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .where(where)
    .orderBy(sql`${adCampaigns.createdAt} DESC`, asc(adCampaigns.id));
  const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;
  return rows.map(toCampaign);
}

/** Peças no formato da API, na ordem da campanha. */
export async function loadCreatives(db: DbOrTx, where: SQL): Promise<AdCreative[]> {
  const rows = await db
    .select({
      creative: adCreatives,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
      showcaseVisible,
    })
    .from(adCreatives)
    .leftJoin(spaces, eq(spaces.id, adCreatives.destinationSpaceId))
    .where(where)
    .orderBy(asc(adCreatives.campaignId), asc(adCreatives.position), asc(adCreatives.id));
  return rows.map(({ creative, spaceName, spaceSlug, showcaseVisible }) => ({
    id: creative.id,
    campaignId: creative.campaignId,
    imageUrl: creative.imageUrl,
    title: creative.title,
    body: creative.body,
    ctaLabel: creative.ctaLabel,
    destination: toDestination(creative, { spaceName, spaceSlug, showcaseVisible }),
    active: creative.active,
    position: creative.position,
    createdAt: creative.createdAt.toISOString(),
    updatedAt: creative.updatedAt.toISOString(),
  }));
}

function toDestination(
  creative: typeof adCreatives.$inferSelect,
  space: { spaceName: string | null; spaceSlug: string | null; showcaseVisible: boolean },
): AdCreative['destination'] {
  switch (creative.destinationType) {
    case 'URL':
      return { type: 'URL', url: creative.destinationUrl ?? '' };
    case 'WHATSAPP':
      return {
        type: 'WHATSAPP',
        phone: creative.whatsappPhone ?? '',
        message: creative.whatsappMessage ?? '',
      };
    case 'SPACE':
      return {
        type: 'SPACE',
        space: {
          id: creative.destinationSpaceId ?? '',
          name: space.spaceName ?? '',
          slug: space.spaceSlug ?? '',
          showcaseVisible: space.showcaseVisible,
        },
      };
  }
}

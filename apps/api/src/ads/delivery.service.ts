import { Inject, Injectable } from '@nestjs/common';
import {
  AD_MAX_ITEMS,
  type AdAdvertiserKind,
  type AdDelivery,
  type AdDeliveryList,
  type AdPlacement,
  type AdsQuery,
  type SpaceCard,
  whatsappLink,
} from '@space-sports/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { adCampaigns, adCreatives, advertisers, spaces, sports } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PublicSpacesService } from '../spaces/public-spaces.service.js';
import { visibleInShowcase } from '../spaces/space-queries.js';
import { AdCandidatesCache } from './ad-candidates.cache.js';
import { drawCreatives } from './ad-draw.js';
import { DeliveryTokens } from './delivery-token.js';

/** Raio para achar a cidade pelas coordenadas: a do espaço da vitrine mais próximo (50 km). */
export const AD_CITY_RADIUS_M = 50_000;

/** Peça no ar da vaga, já com o card do espaço quando o destino é um espaço. */
type Candidate = {
  creativeId: string;
  campaignId: string;
  weight: number;
  startsAt: number;
  endsAt: number;
  cityIds: string[];
  sportIds: string[];
  advertiser: { name: string; kind: AdAdvertiserKind };
  title: string;
  body: string | null;
  ctaLabel: string;
  imageUrl: string | null;
  destination:
    | { type: 'URL'; url: string }
    | { type: 'WHATSAPP'; phone: string; message: string }
    | { type: 'SPACE'; space: SpaceCard };
};

/**
 * Entrega pública dos anúncios (RF-ADS-07, RN-ADS-03, RN-ADS-05), sem login. As peças no ar de
 * cada vaga (campanha `ACTIVE` ainda não encerrada, anunciante e peça ativos, destino de espaço só
 * com o espaço na vitrine) ficam no cache curto; período, cidade e esporte são filtrados a cada
 * pedido, e o sorteio ponderado escolhe uma peça por campanha. Nada do pedido é gravado.
 */
@Injectable()
export class AdDeliveryService {
  /** Cidade por coordenada arredondada (~1 km), no mesmo TTL das campanhas. */
  private readonly cityByPoint = new Map<string, { at: number; cityId: string | null }>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: AdCandidatesCache,
    private readonly publicSpaces: PublicSpacesService,
    private readonly tokens: DeliveryTokens,
  ) {}

  async deliver(
    query: AdsQuery,
    now: Date = new Date(),
    random: () => number = Math.random,
  ): Promise<AdDeliveryList> {
    const [candidates, cityId, sportId] = await Promise.all([
      this.cache.get(`candidates:${query.placement}`, () => this.loadCandidates(query.placement)),
      this.resolveCity(query),
      this.resolveSport(query),
    ]);
    const time = now.getTime();
    const eligible = candidates.filter(
      (candidate) =>
        candidate.startsAt <= time &&
        candidate.endsAt > time &&
        (candidate.cityIds.length === 0 ||
          (cityId !== null && candidate.cityIds.includes(cityId))) &&
        (candidate.sportIds.length === 0 ||
          (sportId !== null && candidate.sportIds.includes(sportId))),
    );
    const byCampaign = new Map<
      string,
      { campaignId: string; weight: number; creatives: Candidate[] }
    >();
    for (const candidate of eligible) {
      const group = byCampaign.get(candidate.campaignId) ?? {
        campaignId: candidate.campaignId,
        weight: candidate.weight,
        creatives: [],
      };
      group.creatives.push(candidate);
      byCampaign.set(candidate.campaignId, group);
    }
    const drawn = drawCreatives([...byCampaign.values()], AD_MAX_ITEMS[query.placement], random);
    return { items: drawn.map((candidate) => this.toDelivery(candidate, query.placement, now)) };
  }

  private toDelivery(candidate: Candidate, placement: AdPlacement, now: Date): AdDelivery {
    const { token, claims } = this.tokens.sign(
      { creativeId: candidate.creativeId, campaignId: candidate.campaignId, placement },
      now,
    );
    const destination: AdDelivery['destination'] =
      candidate.destination.type === 'WHATSAPP'
        ? {
            ...candidate.destination,
            url: whatsappLink(candidate.destination.phone, candidate.destination.message),
          }
        : candidate.destination;
    return {
      creativeId: candidate.creativeId,
      campaignId: candidate.campaignId,
      placement,
      advertiser: candidate.advertiser,
      title: candidate.title,
      body: candidate.body,
      ctaLabel: candidate.ctaLabel,
      imageUrl: candidate.imageUrl,
      destination,
      deliveryToken: token,
      tokenExpiresAt: claims.expiresAt.toISOString(),
    };
  }

  /** Peças das campanhas ativas e não encerradas da vaga (o período exato é conferido no pedido). */
  private async loadCandidates(placement: AdPlacement): Promise<Candidate[]> {
    const rows = await this.db
      .select({
        creative: adCreatives,
        weight: adCampaigns.weight,
        startsAt: adCampaigns.startsAt,
        endsAt: adCampaigns.endsAt,
        cityIds: adCampaigns.cityIds,
        sportIds: adCampaigns.sportIds,
        advertiserName: advertisers.name,
        advertiserKind: advertisers.kind,
      })
      .from(adCreatives)
      .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
      .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
      .where(
        and(
          eq(adCampaigns.placement, placement),
          eq(adCampaigns.status, 'ACTIVE'),
          sql`${adCampaigns.endsAt} > now()`,
          eq(advertisers.active, true),
          eq(adCreatives.active, true),
        ),
      );
    const spaceIds = rows.flatMap(({ creative }) =>
      creative.destinationType === 'SPACE' && creative.destinationSpaceId
        ? [creative.destinationSpaceId]
        : [],
    );
    // Só os espaços na vitrine voltam (RN-ADS-05).
    const cards = new Map(
      (await this.publicSpaces.cardsByIds(spaceIds)).map((card) => [card.id, card]),
    );
    return rows.flatMap((row): Candidate[] => {
      const { creative } = row;
      let destination: Candidate['destination'];
      if (creative.destinationType === 'SPACE') {
        const space = creative.destinationSpaceId ? cards.get(creative.destinationSpaceId) : null;
        if (!space) return [];
        destination = { type: 'SPACE', space };
      } else if (creative.destinationType === 'WHATSAPP') {
        destination = {
          type: 'WHATSAPP',
          phone: creative.whatsappPhone ?? '',
          message: creative.whatsappMessage ?? '',
        };
      } else {
        destination = { type: 'URL', url: creative.destinationUrl ?? '' };
      }
      // Sem imagem só peça de espaço (a API não grava outra); o app usa a capa e a logo do card.
      if (!creative.imageUrl && destination.type !== 'SPACE') return [];
      return [
        {
          creativeId: creative.id,
          campaignId: creative.campaignId,
          weight: row.weight,
          startsAt: row.startsAt.getTime(),
          endsAt: row.endsAt.getTime(),
          cityIds: row.cityIds,
          sportIds: row.sportIds,
          advertiser: { name: row.advertiserName, kind: row.advertiserKind },
          title: creative.title,
          body: creative.body,
          ctaLabel: creative.ctaLabel,
          imageUrl: creative.imageUrl,
          destination,
        },
      ];
    });
  }

  /**
   * Cidade da consulta: `cityId`; sem ele, a do espaço da vitrine mais próximo das coordenadas, a
   * até 50 km; sem nenhum dos dois (ou nada perto), nula, e só entram campanhas sem filtro de
   * cidade.
   */
  private async resolveCity(query: AdsQuery): Promise<string | null> {
    if (query.cityId) return query.cityId;
    if (query.lat === undefined || query.lng === undefined) return null;
    const key = `${query.lat.toFixed(2)},${query.lng.toFixed(2)}`;
    const now = Date.now();
    const cached = this.cityByPoint.get(key);
    if (cached && now - cached.at < this.cache.ttlMs) return cached.cityId;

    const point = sql`ST_SetSRID(ST_MakePoint(${query.lng}::float8, ${query.lat}::float8), 4326)::geography`;
    const { rows } = await this.db.execute<{ city_id: string }>(sql`
      SELECT ${spaces.cityId} AS city_id FROM ${spaces}
      WHERE ${visibleInShowcase}
        AND ST_DWithin(${spaces.location}, ${point}, ${AD_CITY_RADIUS_M}::float8)
      ORDER BY ST_Distance(${spaces.location}, ${point}), ${spaces.id}
      LIMIT 1
    `);
    const cityId = rows[0]?.city_id ?? null;
    if (this.cityByPoint.size >= 1000) this.cityByPoint.clear();
    this.cityByPoint.set(key, { at: now, cityId });
    return cityId;
  }

  /** Esporte da consulta: `sportId` ou o id do slug em `sport` (slug desconhecido = sem esporte). */
  private async resolveSport(query: AdsQuery): Promise<string | null> {
    if (query.sportId) return query.sportId;
    if (!query.sport) return null;
    const bySlug = await this.cache.get('sports', async () => {
      const rows = await this.db.select({ id: sports.id, slug: sports.slug }).from(sports);
      return new Map(rows.map((row) => [row.slug, row.id]));
    });
    return bySlug.get(query.sport) ?? null;
  }
}

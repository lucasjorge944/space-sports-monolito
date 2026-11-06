import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import {
  adAdvertiserKind,
  adCampaignStatus,
  adCategory,
  adDestinationType,
  adEventType,
  adPlacement,
} from './enums.js';
import { users } from './identity.js';
import { spaces } from './spaces.js';

// Anúncios (decisões 73 a 79; RF-ADS, RN-ADS; docs/12-anuncios.md). Só o Super lê e escreve
// (RN-ADS-02); a entrega pública lê as campanhas no ar e os eventos só somam contadores diários.

/** Anunciantes: empresas ou espaços parceiros (decisão 74). */
export const advertisers = pgTable(
  'advertisers',
  {
    id: id(),
    name: text().notNull(),
    kind: adAdvertiserKind().notNull(),
    /** Só no tipo `SPACE`. */
    spaceId: uuid().references(() => spaces.id),
    category: adCategory().notNull(),
    contactName: text(),
    contactEmail: text(),
    contactPhone: text(),
    notes: text(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('advertisers_name_idx').on(t.name),
    // Um anunciante ativo por espaço.
    uniqueIndex('advertisers_space_id_active_unique')
      .on(t.spaceId)
      .where(sql`${t.active} AND ${t.spaceId} IS NOT NULL`),
    check('advertisers_space_kind', sql`(${t.kind} = 'SPACE') = (${t.spaceId} IS NOT NULL)`),
    check('advertisers_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
  ],
);

/** Campanhas: vaga, período, segmentação (cidade e esporte) e peso do sorteio. */
export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: id(),
    advertiserId: uuid()
      .notNull()
      .references(() => advertisers.id),
    name: text().notNull(),
    placement: adPlacement().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    /** Vazio = todas as cidades. Sem FK (array): a API confere ao gravar. */
    cityIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** Vazio = todos os esportes. */
    sportIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    weight: integer().notNull().default(5),
    status: adCampaignStatus().notNull().default('DRAFT'),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    // Entrega: campanhas ativas da vaga dentro do período.
    index('ad_campaigns_delivery_idx').on(t.placement, t.status, t.startsAt, t.endsAt),
    index('ad_campaigns_advertiser_id_idx').on(t.advertiserId),
    index('ad_campaigns_created_by_idx').on(t.createdBy),
    check('ad_campaigns_period_valid', sql`${t.endsAt} > ${t.startsAt}`),
    check('ad_campaigns_weight_range', sql`${t.weight} BETWEEN 1 AND 10`),
  ],
);

/**
 * Peças da campanha. Imagem publicada em `ads/<campaignId>/...` no bucket de mídia; sem imagem só
 * em anunciante `SPACE` (a API confere). O destino é coerente com o tipo (check).
 */
export const adCreatives = pgTable(
  'ad_creatives',
  {
    id: id(),
    campaignId: uuid()
      .notNull()
      .references(() => adCampaigns.id),
    imageUrl: text(),
    title: text().notNull(),
    body: text(),
    ctaLabel: text().notNull(),
    destinationType: adDestinationType().notNull(),
    destinationUrl: text(),
    whatsappPhone: text(),
    whatsappMessage: text(),
    destinationSpaceId: uuid().references(() => spaces.id),
    active: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('ad_creatives_campaign_id_position_idx').on(t.campaignId, t.position),
    index('ad_creatives_destination_space_id_idx').on(t.destinationSpaceId),
    check(
      'ad_creatives_destination_valid',
      // COALESCE: um campo nulo deixaria a expressão nula, e o check passaria.
      sql`COALESCE(CASE ${t.destinationType}
        WHEN 'URL' THEN ${t.destinationUrl} ~ '^https://[^[:space:]]+$'
          AND ${t.whatsappPhone} IS NULL AND ${t.whatsappMessage} IS NULL
          AND ${t.destinationSpaceId} IS NULL
        WHEN 'WHATSAPP' THEN ${t.whatsappPhone} ~ '^\\+[1-9][0-9]{7,14}$'
          AND char_length(${t.whatsappMessage}) BETWEEN 1 AND 500
          AND ${t.destinationUrl} IS NULL AND ${t.destinationSpaceId} IS NULL
        WHEN 'SPACE' THEN ${t.destinationSpaceId} IS NOT NULL
          AND ${t.destinationUrl} IS NULL AND ${t.whatsappPhone} IS NULL
          AND ${t.whatsappMessage} IS NULL
      END, false)`,
    ),
    check(
      'ad_creatives_text_length',
      sql`char_length(${t.title}) BETWEEN 1 AND 40
        AND (${t.body} IS NULL OR char_length(${t.body}) BETWEEN 1 AND 90)
        AND char_length(${t.ctaLabel}) BETWEEN 1 AND 20`,
    ),
  ],
);

/**
 * Contadores diários por peça (dia em `America/Sao_Paulo`), somados por upsert. Sem usuário,
 * aparelho nem IP (RN-ADS-03). `campaign_id` e `placement` copiados para o relatório.
 */
export const adDailyStats = pgTable(
  'ad_daily_stats',
  {
    creativeId: uuid()
      .notNull()
      .references(() => adCreatives.id),
    campaignId: uuid()
      .notNull()
      .references(() => adCampaigns.id),
    placement: adPlacement().notNull(),
    day: date({ mode: 'string' }).notNull(),
    impressions: integer().notNull().default(0),
    clicks: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: 'ad_daily_stats_pkey', columns: [t.creativeId, t.day] }),
    index('ad_daily_stats_campaign_id_day_idx').on(t.campaignId, t.day),
    check('ad_daily_stats_counts_non_negative', sql`${t.impressions} >= 0 AND ${t.clicks} >= 0`),
  ],
);

/**
 * Recibos dos eventos: cada token de entrega conta no máximo uma impressão e um clique
 * (RN-ADS-04). Só o id aleatório da entrega, sem dado de quem viu; o job diário apaga os vencidos.
 */
export const adEventReceipts = pgTable(
  'ad_event_receipts',
  {
    deliveryId: uuid().notNull(),
    kind: adEventType().notNull(),
    /** Validade do token: depois dela o recibo não serve mais e é apagado. */
    expiresAt: tstz().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'ad_event_receipts_pkey', columns: [t.deliveryId, t.kind] }),
    index('ad_event_receipts_expires_at_idx').on(t.expiresAt),
  ],
);

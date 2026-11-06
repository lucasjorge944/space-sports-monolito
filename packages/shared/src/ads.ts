import { z } from 'zod';
import { PHOTO_CONTENT_TYPES, phoneE164Schema, photoUploadSchema, spaceCardSchema } from './spaces';
import { pageOf, pageQuerySchema } from './super';

// Anúncios (RF-ADS-01..09, RN-ADS-01..06; decisões 73 a 79; docs/12-anuncios.md).

const id = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
/** Instante em UTC (`Z`) ou com fuso (`-03:00`); a API grava em UTC. */
const instant = z.iso.datetime({ offset: true });
/** Texto opcional: vazio vira `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// ---------------------------------------------------------------------------
// Vagas e formatos (docs/12, seção 4)

export const AD_PLACEMENTS = ['EXPLORE_HERO', 'EXPLORE_FEED'] as const;
export const adPlacementSchema = z.enum(AD_PLACEMENTS);
export type AdPlacement = z.infer<typeof adPlacementSchema>;

export const AD_PLACEMENT_LABELS: Record<AdPlacement, string> = {
  EXPLORE_HERO: 'Carrossel do topo',
  EXPLORE_FEED: 'Card na lista',
};

/** Tamanho máximo da imagem da peça (as duas vagas). */
export const AD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const AD_IMAGE_CONTENT_TYPES = PHOTO_CONTENT_TYPES;
/** Tolerância da proporção da imagem (2%): 511×639 ainda é 4:5. */
export const AD_ASPECT_TOLERANCE = 0.02;

export const adImageFormatSchema = z.object({
  /** Proporção `aspectWidth:aspectHeight` (2:1 no carrossel, 4:5 no card). */
  aspectWidth: z.number().int(),
  aspectHeight: z.number().int(),
  minWidth: z.number().int(),
  minHeight: z.number().int(),
  maxBytes: z.number().int(),
});
export type AdImageFormat = z.infer<typeof adImageFormatSchema>;

export const AD_PLACEMENT_FORMATS: Record<AdPlacement, AdImageFormat> = {
  EXPLORE_HERO: {
    aspectWidth: 2,
    aspectHeight: 1,
    minWidth: 960,
    minHeight: 480,
    maxBytes: AD_IMAGE_MAX_BYTES,
  },
  EXPLORE_FEED: {
    aspectWidth: 4,
    aspectHeight: 5,
    minWidth: 480,
    minHeight: 600,
    maxBytes: AD_IMAGE_MAX_BYTES,
  },
};

/** Peças entregues por chamada de `GET /v1/ads` (uma por campanha). */
export const AD_MAX_ITEMS: Record<AdPlacement, number> = { EXPLORE_HERO: 5, EXPLORE_FEED: 10 };

/** A imagem cabe na vaga? A proporção é conferida antes do tamanho mínimo. */
export function adImageFit(
  placement: AdPlacement,
  size: { width: number; height: number },
): 'OK' | 'TOO_SMALL' | 'WRONG_ASPECT' {
  const format = AD_PLACEMENT_FORMATS[placement];
  const ratio = size.width / size.height / (format.aspectWidth / format.aspectHeight);
  if (Math.abs(ratio - 1) > AD_ASPECT_TOLERANCE) return 'WRONG_ASPECT';
  return size.width < format.minWidth || size.height < format.minHeight ? 'TOO_SMALL' : 'OK';
}

/** Limites de texto das peças (as duas vagas). */
export const AD_TEXT_LIMITS = { title: 40, body: 90, ctaLabel: 20, whatsappMessage: 500 } as const;

// ---------------------------------------------------------------------------
// Anunciantes (RF-ADS-01, RN-ADS-01)

export const AD_ADVERTISER_KINDS = ['COMPANY', 'SPACE'] as const;
export const adAdvertiserKindSchema = z.enum(AD_ADVERTISER_KINDS);
export type AdAdvertiserKind = z.infer<typeof adAdvertiserKindSchema>;

/** Sem `BETTING` nem `ALCOHOL` (decisão 75, RN-ADS-01). Suplementos podem. */
export const AD_CATEGORIES = [
  'SPORTING_GOODS',
  'APPAREL',
  'SUPPLEMENTS',
  'FOOD_BEVERAGE',
  'HEALTH',
  'FITNESS',
  'SPORTS_SPACE',
  'EVENTS',
  'SERVICES',
  'OTHER',
] as const;
export const adCategorySchema = z.enum(AD_CATEGORIES);
export type AdCategory = z.infer<typeof adCategorySchema>;

/** Categorias vetadas (decisão 75): a API responde `AD_CATEGORY_FORBIDDEN` a elas. */
export const AD_FORBIDDEN_CATEGORIES = ['BETTING', 'ALCOHOL'] as const;

export const AD_CATEGORY_LABELS: Record<AdCategory, string> = {
  SPORTING_GOODS: 'Artigos esportivos',
  APPAREL: 'Moda esportiva',
  SUPPLEMENTS: 'Suplementos',
  FOOD_BEVERAGE: 'Alimentação e bebidas sem álcool',
  HEALTH: 'Saúde',
  FITNESS: 'Fitness e equipamentos',
  SPORTS_SPACE: 'Espaço esportivo',
  EVENTS: 'Eventos',
  SERVICES: 'Serviços',
  OTHER: 'Outros',
};

const advertiserFields = {
  name: trimmed(120),
  category: adCategorySchema,
  contactName: optionalText(120),
  contactEmail: z.email().max(254).nullable().optional(),
  contactPhone: phoneE164Schema.nullable().optional(),
  notes: optionalText(2000),
};

/**
 * POST /v1/super/ads/advertisers. `SPACE` exige `spaceId` (espaço ativo, um anunciante ativo por
 * espaço); `COMPANY` não aceita. Tipo e espaço não mudam depois.
 */
export const createAdvertiserSchema = z
  .object({ ...advertiserFields, kind: adAdvertiserKindSchema, spaceId: id.optional() })
  .strict()
  .refine((value) => (value.kind === 'SPACE') === (value.spaceId !== undefined), {
    message: 'Anunciante do tipo Espaço precisa do espaço; empresa não tem espaço.',
    path: ['spaceId'],
  });
export type CreateAdvertiser = z.infer<typeof createAdvertiserSchema>;

/** PATCH /v1/super/ads/advertisers/:id; `active` ativa ou desativa. */
export const updateAdvertiserSchema = z
  .object({ ...advertiserFields, active: z.boolean() })
  .partial()
  .strict();
export type UpdateAdvertiser = z.infer<typeof updateAdvertiserSchema>;

export const advertiserSchema = z.object({
  id,
  name: z.string(),
  kind: adAdvertiserKindSchema,
  category: adCategorySchema,
  /** Só no tipo `SPACE`. */
  space: z.object({ id, name: z.string(), slug: z.string() }).nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  campaignsCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Advertiser = z.infer<typeof advertiserSchema>;

export const advertiserListSchema = pageOf(advertiserSchema);
export type AdvertiserList = z.infer<typeof advertiserListSchema>;

/** Filtros de GET /v1/super/ads/advertisers. */
export const advertisersQuerySchema = pageQuerySchema.extend({
  /** Parte do nome. */
  q: z.string().trim().min(1).max(100).optional(),
  active: z.stringbool().optional(),
  kind: adAdvertiserKindSchema.optional(),
  category: adCategorySchema.optional(),
});
export type AdvertisersQuery = z.infer<typeof advertisersQuerySchema>;

// ---------------------------------------------------------------------------
// Campanhas (RF-ADS-02)

export const AD_CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export const adCampaignStatusSchema = z.enum(AD_CAMPAIGN_STATUSES);
export type AdCampaignStatus = z.infer<typeof adCampaignStatusSchema>;

export const AD_CAMPAIGN_STATUS_LABELS: Record<AdCampaignStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
};

/** Mudanças de status aceitas; `ARCHIVED` é final (para voltar, duplique a campanha). */
export const AD_CAMPAIGN_STATUS_TRANSITIONS: Record<AdCampaignStatus, AdCampaignStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

/**
 * Por que a campanha não está no ar: status diferente de `ACTIVE`, antes do início, depois do fim,
 * anunciante inativo ou nenhuma peça ativa que possa ser entregue (peça com destino `SPACE` fora
 * da vitrine não conta, RN-ADS-05).
 */
export const AD_OFF_AIR_REASONS = [
  'NOT_ACTIVE',
  'NOT_STARTED',
  'ENDED',
  'ADVERTISER_INACTIVE',
  'NO_CREATIVES',
] as const;
export const adOffAirReasonSchema = z.enum(AD_OFF_AIR_REASONS);
export type AdOffAirReason = z.infer<typeof adOffAirReasonSchema>;

const targeting = {
  /** Vazio = todas as cidades. */
  cityIds: z.array(id).max(50),
  /** Vazio = todos os esportes. */
  sportIds: z.array(id).max(50),
  weight: z.number().int().min(1).max(10),
};

const periodRefine = <T extends { startsAt?: string; endsAt?: string }>(value: T) =>
  !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt);
const periodMessage = { message: 'O fim precisa ser depois do início.', path: ['endsAt'] };

/** POST /v1/super/ads/campaigns. Nasce `DRAFT` se o status não vier. */
export const createAdCampaignSchema = z
  .object({
    advertiserId: id,
    name: trimmed(120),
    placement: adPlacementSchema,
    startsAt: instant,
    endsAt: instant,
    cityIds: targeting.cityIds.default([]),
    sportIds: targeting.sportIds.default([]),
    weight: targeting.weight.default(5),
    status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).default('DRAFT'),
  })
  .strict()
  .refine(periodRefine, periodMessage);
export type CreateAdCampaign = z.infer<typeof createAdCampaignSchema>;

/**
 * PATCH /v1/super/ads/campaigns/:id. O anunciante não muda (duplique a campanha); a vaga só muda
 * enquanto a campanha não tem peças (as imagens são do formato da vaga). Status: rota própria.
 */
export const updateAdCampaignSchema = z
  .object({
    name: trimmed(120),
    placement: adPlacementSchema,
    startsAt: instant,
    endsAt: instant,
    ...targeting,
  })
  .partial()
  .strict()
  .refine(periodRefine, periodMessage);
export type UpdateAdCampaign = z.infer<typeof updateAdCampaignSchema>;

export const adCampaignStatusChangeSchema = z.object({ status: adCampaignStatusSchema }).strict();
export type AdCampaignStatusChange = z.infer<typeof adCampaignStatusChangeSchema>;

export const adCampaignSchema = z.object({
  id,
  advertiser: z.object({
    id,
    name: z.string(),
    kind: adAdvertiserKindSchema,
    category: adCategorySchema,
    active: z.boolean(),
  }),
  name: z.string(),
  placement: adPlacementSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  cityIds: z.array(id),
  sportIds: z.array(id),
  weight: z.number().int(),
  status: adCampaignStatusSchema,
  creativesCount: z.number().int(),
  activeCreativesCount: z.number().int(),
  /** No ar agora (RF-ADS-02) e, se não, por quê. */
  delivery: z.object({ onAir: z.boolean(), reasons: z.array(adOffAirReasonSchema) }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdCampaign = z.infer<typeof adCampaignSchema>;

export const adCampaignListSchema = pageOf(adCampaignSchema);
export type AdCampaignList = z.infer<typeof adCampaignListSchema>;

/** Filtros de GET /v1/super/ads/campaigns. */
export const adCampaignsQuerySchema = pageQuerySchema.extend({
  /** Parte do nome da campanha ou do anunciante. */
  q: z.string().trim().min(1).max(100).optional(),
  advertiserId: id.optional(),
  placement: adPlacementSchema.optional(),
  status: adCampaignStatusSchema.optional(),
  /** `true`: só as que estão no ar agora; `false`: só as que não estão. */
  onAir: z.stringbool().optional(),
});
export type AdCampaignsQuery = z.infer<typeof adCampaignsQuerySchema>;

// ---------------------------------------------------------------------------
// Peças (RF-ADS-03, RN-ADS-05)

export const AD_DESTINATION_TYPES = ['URL', 'WHATSAPP', 'SPACE'] as const;
export const adDestinationTypeSchema = z.enum(AD_DESTINATION_TYPES);
export type AdDestinationType = z.infer<typeof adDestinationTypeSchema>;

/**
 * URL externa: só `https` (RN-ADS-05). O `regex` espelha o check do banco (`https://` minúsculo e
 * sem espaço): o `z.url()` sozinho aceita `HTTPS://...`, `https:/x`, `https:x` e URL com espaço.
 */
export const adHttpsUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(2000)
  .regex(/^https:\/\/\S+$/, 'Use uma URL que comece com https://, sem espaços.');

export const adDestinationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), url: adHttpsUrlSchema }).strict(),
  z
    .object({
      type: z.literal('WHATSAPP'),
      phone: phoneE164Schema,
      message: trimmed(AD_TEXT_LIMITS.whatsappMessage),
    })
    .strict(),
  /** Espaço ativo da plataforma (RN-ADS-05). */
  z.object({ type: z.literal('SPACE'), spaceId: id }).strict(),
]);
export type AdDestinationInput = z.infer<typeof adDestinationInputSchema>;

const creativeFields = {
  title: trimmed(AD_TEXT_LIMITS.title),
  body: optionalText(AD_TEXT_LIMITS.body),
  ctaLabel: trimmed(AD_TEXT_LIMITS.ctaLabel),
  destination: adDestinationInputSchema,
  active: z.boolean(),
};

/**
 * POST /v1/super/ads/campaigns/:id/creatives. `imageKey`: chave devolvida por
 * `POST /v1/super/ads/creatives/uploads`, já com o arquivo enviado. Sem imagem, só anunciante
 * `SPACE` com destino no próprio espaço (usa a capa e a logo do espaço).
 */
export const createAdCreativeSchema = z
  .object({
    imageKey: z.string().min(1).max(300).nullable().optional(),
    ...creativeFields,
    active: creativeFields.active.default(true),
  })
  .strict();
export type CreateAdCreative = z.infer<typeof createAdCreativeSchema>;

/**
 * PATCH da peça. `imageKey` troca a imagem (a anterior é apagada); `null` tira a imagem (só peça
 * de anunciante `SPACE` com destino no próprio espaço).
 */
export const updateAdCreativeSchema = z
  .object({ imageKey: z.string().min(1).max(300).nullable(), ...creativeFields })
  .partial()
  .strict();
export type UpdateAdCreative = z.infer<typeof updateAdCreativeSchema>;

/** Nova ordem das peças: todos os ids da campanha. */
export const reorderAdCreativesSchema = z
  .object({ creativeIds: z.array(id).min(1).max(100) })
  .strict();
export type ReorderAdCreatives = z.infer<typeof reorderAdCreativesSchema>;

export const adDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), url: z.string() }),
  z.object({ type: z.literal('WHATSAPP'), phone: z.string(), message: z.string() }),
  z.object({
    type: z.literal('SPACE'),
    space: z.object({
      id,
      name: z.string(),
      slug: z.string(),
      /** Fora da vitrine, a peça não é entregue (RN-ADS-05). */
      showcaseVisible: z.boolean(),
    }),
  }),
]);
export type AdDestination = z.infer<typeof adDestinationSchema>;

export const adCreativeSchema = z.object({
  id,
  campaignId: id,
  /** Nula só em peça de anunciante `SPACE` (usa a capa do espaço). */
  imageUrl: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  ctaLabel: z.string(),
  destination: adDestinationSchema,
  active: z.boolean(),
  position: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdCreative = z.infer<typeof adCreativeSchema>;

export const adCampaignDetailSchema = adCampaignSchema.extend({
  creatives: z.array(adCreativeSchema),
});
export type AdCampaignDetail = z.infer<typeof adCampaignDetailSchema>;

export const adCreativeListSchema = z.object({ items: z.array(adCreativeSchema) });

/** POST /v1/super/ads/creatives/uploads: URL pré-assinada para a imagem da peça. */
export const createAdImageUploadSchema = z
  .object({
    placement: adPlacementSchema,
    contentType: z.enum(AD_IMAGE_CONTENT_TYPES),
    /** Tamanho do arquivo em bytes (opcional): recusa cedo o que passa do limite. */
    size: z.number().int().min(1).max(AD_IMAGE_MAX_BYTES).optional(),
  })
  .strict();
export type CreateAdImageUpload = z.infer<typeof createAdImageUploadSchema>;

export const adImageUploadSchema = photoUploadSchema.extend({
  /** Chave do objeto; envie como `imageKey` ao criar ou editar a peça de uma campanha da vaga. */
  key: z.string(),
  /** Formato exigido da imagem na vaga. */
  format: adImageFormatSchema,
});
export type AdImageUpload = z.infer<typeof adImageUploadSchema>;

// ---------------------------------------------------------------------------
// Relatório (RF-ADS-09)

/** Até um ano por consulta. */
export const AD_REPORT_MAX_DAYS = 366;

/**
 * Período do relatório em dias de `America/Sao_Paulo`. Padrão: do início da campanha até hoje (ou
 * até o fim, se já terminou).
 */
export const adReportQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: 'O fim do período precisa ser igual ou depois do início.',
    path: ['to'],
  });
export type AdReportQuery = z.infer<typeof adReportQuerySchema>;

const metrics = {
  impressions: z.number().int(),
  clicks: z.number().int(),
  /** Cliques ÷ impressões (0 sem impressões), de 0 a 1. */
  ctr: z.number(),
};

export const adReportSchema = z.object({
  campaignId: id,
  from: isoDate,
  to: isoDate,
  totals: z.object(metrics),
  /** Um item por dia do período, inclusive os zerados. */
  days: z.array(z.object({ day: isoDate, ...metrics })),
  creatives: z.array(z.object({ creativeId: id, title: z.string(), ...metrics })),
});
export type AdReport = z.infer<typeof adReportSchema>;

/** CTR de 0 a 1 (4 casas). */
export function adCtr(impressions: number, clicks: number): number {
  return impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 10_000 : 0;
}

// ---------------------------------------------------------------------------
// Entrega pública (RF-ADS-07, RN-ADS-03)

/**
 * Query de GET /v1/ads (sem login). Cidade: `cityId` ou, sem ele, a cidade do espaço da vitrine mais
 * próximo de `lat`/`lng` (até 50 km); sem nenhum dos dois, só campanhas sem filtro de cidade.
 * Esporte: `sportId` ou o slug em `sport` (o mesmo filtro de GET /v1/spaces); sem esporte, só
 * campanhas sem filtro de esporte.
 */
export const adsQuerySchema = z
  .object({
    placement: adPlacementSchema,
    cityId: id.optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    sportId: id.optional(),
    /** Slug do esporte; ignorado se `sportId` vier. */
    sport: z.string().trim().min(1).max(60).optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'Envie lat e lng juntos.',
    path: ['lng'],
  });
export type AdsQuery = z.infer<typeof adsQuerySchema>;

export const adDeliveryDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('URL'), url: z.string() }),
  z.object({
    type: z.literal('WHATSAPP'),
    phone: z.string(),
    message: z.string(),
    /** `https://wa.me/<telefone>?text=<mensagem>`, pronto para abrir. */
    url: z.string(),
  }),
  /** O card do espaço, no formato de GET /v1/spaces (sem distância). */
  z.object({ type: z.literal('SPACE'), space: spaceCardSchema }),
]);
export type AdDeliveryDestination = z.infer<typeof adDeliveryDestinationSchema>;

export const adDeliverySchema = z.object({
  creativeId: id,
  campaignId: id,
  placement: adPlacementSchema,
  /** Para o selo "Patrocinado · <anunciante>" (RF-ADS-06). */
  advertiser: z.object({ name: z.string(), kind: adAdvertiserKindSchema }),
  title: z.string(),
  body: z.string().nullable(),
  ctaLabel: z.string(),
  /** Nula em peça de espaço sem imagem própria: use a capa e a logo do card do espaço. */
  imageUrl: z.string().nullable(),
  destination: adDeliveryDestinationSchema,
  /** Envie em `POST /v1/ads/events` com cada impressão e clique desta entrega. */
  deliveryToken: z.string(),
  /** Depois disso o token não conta mais (2 h). */
  tokenExpiresAt: z.iso.datetime(),
});
export type AdDelivery = z.infer<typeof adDeliverySchema>;

export const adDeliveryListSchema = z.object({ items: z.array(adDeliverySchema) });
export type AdDeliveryList = z.infer<typeof adDeliveryListSchema>;

/** Link do WhatsApp com a mensagem pronta. */
export function whatsappLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Eventos (RF-ADS-08, RN-ADS-03, RN-ADS-04)

export const AD_EVENT_TYPES = ['IMPRESSION', 'CLICK'] as const;
export const adEventTypeSchema = z.enum(AD_EVENT_TYPES);
export type AdEventType = z.infer<typeof adEventTypeSchema>;

/** Eventos por envio. */
export const AD_EVENTS_MAX_BATCH = 50;

/** POST /v1/ads/events: lote de impressões e cliques, cada um com o token da entrega. */
export const adEventsInputSchema = z
  .object({
    events: z
      .array(z.object({ token: z.string().min(1).max(1000), type: adEventTypeSchema }).strict())
      .min(1)
      .max(AD_EVENTS_MAX_BATCH),
  })
  .strict();
export type AdEventsInput = z.infer<typeof adEventsInputSchema>;

export const adEventsResultSchema = z.object({
  /** Eventos contados agora; token inválido, vencido ou repetido não conta (sem erro). */
  accepted: z.number().int(),
});
export type AdEventsResult = z.infer<typeof adEventsResultSchema>;

// ---------------------------------------------------------------------------
// Espaços recentes (RF-SPACE-12)

/** Até 10 espaços, do mais recente para o mais antigo. */
export const RECENT_SPACES_LIMIT = 10;

export const recentSpaceListSchema = z.object({ items: z.array(spaceCardSchema) });
export type RecentSpaceList = z.infer<typeof recentSpaceListSchema>;

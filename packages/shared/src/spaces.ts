import { z } from 'zod';
import { spaceStatusSchema } from './auth';
import { centsSchema } from './money';
import {
  bookingPaymentModeSchema,
  classPaymentModeSchema,
  paymentEnvironmentSchema,
  paymentOptionSchema,
} from './online-payments';

// Espaços, quadras, configurações e busca (RF-SPACE-01..04, 08, 09; RN-SPACE-01).

/** Formas de pagamento aceitas no local (sem gateway: o pagamento é feito no espaço). */
export const PAYMENT_METHODS = ['PIX', 'CARD', 'CASH', 'OTHER'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const COURT_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
export const courtStatusSchema = z.enum(COURT_STATUSES);
export type CourtStatus = z.infer<typeof courtStatusSchema>;

export const ATTENDANCE_MODES = ['AUTOMATIC', 'MANUAL'] as const;
export const attendanceModeSchema = z.enum(ATTENDANCE_MODES);
export type AttendanceMode = z.infer<typeof attendanceModeSchema>;

/** Serviços do espaço (abas da página do espaço, RF-SPACE-08; filtro da busca, RF-SPACE-06). */
export const SPACE_SERVICES = ['RENTAL', 'CLASSES', 'TOURNAMENTS'] as const;
export const spaceServiceSchema = z.enum(SPACE_SERVICES);
export type SpaceService = z.infer<typeof spaceServiceSchema>;

/** Decisão 18 (docs/07): até 20 jogadores por quadra. */
export const MAX_PLAYERS_PER_COURT = 20;
/**
 * Capacidade da quadra para um esporte (decisão 51): o padrão do esporte, dentro do limite da
 * decisão 18. Esporte sem padrão usa o limite.
 */
export function courtCapacity(defaultMaxPlayers: number | null): number {
  return Math.min(defaultMaxPlayers ?? MAX_PLAYERS_PER_COURT, MAX_PLAYERS_PER_COURT);
}
/** Decisão 13 (docs/07): fração de hora de 30 minutos. */
export const BOOKING_STEP_MIN = 30;

const id = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const positiveMinutes = z.number().int().min(0);

// ---------------------------------------------------------------------------
// Catálogo

export const sportSchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  defaultMaxPlayers: z.number().int().nullable(),
});
export type Sport = z.infer<typeof sportSchema>;

export const amenitySchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
export type Amenity = z.infer<typeof amenitySchema>;

export const citySchema = z.object({
  id,
  name: z.string(),
  state: z.string(),
});
export type City = z.infer<typeof citySchema>;

// ---------------------------------------------------------------------------
// Configurações do espaço (docs/02 seção 2.1)

/** Padrões da seção 2.1 de docs/02 para o que o espaço ainda não configurou. */
export const SPACE_SETTINGS_DEFAULTS: Readonly<Omit<SpaceSettings, 'pricePerHourCents'>> = {
  bookingMinDurationMin: 60,
  bookingMaxDurationMin: 180,
  bookingMinAdvanceMin: 60,
  bookingWindowDays: 30,
  cancellationDeadlineMin: 60,
  attendanceMode: 'AUTOMATIC',
  attendanceOpenBeforeMin: 1440,
  attendanceCloseBeforeMin: 60,
  attendanceCancelDeadlineMin: 120,
  pastDueBlockEnabled: true,
  pastDueBlockDays: 7,
  acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
};

const durationMin = z
  .number()
  .int()
  .min(BOOKING_STEP_MIN)
  .max(24 * 60)
  .refine((value) => value % BOOKING_STEP_MIN === 0, {
    message: `Use múltiplos de ${BOOKING_STEP_MIN} minutos.`,
  });

const settingsFields = {
  /** Preço por hora do aluguel. Nulo = não configurado (o espaço não aparece na vitrine). */
  pricePerHourCents: centsSchema.nullable(),
  bookingMinDurationMin: durationMin,
  bookingMaxDurationMin: durationMin,
  bookingMinAdvanceMin: positiveMinutes.max(30 * 24 * 60),
  bookingWindowDays: z.number().int().min(1).max(365),
  cancellationDeadlineMin: positiveMinutes.max(30 * 24 * 60),
  attendanceMode: attendanceModeSchema,
  attendanceOpenBeforeMin: positiveMinutes.max(30 * 24 * 60),
  attendanceCloseBeforeMin: positiveMinutes.max(30 * 24 * 60),
  attendanceCancelDeadlineMin: positiveMinutes.max(30 * 24 * 60),
  /**
   * RN-CLASS-06: mensalidade de aula em atraso há mais de `pastDueBlockDays` dias bloqueia a
   * confirmação de presença. `false` desliga a regra (o número fica guardado).
   */
  pastDueBlockEnabled: z.boolean(),
  pastDueBlockDays: z.number().int().min(1).max(365),
  acceptedPaymentMethods: z
    .array(paymentMethodSchema)
    .min(1)
    .refine((list) => new Set(list).size === list.length, {
      message: 'Forma de pagamento repetida.',
    }),
};

/** Regras entre campos das configurações. */
function refineSettings(
  value: Pick<
    SpaceSettings,
    | 'bookingMinDurationMin'
    | 'bookingMaxDurationMin'
    | 'attendanceOpenBeforeMin'
    | 'attendanceCloseBeforeMin'
  >,
  ctx: z.RefinementCtx,
) {
  if (value.bookingMinDurationMin > value.bookingMaxDurationMin) {
    ctx.addIssue({
      code: 'custom',
      path: ['bookingMaxDurationMin'],
      message: 'A duração máxima não pode ser menor que a mínima.',
    });
  }
  if (value.attendanceCloseBeforeMin >= value.attendanceOpenBeforeMin) {
    ctx.addIssue({
      code: 'custom',
      path: ['attendanceCloseBeforeMin'],
      message: 'A lista precisa fechar depois de abrir (fechamento menor que a abertura).',
    });
  }
}

/** Configurações efetivas do espaço (valores salvos ou os padrões de docs/02 seção 2.1). */
export const spaceSettingsSchema = z.object(settingsFields).superRefine(refineSettings);
export type SpaceSettings = z.infer<typeof spaceSettingsSchema>;

/**
 * PATCH das configurações: só os campos enviados mudam; o resultado (salvo + padrões + patch) é
 * validado inteiro, com as regras entre campos (mínimo ≤ máximo etc.).
 */
export const updateSpaceSettingsSchema = z
  .object({
    ...settingsFields,
    pricePerHourCents: centsSchema,
  })
  .partial()
  .strict();
export type UpdateSpaceSettings = z.infer<typeof updateSpaceSettingsSchema>;

// ---------------------------------------------------------------------------
// Dados do espaço

/** Telefone em E.164 (ex.: +5531999998888). */
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'Use o formato +5531999998888.');
/** Usuário do Instagram, sem o @. */
export const instagramSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'Usuário do Instagram inválido.'));

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPointDto = z.infer<typeof geoPointSchema>;

export const addressSchema = z.object({
  street: z.string().nullable(),
  number: z.string().nullable(),
  neighborhood: z.string().nullable(),
  /** CEP só com dígitos (8). */
  postalCode: z.string().nullable(),
  city: citySchema,
});

export const addressInputSchema = z.object({
  street: trimmed(200),
  number: trimmed(20),
  neighborhood: trimmed(100),
  /** Aceita com ou sem hífen; é salvo só com dígitos. */
  postalCode: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().regex(/^[0-9]{8}$/, 'CEP inválido.')),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

/**
 * PATCH dos dados do espaço pelo painel (Dono/Admin). Nome, slug e status do espaço são do
 * Super (RF-SUPER-02/03/04); `null` limpa o campo opcional. Mudar o endereço refaz a
 * geocodificação, a menos que `location` venha junto (ajuste manual do pino).
 */
export const updateSpaceSchema = z
  .object({
    description: z.string().trim().max(2000).nullable(),
    cityId: id,
    address: addressInputSchema.nullable(),
    location: geoPointSchema.nullable(),
    phone: phoneE164Schema.nullable(),
    whatsapp: phoneE164Schema.nullable(),
    instagram: instagramSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateSpace = z.infer<typeof updateSpaceSchema>;

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM (00:00 a 23:59).');

export const openingHourSchema = z.object({
  /** 0 = domingo … 6 = sábado. */
  weekday: z.number().int().min(0).max(6),
  opensAt: hhmm,
  /** Igual ou anterior a `opensAt` = passa da meia-noite (igual = 24h). */
  closesAt: hhmm,
});
export type OpeningHour = z.infer<typeof openingHourSchema>;

const toMinutes = (value: string) => {
  const [h = 0, m = 0] = value.split(':').map(Number);
  return h * 60 + m;
};

/** Substitui o horário de funcionamento. Intervalos do mesmo dia não podem se sobrepor. */
export const replaceOpeningHoursSchema = z
  .object({ openingHours: z.array(openingHourSchema).max(7 * 4) })
  .strict()
  .superRefine(({ openingHours }, ctx) => {
    // Semana em minutos (domingo 00:00 = 0); o intervalo que passa da meia-noite invade o dia seguinte.
    const week = 7 * 1440;
    const ranges = openingHours.map((h, index) => {
      const start = h.weekday * 1440 + toMinutes(h.opensAt);
      const length = (toMinutes(h.closesAt) - toMinutes(h.opensAt) + 1440) % 1440 || 1440;
      return { index, start, end: start + length };
    });
    for (const a of ranges) {
      for (const b of ranges) {
        if (b.index <= a.index) continue;
        const overlaps = [0, week, -week].some(
          (shift) => a.start < b.end + shift && b.start + shift < a.end,
        );
        if (overlaps) {
          ctx.addIssue({
            code: 'custom',
            path: ['openingHours', b.index],
            message: 'Intervalo sobreposto a outro horário de funcionamento.',
          });
        }
      }
    }
  });
export type ReplaceOpeningHours = z.infer<typeof replaceOpeningHoursSchema>;

export const replaceAmenitiesSchema = z.object({ amenityIds: z.array(id).max(100) }).strict();
export type ReplaceAmenities = z.infer<typeof replaceAmenitiesSchema>;

// ---------------------------------------------------------------------------
// Fotos (upload pré-assinado no R2)

export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** 10 MB por foto. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Fotos por espaço (capa + galeria). */
export const MAX_PHOTOS_PER_SPACE = 20;

export const createPhotoUploadSchema = z
  .object({
    contentType: z.enum(PHOTO_CONTENT_TYPES),
    /** Tamanho do arquivo em bytes. */
    size: z.number().int().min(1).max(PHOTO_MAX_BYTES),
  })
  .strict();
export type CreatePhotoUpload = z.infer<typeof createPhotoUploadSchema>;

export const photoUploadSchema = z.object({
  /** URL para enviar o arquivo com `PUT` e o header `Content-Type` igual ao pedido. */
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  /** Chave do objeto; envie em `POST .../photos` depois do upload. */
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type PhotoUpload = z.infer<typeof photoUploadSchema>;

export const createPhotoSchema = z
  .object({
    key: z.string().min(1).max(300),
    blurhash: z.string().min(6).max(100).nullable().optional(),
  })
  .strict();
export type CreatePhoto = z.infer<typeof createPhotoSchema>;

/** Nova ordem da galeria: todos os ids das fotos do espaço; o primeiro vira a capa. */
export const reorderPhotosSchema = z
  .object({ photoIds: z.array(id).min(1).max(MAX_PHOTOS_PER_SPACE) })
  .strict();
export type ReorderPhotos = z.infer<typeof reorderPhotosSchema>;

export const photoSchema = z.object({
  id,
  url: z.string(),
  blurhash: z.string().nullable(),
  /** 0 = capa. */
  position: z.number().int(),
});
export type Photo = z.infer<typeof photoSchema>;

// ---------------------------------------------------------------------------
// Logo do espaço (RF-SPACE-11, decisão 44): imagem quadrada, separada da galeria

export const LOGO_CONTENT_TYPES = PHOTO_CONTENT_TYPES;
/** 2 MB por logo (o app e o web exibem em tamanho pequeno). */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Pedido da URL de upload da logo; a imagem precisa ser quadrada (largura = altura). */
export const createLogoUploadSchema = z
  .object({
    contentType: z.enum(LOGO_CONTENT_TYPES),
    /** Tamanho do arquivo em bytes. */
    size: z.number().int().min(1).max(LOGO_MAX_BYTES),
  })
  .strict();
export type CreateLogoUpload = z.infer<typeof createLogoUploadSchema>;

/** Mesmo formato da URL de upload das fotos. */
export const logoUploadSchema = photoUploadSchema.extend({
  /** Chave do objeto; envie em `PUT .../logo` depois do upload. */
  key: z.string(),
});
export type LogoUpload = z.infer<typeof logoUploadSchema>;

export const setLogoSchema = z.object({ key: z.string().min(1).max(300) }).strict();
export type SetLogo = z.infer<typeof setLogoSchema>;

/** URL pública da logo; nula = sem logo (as telas mostram as iniciais do nome). */
export const logoUrlSchema = z.string().nullable();

// ---------------------------------------------------------------------------
// Quadras

/** Só os esportes: a capacidade vem do padrão de cada um (decisão 51). */
const courtSportIdsInput = z
  .array(id)
  .min(1)
  .max(20)
  .refine((list) => new Set(list).size === list.length, {
    message: 'Esporte repetido na quadra.',
  });

export const createCourtSchema = z
  .object({
    name: trimmed(60),
    covered: z.boolean().default(false),
    status: courtStatusSchema.default('ACTIVE'),
    sportIds: courtSportIdsInput,
  })
  .strict();
export type CreateCourt = z.infer<typeof createCourtSchema>;

/** PATCH da quadra; `sportIds` substitui a lista inteira. */
export const updateCourtSchema = z
  .object({
    name: trimmed(60),
    covered: z.boolean(),
    status: courtStatusSchema,
    sportIds: courtSportIdsInput,
  })
  .partial()
  .strict();
export type UpdateCourt = z.infer<typeof updateCourtSchema>;

export const courtSportSchema = z.object({
  sportId: id,
  slug: z.string(),
  name: z.string(),
  maxPlayers: z.number().int(),
});

export const courtSchema = z.object({
  id,
  name: z.string(),
  covered: z.boolean(),
  status: courtStatusSchema,
  sports: z.array(courtSportSchema),
});
export type Court = z.infer<typeof courtSchema>;

export const courtListSchema = z.object({ items: z.array(courtSchema) });

// ---------------------------------------------------------------------------
// Espaço no painel

/** O que falta para o espaço aparecer na vitrine (RN-SPACE-01). */
export const SHOWCASE_REQUIREMENTS = ['ACTIVE_STATUS', 'ACTIVE_COURT', 'PRICE_PER_HOUR'] as const;

export const managedSpaceSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: spaceStatusSchema,
  address: addressSchema,
  location: geoPointSchema.nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  instagram: z.string().nullable(),
  logoUrl: logoUrlSchema,
  photos: z.array(photoSchema),
  amenities: z.array(amenitySchema),
  openingHours: z.array(openingHourSchema),
  showcase: z.object({
    visible: z.boolean(),
    missing: z.array(z.enum(SHOWCASE_REQUIREMENTS)),
  }),
});
export type ManagedSpace = z.infer<typeof managedSpaceSchema>;

// ---------------------------------------------------------------------------
// Vitrine, busca e página pública

const sportRefSchema = z.object({ slug: z.string(), name: z.string() });

/**
 * Média e total das avaliações (decisão 102), lidos das colunas `rating_count`/`rating_sum` do
 * espaço, sem consulta extra.
 */
export const spaceRatingSchema = z.object({
  count: z.number().int().nonnegative(),
  /** Uma casa decimal; nula com menos de 5 avaliações (`REVIEW_SUMMARY_MIN_COUNT`): selo "Novo". */
  average: z.number().nullable(),
});
export type SpaceRating = z.infer<typeof spaceRatingSchema>;

/** Card da vitrine (RF-SPACE-05) e item da busca/mapa (RF-SPACE-06/07). */
export const spaceCardSchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  logoUrl: logoUrlSchema,
  neighborhood: z.string().nullable(),
  city: z.string(),
  location: geoPointSchema.nullable(),
  /** Distância em metros até o ponto da busca (nula sem `lat`/`lng`). */
  distanceMeters: z.number().nullable(),
  cover: photoSchema.omit({ id: true, position: true }).nullable(),
  sports: z.array(sportRefSchema),
  pricePerHourCents: centsSchema,
  services: z.array(spaceServiceSchema),
  rating: spaceRatingSchema,
});
export type SpaceCard = z.infer<typeof spaceCardSchema>;

export const spaceSearchResultSchema = z.object({
  items: z.array(spaceCardSchema),
  /** Passe em `cursor` para a próxima página; nulo na última. */
  nextCursor: z.string().nullable(),
});
export type SpaceSearchResult = z.infer<typeof spaceSearchResultSchema>;

export const favoriteListSchema = z.object({ items: z.array(spaceCardSchema) });

/** Raio padrão da busca geográfica (km). */
export const SEARCH_DEFAULT_RADIUS_KM = 20;
export const SEARCH_MAX_RADIUS_KM = 200;

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(60)).max(20));

/**
 * Ordens da busca (decisão 109). `distance` (padrão): pela distância com `lat`/`lng`, pelo nome
 * sem eles. `rating` ("Melhor avaliados"): primeiro os espaços com a nota pública, pela média
 * como o card mostra (uma casa, `reviewAverage`) e depois pelo total, decrescentes; em seguida os
 * "Novo"; desempate pela distância (ou pelo nome) e pelo id.
 */
export const SPACE_SEARCH_SORTS = ['distance', 'rating'] as const;
export const spaceSearchSortSchema = z.enum(SPACE_SEARCH_SORTS);
export type SpaceSearchSort = z.infer<typeof spaceSearchSortSchema>;

/**
 * Query de GET /v1/spaces. Com `lat`/`lng`, filtra pelo raio e ordena pela distância; sem eles,
 * ordena pelo nome (RN-SPACE-02: o app manda o centro de BH quando não tem a localização).
 * `minRating` e `sort=rating` (decisão 109) só usam a nota pública (RF-REVIEW-03).
 */
export const spaceSearchQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(SEARCH_MAX_RADIUS_KM).optional(),
    /** Slug do esporte. */
    sport: z.string().max(60).optional(),
    service: spaceServiceSchema.optional(),
    /** Slugs separados por vírgula; o espaço precisa ter todos. */
    amenities: csv.optional(),
    /** Parte do nome do espaço. */
    q: z.string().trim().min(1).max(100).optional(),
    // Notas de 1 a 5 (REVIEW_RATING_MIN..MAX de `reviews.ts`, que não dá para importar aqui:
    // `reviews` → `booking` → `spaces` fecharia um ciclo).
    minRating: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        'Nota mínima (1 a 5; o app manda 4). Só entram espaços com a nota pública (5 ou mais avaliações) e a média como o card mostra (`rating.average`, uma casa, meio para cima) maior ou igual a ela: "★ 4,0" (média 3,95) entra no 4. Os "Novo" ficam de fora.',
      ),
    sort: spaceSearchSortSchema
      .default('distance')
      .describe(
        '`distance` (padrão): pela distância com `lat`/`lng`, pelo nome sem eles. `rating`: primeiro os espaços com a nota pública, pela média como o card mostra (`rating.average`) e depois por total (decrescentes), em seguida os "Novo"; desempate pela distância (ou pelo nome) e pelo id. O cursor só vale na ordem em que foi gerado.',
      ),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: 'Envie lat e lng juntos.',
    path: ['lng'],
  })
  .refine((query) => query.radiusKm === undefined || query.lat !== undefined, {
    message: 'radiusKm exige lat e lng.',
    path: ['radiusKm'],
  });
export type SpaceSearchQuery = z.infer<typeof spaceSearchQuerySchema>;

/** Página pública do espaço (RF-SPACE-08). */
export const publicSpaceSchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  address: addressSchema,
  location: geoPointSchema.nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  instagram: z.string().nullable(),
  logoUrl: logoUrlSchema,
  photos: z.array(photoSchema),
  amenities: z.array(amenitySchema),
  openingHours: z.array(openingHourSchema),
  acceptedPaymentMethods: z.array(paymentMethodSchema),
  sports: z.array(sportRefSchema),
  services: z.array(spaceServiceSchema),
  /** Só as quadras ativas. */
  courts: z.array(courtSchema.omit({ status: true })),
  rental: z.object({
    pricePerHourCents: centsSchema,
    minDurationMin: z.number().int(),
    maxDurationMin: z.number().int(),
    minAdvanceMin: z.number().int(),
    windowDays: z.number().int(),
    cancellationDeadlineMin: z.number().int(),
  }),
  /**
   * Pagamento online (RF-ONPAY-03, RF-ONPAY-05): o modo em vigor de cada serviço e as formas que
   * a etapa de pagamento oferece. Sem o gateway ligado ou sem cadastro aprovado, tudo `ON_SITE`.
   */
  onlinePayments: z.object({
    rental: z.object({ mode: bookingPaymentModeSchema, options: z.array(paymentOptionSchema) }),
    classes: z.object({ mode: classPaymentModeSchema, options: z.array(paymentOptionSchema) }),
  }),
  /**
   * Provedor e, com o fake, o selo "Ambiente de teste" e os cartões de teste que a etapa de
   * pagamento mostra, vindos do adaptador (decisão 92).
   */
  paymentEnvironment: paymentEnvironmentSchema,
  /** Avaliações (RF-REVIEW-03): o resumo completo fica em `GET /v1/spaces/:spaceId/reviews/summary`. */
  rating: spaceRatingSchema,
});
export type PublicSpace = z.infer<typeof publicSpaceSchema>;

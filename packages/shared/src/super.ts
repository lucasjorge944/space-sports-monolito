import { z } from 'zod';
import { platformRoleSchema, spaceRoleSchema, spaceStatusSchema, userStatusSchema } from './auth';
import { centsSchema } from './money';
import { paymentChannelSchema } from './online-payments';
import { sportLevelSchema } from './profile';
import {
  amenitySchema,
  citySchema,
  geoPointSchema,
  managedSpaceSchema,
  paymentMethodSchema,
  spaceRatingSchema,
  spaceServiceSchema,
  sportSchema,
  updateSpaceSchema,
} from './spaces';

// Painel Super (RF-SUPER-01..10; RN-AUTH-02; RN-SUPER-01).

const id = z.uuid();
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();

// ---------------------------------------------------------------------------
// Paginação por página (tabelas do painel; o log de auditoria usa cursor)

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

// ---------------------------------------------------------------------------
// Espaços (RF-SUPER-01..04)

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(60)).max(20));

/** Filtros de GET /v1/super/spaces. */
export const superSpacesQuerySchema = pageQuerySchema.extend({
  /** Parte do nome ou do slug. */
  q: z.string().trim().min(1).max(100).optional(),
  status: spaceStatusSchema.optional(),
  cityId: id.optional(),
  /** Slugs de esporte separados por vírgula; o espaço precisa ter quadra com algum deles. */
  sports: csv.optional(),
});
export type SuperSpacesQuery = z.infer<typeof superSpacesQuerySchema>;

/** Itens do checklist de implantação (RF-SUPER-02). Turmas e planos entram com a Fase 2. */
export const ONBOARDING_ITEMS = ['DATA', 'PHOTOS', 'COURTS', 'PRICE', 'TEAM'] as const;
export const onboardingItemKeySchema = z.enum(ONBOARDING_ITEMS);

export const onboardingChecklistSchema = z.object({
  items: z.array(
    z.object({
      key: onboardingItemKeySchema,
      done: z.boolean(),
      /** O que falta neste item (vazio quando concluído). */
      missing: z.array(z.string()),
    }),
  ),
  doneCount: z.number().int(),
  total: z.number().int(),
  completed: z.boolean(),
});
export type OnboardingChecklist = z.infer<typeof onboardingChecklistSchema>;

const ownerSchema = z.object({ id, name: z.string(), email: z.string().nullable() });

export const superSpaceListItemSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  status: spaceStatusSchema,
  /** Logo do espaço (RF-SPACE-11); nula = iniciais do nome. */
  logoUrl: z.string().nullable(),
  city: citySchema,
  neighborhood: z.string().nullable(),
  sports: z.array(z.object({ slug: z.string(), name: z.string() })),
  courtsCount: z.number().int(),
  owners: z.array(ownerSchema),
  /** Aparece na vitrine (RN-SPACE-01). */
  showcaseVisible: z.boolean(),
  onboarding: z.object({ doneCount: z.number().int(), total: z.number().int() }),
  createdAt: z.iso.datetime(),
});
export type SuperSpaceListItem = z.infer<typeof superSpaceListItemSchema>;

export const superSpaceListSchema = pageOf(superSpaceListItemSchema);

export const superSpaceSchema = managedSpaceSchema.extend({
  createdAt: z.iso.datetime(),
  courtsCount: z.number().int(),
  owners: z.array(ownerSchema),
  checklist: onboardingChecklistSchema,
  /**
   * Total e média das avaliações que contam (RN-REVIEW-03), como no card da vitrine: média nula
   * com menos de 5. O resumo completo, com as fora da média, é `superGetSpaceReviewSummary`.
   */
  rating: spaceRatingSchema,
});
export type SuperSpace = z.infer<typeof superSpaceSchema>;

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.');

/** Resultado do convite do Dono (a 1.4 troca a implementação por convite por token). */
export const OWNER_INVITE_STATUSES = [
  'LINKED',
  'INVITED',
  'AWAITING_SIGNUP',
  'AWAITING_VERIFICATION',
] as const;
export const ownerInviteResultSchema = z.object({
  email: z.string(),
  status: z.enum(OWNER_INVITE_STATUSES),
});
export type OwnerInviteResult = z.infer<typeof ownerInviteResultSchema>;

/** Criar espaço (já nasce ACTIVE, RN-SPACE-01), com o convite opcional do Dono. */
export const createSuperSpaceSchema = z
  .object({
    name: trimmed(120),
    /** Sem slug, é gerado a partir do nome. */
    slug: slugSchema.optional(),
    cityId: id,
    description: updateSpaceSchema.shape.description,
    address: updateSpaceSchema.shape.address,
    location: geoPointSchema.nullable().optional(),
    phone: updateSpaceSchema.shape.phone,
    whatsapp: updateSpaceSchema.shape.whatsapp,
    instagram: updateSpaceSchema.shape.instagram,
    ownerEmail: z.email().optional(),
  })
  .strict();
export type CreateSuperSpace = z.infer<typeof createSuperSpaceSchema>;

export const createdSuperSpaceSchema = z.object({
  space: superSpaceSchema,
  ownerInvite: ownerInviteResultSchema.nullable(),
});

/** Editar qualquer dado do espaço: os campos do painel mais nome e slug. */
export const updateSuperSpaceSchema = z
  .object({ ...updateSpaceSchema.shape, name: trimmed(120), slug: slugSchema })
  .partial()
  .strict();
export type UpdateSuperSpace = z.infer<typeof updateSuperSpaceSchema>;

export const inviteOwnerSchema = z.object({ email: z.email() }).strict();
export type InviteOwner = z.infer<typeof inviteOwnerSchema>;

/** Suspender, reativar ou encerrar: o motivo vai para o log de auditoria. */
export const spaceStatusChangeSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();
export type SpaceStatusChange = z.infer<typeof spaceStatusChangeSchema>;

// ---------------------------------------------------------------------------
// Modo suporte (RF-SUPER-04, RN-SUPER-01)

/** Header que ativa o modo suporte nas rotas do painel (`/v1/manage/spaces/:spaceId/...`). */
export const SUPPORT_SESSION_HEADER = 'x-support-session';
/** Header de resposta que sinaliza que a requisição rodou em modo suporte. */
export const SUPPORT_MODE_HEADER = 'x-support-mode';
export const SUPPORT_SESSION_TTL_MIN = 120;

export const startSupportSessionSchema = z.object({ reason: trimmed(500) }).strict();
export type StartSupportSession = z.infer<typeof startSupportSessionSchema>;

export const supportSessionSchema = z.object({
  id,
  spaceId: id,
  spaceName: z.string(),
  superUserId: id,
  superUserName: z.string(),
  reason: z.string(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  active: z.boolean(),
});
export type SupportSession = z.infer<typeof supportSessionSchema>;

export const supportSessionQuerySchema = z.object({
  spaceId: id.optional(),
  /** `true`: só as ativas (não encerradas nem expiradas). */
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SupportSessionQuery = z.infer<typeof supportSessionQuerySchema>;

export const supportSessionListSchema = z.object({ items: z.array(supportSessionSchema) });

// ---------------------------------------------------------------------------
// Financeiro consolidado, só leitura sobre payment_records (RF-SUPER-05)

export const financeQuerySchema = z
  .object({
    /** Data local (America/Sao_Paulo), inclusive. Padrão: dia 1 do mês atual. */
    from: isoDate.optional(),
    /** Data local (America/Sao_Paulo), inclusive. Padrão: hoje. */
    to: isoDate.optional(),
    spaceId: id.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` deve ser anterior ou igual a `to`.',
    path: ['to'],
  });
export type FinanceQuery = z.infer<typeof financeQuerySchema>;

const receivedSchema = z.object({
  receivedCents: centsSchema,
  paymentsCount: z.number().int(),
});

export const financeSummarySchema = z.object({
  period: z.object({ from: isoDate, to: isoDate }),
  totals: receivedSchema.extend({ reversedCents: centsSchema }),
  bySpace: z.array(receivedSchema.extend({ spaceId: id, spaceName: z.string() })),
  byService: z.array(receivedSchema.extend({ service: spaceServiceSchema })),
  byMethod: z.array(receivedSchema.extend({ method: paymentMethodSchema })),
  /** No local (registrado pelo espaço) × online (pago pelo app, RF-ONPAY-04). */
  byChannel: z.array(receivedSchema.extend({ channel: paymentChannelSchema })),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

// ---------------------------------------------------------------------------
// Catálogos (RF-SUPER-06)

export const createSportSchema = z
  .object({
    slug: slugSchema,
    name: trimmed(80),
    icon: trimmed(60).nullable().optional(),
    defaultMaxPlayers: z.number().int().min(1).max(20).nullable().optional(),
  })
  .strict();
export type CreateSport = z.infer<typeof createSportSchema>;
export const updateSportSchema = createSportSchema.partial().strict();
export type UpdateSport = z.infer<typeof updateSportSchema>;

export const createAmenitySchema = z
  .object({ slug: slugSchema, name: trimmed(80), icon: trimmed(60).nullable().optional() })
  .strict();
export type CreateAmenity = z.infer<typeof createAmenitySchema>;
export const updateAmenitySchema = createAmenitySchema.partial().strict();
export type UpdateAmenity = z.infer<typeof updateAmenitySchema>;

const timezoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Fuso horário IANA inválido (ex.: America/Sao_Paulo).' },
);

export const createCitySchema = z
  .object({
    name: trimmed(120),
    /** UF com 2 letras maiúsculas. */
    state: z.string().regex(/^[A-Z]{2}$/, 'Use a UF com 2 letras maiúsculas.'),
    timezone: timezoneSchema.default('America/Sao_Paulo'),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateCity = z.infer<typeof createCitySchema>;
export const updateCitySchema = createCitySchema.partial().strict();
export type UpdateCity = z.infer<typeof updateCitySchema>;

export const superCitySchema = citySchema.extend({ timezone: z.string(), active: z.boolean() });
export type SuperCity = z.infer<typeof superCitySchema>;

export const superSportListSchema = z.object({ items: z.array(sportSchema) });
export const superAmenityListSchema = z.object({ items: z.array(amenitySchema) });
export const superCityListSchema = z.object({ items: z.array(superCitySchema) });

// Níveis do jogador (`SPORT_LEVELS`, `sportLevelSchema`): em profile.ts.
export const levelListSchema = z.object({
  items: z.array(z.object({ value: sportLevelSchema, label: z.string() })),
});

// ---------------------------------------------------------------------------
// Usuários (RF-SUPER-07) e usuários Super (RF-SUPER-08)

export const superUsersQuerySchema = pageQuerySchema.extend({
  /** Parte do nome, e-mail ou telefone. */
  q: z.string().trim().min(1).max(100).optional(),
  status: userStatusSchema.optional(),
  platformRole: platformRoleSchema.optional(),
});
export type SuperUsersQuery = z.infer<typeof superUsersQuerySchema>;

export const superUserListItemSchema = z.object({
  id,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Telefone confirmado por OTP; o do cadastro fica não verificado (decisão 64). */
  phoneVerified: z.boolean(),
  status: userStatusSchema,
  platformRole: platformRoleSchema,
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  spacesCount: z.number().int(),
});
export const superUserListSchema = pageOf(superUserListItemSchema);

/** `CANCELLED`: o titular desistiu pelo atendimento e a conta foi reativada (decisão 40). */
export const DELETION_REQUEST_STATUSES = ['PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export const deletionRequestStatusSchema = z.enum(DELETION_REQUEST_STATUSES);
/** `USER`: pedido do próprio titular (app ou página web); `SUPER`: registrado pela equipe. */
export const DELETION_REQUEST_SOURCES = ['USER', 'SUPER'] as const;
export const deletionRequestSourceSchema = z.enum(DELETION_REQUEST_SOURCES);

export const superUserSchema = superUserListItemSchema.extend({
  memberships: z.array(
    z.object({
      spaceId: id,
      spaceName: z.string(),
      spaceSlug: z.string(),
      spaceStatus: spaceStatusSchema,
      role: spaceRoleSchema,
      status: z.enum(['INVITED', 'ACTIVE', 'REMOVED']),
    }),
  ),
  activeSessions: z.number().int(),
  pendingDeletionRequestId: id.nullable(),
});
export type SuperUser = z.infer<typeof superUserSchema>;

export const blockUserSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();
export type BlockUser = z.infer<typeof blockUserSchema>;

export const superAdminSchema = z.object({
  id,
  name: z.string(),
  email: z.string().nullable(),
  status: userStatusSchema,
  createdAt: z.iso.datetime(),
});
export const superAdminListSchema = z.object({ items: z.array(superAdminSchema) });

/** Promover por e-mail: a conta precisa existir e ter o e-mail verificado. */
export const promoteSuperSchema = z.object({ email: z.email() }).strict();
export type PromoteSuper = z.infer<typeof promoteSuperSchema>;

export const deletionRequestsQuerySchema = pageQuerySchema.extend({
  status: deletionRequestStatusSchema.optional(),
});
export type DeletionRequestsQuery = z.infer<typeof deletionRequestsQuerySchema>;

/**
 * Pendências da conta num espaço (decisão 40): o que o atendimento cancela (reservas, ocorrências
 * de mensalista, mensalistas, assinaturas e confirmações de aula futuras) e o que fica em aberto
 * no espaço (mensalidades e reservas com saldo; os pagamentos ficam no histórico).
 */
export const deletionSpacePendingSchema = z.object({
  spaceId: id,
  spaceName: z.string(),
  /** Reservas avulsas futuras em que o titular é o organizador. */
  upcomingBookings: z.number().int(),
  /** Ocorrências futuras dos mensalistas do titular. */
  upcomingRecurringOccurrences: z.number().int(),
  /** Mensalistas em aberto (pendentes de aprovação, ativos ou pausados). */
  openRecurringBookings: z.number().int(),
  /** Assinaturas de aula em aberto (pendentes, ativas ou em atraso). */
  openSubscriptions: z.number().int(),
  /** Confirmações (e lugares na espera) em aulas que ainda não começaram. */
  upcomingClassAttendances: z.number().int(),
  /** Mensalidades (aulas e mensalista) pendentes ou vencidas, e o saldo delas. */
  openCharges: z.number().int(),
  openChargesCents: centsSchema,
  /** Saldo das reservas do titular (organizador) ainda não quitadas. */
  bookingsDueCents: centsSchema,
});
export type DeletionSpacePending = z.infer<typeof deletionSpacePendingSchema>;

export const deletionRequestSchema = z.object({
  id,
  userId: id,
  userName: z.string(),
  status: deletionRequestStatusSchema,
  source: deletionRequestSourceSchema,
  /** Motivo informado pelo titular (opcional). */
  reason: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  /** Prazo de resposta: pedido + `DELETION_REQUEST_RESPONSE_DAYS` dias. */
  dueAt: z.iso.datetime(),
  /** Pendente com o prazo vencido (a lista traz os pendentes primeiro, do mais antigo). */
  overdue: z.boolean(),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedBy: id.nullable(),
  /** Observação da equipe (no recusado, o motivo da recusa). */
  note: z.string().nullable(),
  /** Pendências por espaço, só nos pedidos pendentes (vazio quando não há nenhuma). */
  pending: z.array(deletionSpacePendingSchema).nullable(),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;
export const deletionRequestListSchema = pageOf(deletionRequestSchema);

export const createDeletionRequestSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .strict();
export type CreateDeletionRequest = z.infer<typeof createDeletionRequestSchema>;

export const resolveDeletionRequestSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .strict();
export const rejectDeletionRequestSchema = z.object({ note: trimmed(500) }).strict();
/** Desistência do titular pelo atendimento: o pedido é cancelado e a conta reativada. */
export const cancelDeletionRequestSchema = resolveDeletionRequestSchema;
export type ResolveDeletionRequest = z.infer<typeof resolveDeletionRequestSchema>;
export type RejectDeletionRequest = z.infer<typeof rejectDeletionRequestSchema>;
export type CancelDeletionRequest = z.infer<typeof cancelDeletionRequestSchema>;

// ---------------------------------------------------------------------------
// Métricas de uso por espaço (RF-SUPER-09)

export const superMetricsQuerySchema = pageQuerySchema.extend({
  /** Data local (America/Sao_Paulo), inclusive. Padrão: 30 dias até hoje. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type SuperMetricsQuery = z.infer<typeof superMetricsQuerySchema>;

export const spaceMetricsSchema = z.object({
  spaceId: id,
  name: z.string(),
  slug: z.string(),
  status: spaceStatusSchema,
  /** Reservas no período (início dentro do período), sem as canceladas. */
  bookings: z.number().int(),
  /** Mensalistas ACTIVE hoje. */
  activeRecurring: z.number().int(),
  /** Módulos da Fase 2: 0 até existirem. */
  activeStudents: z.number().int(),
  attendances: z.number().int(),
  tournaments: z.number().int(),
  /** Última atividade da equipe (sessão mais recente de um membro ativo). */
  lastAccessAt: z.iso.datetime().nullable(),
});
export const superMetricsSchema = pageOf(spaceMetricsSchema).extend({
  period: z.object({ from: isoDate, to: isoDate }),
});
export type SuperMetrics = z.infer<typeof superMetricsSchema>;

// ---------------------------------------------------------------------------
// Log de auditoria global (RF-SUPER-10)

export const auditLogQuerySchema = z
  .object({
    actorId: id.optional(),
    spaceId: id.optional(),
    entity: z.string().trim().min(1).max(60).optional(),
    /** Prefixo da ação, ex.: `support.` ou `payment.reverse`. */
    action: z.string().trim().min(1).max(80).optional(),
    actingAsSuper: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    /** Datas locais (America/Sao_Paulo), inclusivas. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` deve ser anterior ou igual a `to`.',
    path: ['to'],
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id,
  actorId: id.nullable(),
  actorName: z.string().nullable(),
  actingAsSuper: z.boolean(),
  spaceId: id.nullable(),
  spaceName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: id.nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogPageSchema = z.object({
  items: z.array(auditLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

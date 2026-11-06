import { z } from 'zod';
import { pageFields } from './booking';
import type { SpaceRating } from './spaces';

// Avaliações de espaços (RF-REVIEW-01 a 09, RN-REVIEW-01 a 07; decisões 99 a 106).

const id = z.uuid();
const datetime = z.iso.datetime();

/** Nota de 1 a 5 estrelas (obrigatória, decisão 100). */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
/** Chips de destaque por avaliação (decisão 100). */
export const REVIEW_MAX_TAGS = 5;
export const REVIEW_COMMENT_MAX_LENGTH = 500;
/** Resposta pública do espaço (decisão 104). */
export const REVIEW_REPLY_MAX_LENGTH = 500;
/** Texto livre da denúncia e do motivo da moderação. */
export const REVIEW_REPORT_DETAILS_MAX_LENGTH = 500;
export const REVIEW_MODERATION_REASON_MAX_LENGTH = 500;
/** RN-REVIEW-03: média e distribuição aparecem a partir de 5 avaliações; abaixo, selo "Novo". */
export const REVIEW_SUMMARY_MIN_COUNT = 5;
/** RN-REVIEW-01: o uso que dá direito a avaliar precisa ter terminado nos últimos 6 meses. */
export const REVIEW_ELIGIBILITY_MONTHS = 6;
/** Chips mais citados no resumo (RF-REVIEW-03). */
export const REVIEW_TOP_TAGS = 3;
/** Chips mais citados por grupo (elogios e críticas) no painel e no Super (RF-REVIEW-06 e 07). */
export const REVIEW_HIGHLIGHTS_PER_GROUP = 5;
/** Comentários recentes no resumo (RF-REVIEW-03). */
export const REVIEW_RECENT_COMMENTS = 3;
/** Autor depois da exclusão da conta (decisão 105). */
export const REVIEW_REMOVED_AUTHOR_NAME = 'Usuário removido';

// ---------------------------------------------------------------------------------------------
// Chips de destaque (decisão 100)

/**
 * Catálogo fixo (AV.1, docs/05 "Avaliações"): 8 pares positivo/negativo do mesmo assunto, na
 * ordem da tela. Positivos só com nota 4–5; negativos só com 1–3. O enum `review_tag` do banco
 * tem a ordem de `REVIEW_TAGS` (os pares intercalados), que desempata os "mais citados".
 */
export const REVIEW_TAG_PAIRS = [
  ['GOOD_COURT', 'BAD_COURT'],
  ['GOOD_SERVICE', 'BAD_SERVICE'],
  ['CLEAN', 'DIRTY'],
  ['GOOD_VALUE', 'EXPENSIVE'],
  ['EASY_BOOKING', 'HARD_BOOKING'],
  ['GOOD_LIGHTING', 'BAD_LIGHTING'],
  ['ON_TIME', 'DELAYS'],
  ['GOOD_FACILITIES', 'POOR_FACILITIES'],
] as const;
export const REVIEW_POSITIVE_TAGS = [
  'GOOD_COURT',
  'GOOD_SERVICE',
  'CLEAN',
  'GOOD_VALUE',
  'EASY_BOOKING',
  'GOOD_LIGHTING',
  'ON_TIME',
  'GOOD_FACILITIES',
] as const;
export const REVIEW_NEGATIVE_TAGS = [
  'BAD_COURT',
  'BAD_SERVICE',
  'DIRTY',
  'EXPENSIVE',
  'HARD_BOOKING',
  'BAD_LIGHTING',
  'DELAYS',
  'POOR_FACILITIES',
] as const;
export const REVIEW_TAGS = [
  'GOOD_COURT',
  'BAD_COURT',
  'GOOD_SERVICE',
  'BAD_SERVICE',
  'CLEAN',
  'DIRTY',
  'GOOD_VALUE',
  'EXPENSIVE',
  'EASY_BOOKING',
  'HARD_BOOKING',
  'GOOD_LIGHTING',
  'BAD_LIGHTING',
  'ON_TIME',
  'DELAYS',
  'GOOD_FACILITIES',
  'POOR_FACILITIES',
] as const;
export const reviewTagSchema = z.enum(REVIEW_TAGS);
export type ReviewTag = z.infer<typeof reviewTagSchema>;

/** Rótulo de cada chip (pt-BR, até 20 caracteres), o mesmo no app e no web. */
export const REVIEW_TAG_LABELS: Readonly<Record<ReviewTag, string>> = {
  GOOD_COURT: 'Quadra boa',
  BAD_COURT: 'Quadra ruim',
  GOOD_SERVICE: 'Bom atendimento',
  BAD_SERVICE: 'Atendimento ruim',
  CLEAN: 'Limpo',
  DIRTY: 'Sujo',
  GOOD_VALUE: 'Bom custo-benefício',
  EXPENSIVE: 'Caro',
  EASY_BOOKING: 'Fácil de reservar',
  HARD_BOOKING: 'Difícil de reservar',
  GOOD_LIGHTING: 'Boa iluminação',
  BAD_LIGHTING: 'Iluminação ruim',
  ON_TIME: 'Horário respeitado',
  DELAYS: 'Atraso no horário',
  GOOD_FACILITIES: 'Boa estrutura',
  POOR_FACILITIES: 'Estrutura ruim',
};

/** Rótulo de cada nota na tela de avaliar (AV.1). */
export const REVIEW_RATING_LABELS: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  1: 'Péssimo',
  2: 'Ruim',
  3: 'Regular',
  4: 'Bom',
  5: 'Excelente',
};

const POSITIVE = new Set<ReviewTag>(REVIEW_POSITIVE_TAGS);

/** O chip é de destaque positivo? */
export const isPositiveReviewTag = (tag: ReviewTag): boolean => POSITIVE.has(tag);

/** Chips que a nota permite: positivos com 4–5, negativos com 1–3. */
export function reviewTagsForRating(rating: number): readonly ReviewTag[] {
  return rating >= 4 ? REVIEW_POSITIVE_TAGS : REVIEW_NEGATIVE_TAGS;
}

/** Todos os chips combinam com a nota? (senão a API responde 400 `REVIEW_TAGS_MISMATCH`) */
export function reviewTagsMatchRating(rating: number, tags: readonly ReviewTag[]): boolean {
  const allowed = reviewTagsForRating(rating);
  return tags.every((tag) => allowed.includes(tag));
}

// ---------------------------------------------------------------------------------------------
// Média e autor

/**
 * Média com uma casa decimal (arredondada para cima no meio), só com `count` ≥
 * `REVIEW_SUMMARY_MIN_COUNT` (RN-REVIEW-03); abaixo disso, `null` ("Novo"). Com `minCount = 1`,
 * a média de qualquer quantidade (o painel do espaço). A busca filtra e ordena por esta mesma
 * média, calculada no banco (`displayedAverageTenths` na API, decisão 109): mudou o
 * arredondamento aqui, mude lá também.
 */
export function reviewAverage(
  sum: number,
  count: number,
  minCount: number = REVIEW_SUMMARY_MIN_COUNT,
): number | null {
  if (count <= 0 || count < minCount) return null;
  return Math.round((sum * 10) / count) / 10;
}

/** `4.8` → `"4,8"`; `5` → `"5,0"`. */
export function formatReviewAverage(average: number): string {
  return average.toFixed(1).replace('.', ',');
}

const capitalize = (word: string) =>
  word ? word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1) : word;

/**
 * Autor na lista pública (decisão 102): primeiro nome + inicial do último sobrenome
 * ("Ana Paula Souza" → "Ana S."). Nome de uma palavra fica inteiro; sem autor (conta excluída),
 * "Usuário removido".
 */
export function formatReviewAuthorName(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const [firstName, ...rest] = words;
  if (!firstName) return REVIEW_REMOVED_AUTHOR_NAME;
  const last = rest.at(-1);
  const initial = last ? ` ${last.charAt(0).toLocaleUpperCase('pt-BR')}.` : '';
  return `${capitalize(firstName)}${initial}`;
}

// ---------------------------------------------------------------------------------------------
// Entrada do jogador

/** "Jogou aqui" (reserva) ou "Aluno" (aula), conforme o uso mais recente (RN-REVIEW-01). */
export const REVIEW_AUTHOR_KINDS = ['PLAYER', 'STUDENT'] as const;
export const reviewAuthorKindSchema = z.enum(REVIEW_AUTHOR_KINDS);
export type ReviewAuthorKind = z.infer<typeof reviewAuthorKindSchema>;

export const reviewRatingSchema = z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX);

/** Texto opcional: espaços nas pontas saem, vazio vira `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

/**
 * PUT /v1/spaces/:spaceId/reviews/me: cria ou substitui a avaliação da pessoa (uma por espaço).
 * Os chips precisam combinar com a nota (`reviewTagsMatchRating`), conferido pela API.
 */
export const upsertReviewSchema = z
  .object({
    rating: reviewRatingSchema,
    tags: z
      .array(reviewTagSchema)
      .max(REVIEW_MAX_TAGS)
      .refine((tags) => new Set(tags).size === tags.length, { message: 'Chip repetido.' })
      .default([]),
    comment: optionalText(REVIEW_COMMENT_MAX_LENGTH),
  })
  .strict();
export type UpsertReviewInput = z.input<typeof upsertReviewSchema>;
export type UpsertReview = z.output<typeof upsertReviewSchema>;

/** Motivos da denúncia (RN-REVIEW-04). */
export const REVIEW_REPORT_REASONS = [
  'SPAM',
  'OFFENSIVE',
  'FALSE_INFO',
  'PERSONAL_DATA',
  'OTHER',
] as const;
export const reviewReportReasonSchema = z.enum(REVIEW_REPORT_REASONS);
export type ReviewReportReason = z.infer<typeof reviewReportReasonSchema>;

/** POST /v1/reviews/:reviewId/reports e a denúncia pela gestão. */
export const reportReviewSchema = z
  .object({
    reason: reviewReportReasonSchema,
    details: optionalText(REVIEW_REPORT_DETAILS_MAX_LENGTH),
  })
  .strict();
export type ReportReviewInput = z.input<typeof reportReviewSchema>;

export const REVIEW_REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export const reviewReportStatusSchema = z.enum(REVIEW_REPORT_STATUSES);
export type ReviewReportStatus = z.infer<typeof reviewReportStatusSchema>;

// ---------------------------------------------------------------------------------------------
// Saídas

/** Resposta pública do espaço (decisão 104). */
export const reviewReplySchema = z.object({
  body: z.string(),
  repliedAt: datetime,
  /** Última edição; nula se nunca foi editada. */
  updatedAt: datetime.nullable(),
});
export type ReviewReply = z.infer<typeof reviewReplySchema>;

/** `{ count, average }` a partir das colunas `rating_count`/`rating_sum` do espaço. */
export const spaceRating = (count: number, sum: number): SpaceRating => ({
  count,
  average: reviewAverage(sum, count),
});

/** A avaliação da própria pessoa (comentário inteiro, mesmo oculto pela moderação). */
export const myReviewSchema = z.object({
  id,
  spaceId: id,
  rating: reviewRatingSchema,
  tags: z.array(reviewTagSchema),
  comment: z.string().nullable(),
  /** Oculto pela moderação (RN-REVIEW-04): fica fora da lista pública; editar não reexibe. */
  commentHidden: z.boolean(),
  authorKind: reviewAuthorKindSchema,
  reply: reviewReplySchema.nullable(),
  createdAt: datetime,
  updatedAt: datetime,
});
export type MyReview = z.infer<typeof myReviewSchema>;

/** Motivo de não poder criar ou editar (os mesmos códigos dos erros do PUT). */
export const REVIEW_INELIGIBLE_REASONS = ['REVIEW_NOT_ELIGIBLE', 'REVIEW_NOT_ALLOWED'] as const;
export const reviewIneligibleReasonSchema = z.enum(REVIEW_INELIGIBLE_REASONS);
export type ReviewIneligibleReason = z.infer<typeof reviewIneligibleReasonSchema>;

/**
 * GET /v1/spaces/:spaceId/reviews/eligibility (RN-REVIEW-01): o botão da página e o card da
 * reserva ou aula passada. Três situações: pode criar (`canReview`), pode editar (`myReview` com
 * `canEdit`) ou só leitura (os dois falsos, com `reason`). O autor sempre pode excluir.
 */
export const reviewEligibilitySchema = z.object({
  /** Pode criar: ainda não avaliou, não é da equipe e usou o espaço nos últimos 6 meses. */
  canReview: z.boolean(),
  /** Pode editar a avaliação existente: só a equipe ativa do espaço não edita. */
  canEdit: z.boolean(),
  /**
   * Por que não pode criar (sem avaliação) ou editar (com avaliação): `REVIEW_NOT_ALLOWED` (equipe
   * ativa) ou `REVIEW_NOT_ELIGIBLE` (sem uso). Nulo quando pode.
   */
  reason: reviewIneligibleReasonSchema.nullable(),
  /** A avaliação existente ("Editar minha avaliação"). */
  myReview: myReviewSchema.nullable(),
});
export type ReviewEligibility = z.infer<typeof reviewEligibilitySchema>;

/**
 * Query do PUT: `createOnly=true` só cria (409 `REVIEW_ALREADY_EXISTS` se a pessoa já avaliou),
 * para o card de um toque não apagar os chips e o comentário feitos em outro aparelho.
 */
export const upsertReviewQuerySchema = z.object({
  createOnly: z
    .stringbool()
    .optional()
    .describe('`true`: só cria; com avaliação existente, 409 `REVIEW_ALREADY_EXISTS`.'),
});
export type UpsertReviewQuery = z.infer<typeof upsertReviewQuerySchema>;

/** Item de "Minhas avaliações" (RF-REVIEW-08). */
export const myReviewListItemSchema = myReviewSchema.extend({
  space: z.object({
    id,
    slug: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    /** Bairro e cidade, os mesmos campos do card da vitrine ("bairro · cidade"). */
    neighborhood: z.string().nullable(),
    city: z.string(),
    /** Fora da vitrine (suspenso, encerrado): só dá para excluir. */
    inShowcase: z.boolean(),
  }),
  /**
   * Pode editar agora: o espaço está na vitrine e a pessoa não é da equipe ativa dele
   * (RN-REVIEW-01). Falso = só leitura; excluir continua permitido.
   */
  canEdit: z.boolean(),
});
export type MyReviewListItem = z.infer<typeof myReviewListItemSchema>;

export const myReviewsQuerySchema = z.object(pageFields);
export type MyReviewsQuery = z.infer<typeof myReviewsQuerySchema>;

export const myReviewPageSchema = z.object({
  items: z.array(myReviewListItemSchema),
  nextCursor: z.string().nullable(),
});
export type MyReviewPage = z.infer<typeof myReviewPageSchema>;

/** Autor como aparece em público: sem id nem sobrenome completo (decisão 102). */
export const reviewAuthorSchema = z.object({
  /** "Ana S." ou "Usuário removido". */
  name: z.string(),
  avatarUrl: z.string().nullable(),
  kind: reviewAuthorKindSchema,
});
export type ReviewAuthor = z.infer<typeof reviewAuthorSchema>;

/** Avaliação na lista pública (RF-REVIEW-04). */
export const publicReviewSchema = z.object({
  id,
  author: reviewAuthorSchema,
  rating: reviewRatingSchema,
  tags: z.array(reviewTagSchema),
  /** Nulo sem comentário ou quando oculto pela moderação (`commentHidden`). */
  comment: z.string().nullable(),
  commentHidden: z.boolean(),
  reply: reviewReplySchema.nullable(),
  createdAt: datetime,
  updatedAt: datetime,
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

const ratingFilter = z.coerce
  .number()
  .int()
  .min(REVIEW_RATING_MIN)
  .max(REVIEW_RATING_MAX)
  .optional()
  .describe('Só as avaliações com esta nota (1 a 5).');

/** GET /v1/spaces/:spaceId/reviews: mais recentes primeiro. */
export const publicReviewsQuerySchema = z.object({ rating: ratingFilter, ...pageFields });
export type PublicReviewsQuery = z.infer<typeof publicReviewsQuerySchema>;

export const publicReviewPageSchema = z.object({
  items: z.array(publicReviewSchema),
  nextCursor: z.string().nullable(),
});
export type PublicReviewPage = z.infer<typeof publicReviewPageSchema>;

/** Quantas avaliações têm cada nota (5 → 1). */
export const reviewDistributionSchema = z.array(
  z.object({ rating: reviewRatingSchema, count: z.number().int().nonnegative() }),
);
export type ReviewDistribution = z.infer<typeof reviewDistributionSchema>;

export const reviewTagCountSchema = z.object({
  tag: reviewTagSchema,
  count: z.number().int().positive(),
});
export type ReviewTagCount = z.infer<typeof reviewTagCountSchema>;

/**
 * Chips mais citados por grupo (painel e Super): até `REVIEW_HIGHLIGHTS_PER_GROUP` elogios
 * (positivos) e até 5 críticas (negativos), do mais citado para o menos, com a contagem; empate
 * na ordem do catálogo. Grupo vazio = nenhum chip daquele tipo.
 */
export const reviewHighlightsSchema = z.object({
  positive: z.array(reviewTagCountSchema),
  negative: z.array(reviewTagCountSchema),
});
export type ReviewHighlights = z.infer<typeof reviewHighlightsSchema>;

/** GET /v1/spaces/:spaceId/reviews/summary (RF-REVIEW-03). */
export const reviewSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  /** Nula com menos de `REVIEW_SUMMARY_MIN_COUNT` avaliações ("Novo"). */
  average: z.number().nullable(),
  distribution: reviewDistributionSchema,
  /** Até 3, do mais citado para o menos (empate na ordem do catálogo). */
  topTags: z.array(reviewTagCountSchema),
  /** Até 3 avaliações recentes com comentário visível, mais recentes primeiro. */
  recent: z.array(publicReviewSchema),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Gestão do espaço (RF-REVIEW-06)

/** PUT /v1/manage/spaces/:spaceId/reviews/:reviewId/reply */
export const replyReviewSchema = z
  .object({ body: z.string().trim().min(1).max(REVIEW_REPLY_MAX_LENGTH) })
  .strict();
export type ReplyReviewInput = z.infer<typeof replyReviewSchema>;

/** Avaliação no painel: o que o público vê e se o espaço já denunciou. */
export const manageReviewSchema = publicReviewSchema.extend({
  /** Alguém da gestão deste espaço já denunciou a avaliação. */
  reportedBySpace: z.boolean(),
});
export type ManageReview = z.infer<typeof manageReviewSchema>;

export const manageReviewsQuerySchema = z.object({
  rating: ratingFilter,
  unanswered: z.stringbool().optional().describe('`true`: só as avaliações sem resposta.'),
  ...pageFields,
});
export type ManageReviewsQuery = z.infer<typeof manageReviewsQuerySchema>;

export const manageReviewPageSchema = z.object({
  items: z.array(manageReviewSchema),
  nextCursor: z.string().nullable(),
});
export type ManageReviewPage = z.infer<typeof manageReviewPageSchema>;

/** Dias da tendência no painel. */
export const REVIEW_TREND_DAYS = 90;
export const REVIEW_TREND_GRANULARITIES = ['DAY', 'WEEK'] as const;
export const reviewTrendGranularitySchema = z.enum(REVIEW_TREND_GRANULARITIES);
export type ReviewTrendGranularity = z.infer<typeof reviewTrendGranularitySchema>;

export const manageReviewSummaryQuerySchema = z.object({
  trend: reviewTrendGranularitySchema
    .default('WEEK')
    .describe(
      'Pontos da tendência: por dia ou por semana (domingo a sábado, no fuso do espaço). Padrão `WEEK`.',
    ),
});
export type ManageReviewSummaryQuery = z.infer<typeof manageReviewSummaryQuerySchema>;

export const reviewTrendPointSchema = z.object({
  /** Primeiro dia do ponto (data local do espaço). */
  date: z.iso.date(),
  /** Avaliações criadas no período. */
  count: z.number().int().nonnegative(),
  /** Média das criadas no período; nula sem nenhuma. */
  average: z.number().nullable(),
  /** Média de todas as avaliações criadas até o fim do período; nula sem nenhuma. */
  cumulativeAverage: z.number().nullable(),
});
export type ReviewTrendPoint = z.infer<typeof reviewTrendPointSchema>;

/** GET /v1/manage/spaces/:spaceId/reviews/summary */
export const manageReviewSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  /** Média de todas as avaliações (o painel mostra mesmo abaixo de 5); nula sem nenhuma. */
  average: z.number().nullable(),
  /**
   * O público já vê a média: espaço na vitrine e `count` ≥ `REVIEW_SUMMARY_MIN_COUNT` (a mesma
   * regra do resumo do Super). Suspenso ou encerrado, falso.
   */
  publicSummaryVisible: z.boolean(),
  /** Avaliações ainda sem resposta. */
  unansweredCount: z.number().int().nonnegative(),
  distribution: reviewDistributionSchema,
  /** Até 5 elogios e até 5 críticas mais citados, com a contagem. */
  highlights: reviewHighlightsSchema,
  trend: z.object({
    granularity: reviewTrendGranularitySchema,
    /** Avaliações criadas nos 90 dias da tendência. */
    count: z.number().int().nonnegative(),
    /**
     * Média das criadas nos 90 dias (soma ÷ contagem no banco, uma casa), não das médias dos
     * pontos; nula sem nenhuma.
     */
    average: z.number().nullable(),
    /** Últimos 90 dias, do mais antigo para o mais recente, com os períodos vazios. */
    points: z.array(reviewTrendPointSchema),
  }),
});
export type ManageReviewSummary = z.infer<typeof manageReviewSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Super (RF-REVIEW-07)

/**
 * POST /v1/super/reviews/reports/:reportId/dismiss: corpo opcional; o motivo (até 500) fica na
 * denúncia e na auditoria (`review.report_dismiss`).
 */
export const dismissReviewReportSchema = z
  .object({ reason: optionalText(REVIEW_MODERATION_REASON_MAX_LENGTH) })
  .strict();
export type DismissReviewReportInput = z.input<typeof dismissReviewReportSchema>;
export type DismissReviewReport = z.output<typeof dismissReviewReportSchema>;

/** Ocultar ou reexibir o comentário (RN-REVIEW-04): o motivo vai para a auditoria. */
export const moderateReviewSchema = z
  .object({ reason: z.string().trim().min(1).max(REVIEW_MODERATION_REASON_MAX_LENGTH) })
  .strict();
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;

/** Avaliação no Super: o comentário inteiro, o autor real e a moderação. */
export const superReviewSchema = z.object({
  id,
  space: z.object({ id, slug: z.string(), name: z.string() }),
  /** Nulo depois da exclusão da conta (decisão 105). */
  author: z.object({
    userId: id.nullable(),
    name: z.string(),
    /** Conta bloqueada: a nota fica fora da média enquanto durar o bloqueio (RN-REVIEW-03). */
    blocked: z.boolean(),
  }),
  rating: reviewRatingSchema,
  tags: z.array(reviewTagSchema),
  comment: z.string().nullable(),
  authorKind: reviewAuthorKindSchema,
  /** Conta na média e aparece em público (falso enquanto o autor está bloqueado). */
  counted: z.boolean(),
  hidden: z
    .object({ at: datetime, byName: z.string().nullable(), reason: z.string().nullable() })
    .nullable(),
  reply: reviewReplySchema.nullable(),
  openReports: z.number().int().nonnegative(),
  createdAt: datetime,
  updatedAt: datetime,
});
export type SuperReview = z.infer<typeof superReviewSchema>;

export const superReviewsQuerySchema = z.object({
  spaceId: id.describe('Espaço das avaliações.'),
  rating: ratingFilter,
  hidden: z.stringbool().optional().describe('`true`: só com comentário oculto.'),
  reported: z.stringbool().optional().describe('`true`: só com denúncia aberta.'),
  ...pageFields,
});
export type SuperReviewsQuery = z.infer<typeof superReviewsQuerySchema>;

export const superReviewPageSchema = z.object({
  items: z.array(superReviewSchema),
  nextCursor: z.string().nullable(),
});
export type SuperReviewPage = z.infer<typeof superReviewPageSchema>;

export const superReviewReportSchema = z.object({
  id,
  reviewId: id,
  reason: reviewReportReasonSchema,
  details: z.string().nullable(),
  status: reviewReportStatusSchema,
  reporter: z.object({
    userId: id.nullable(),
    name: z.string().nullable(),
    /** Denúncia feita pela gestão deste espaço. */
    spaceId: id.nullable(),
  }),
  createdAt: datetime,
  resolvedAt: datetime.nullable(),
  resolvedByName: z.string().nullable(),
  /**
   * Motivo de quem resolveu: o texto opcional do descarte (`DISMISSED`) ou o motivo da ocultação
   * do comentário (`RESOLVED`). Nulo em aberto ou sem motivo.
   */
  resolutionReason: z.string().nullable(),
});
export type SuperReviewReport = z.infer<typeof superReviewReportSchema>;

/** Item da fila de denúncias, com a avaliação denunciada. */
export const superReviewReportItemSchema = superReviewReportSchema.extend({
  review: superReviewSchema,
});
export type SuperReviewReportItem = z.infer<typeof superReviewReportItemSchema>;

export const superReviewReportsQuerySchema = z.object({
  status: reviewReportStatusSchema
    .optional()
    .describe('`OPEN`: da mais antiga para a mais nova (fila). Os demais: mais recentes primeiro.'),
  ...pageFields,
});
export type SuperReviewReportsQuery = z.infer<typeof superReviewReportsQuerySchema>;

export const superReviewReportPageSchema = z.object({
  items: z.array(superReviewReportItemSchema),
  nextCursor: z.string().nullable(),
});
export type SuperReviewReportPage = z.infer<typeof superReviewReportPageSchema>;

/** Entrada do histórico de moderação (auditoria `review.*` da avaliação). */
export const reviewModerationEntrySchema = z.object({
  id,
  action: z.string(),
  actorName: z.string().nullable(),
  actingAsSuper: z.boolean(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: datetime,
});
export type ReviewModerationEntry = z.infer<typeof reviewModerationEntrySchema>;

/** GET /v1/super/reviews/:reviewId */
export const superReviewDetailSchema = superReviewSchema.extend({
  reports: z.array(superReviewReportSchema),
  history: z.array(reviewModerationEntrySchema),
});
export type SuperReviewDetail = z.infer<typeof superReviewDetailSchema>;

/** GET /v1/super/reviews/summary?spaceId= */
export const superReviewSummaryQuerySchema = z.object({
  spaceId: id.describe('Espaço do resumo (em qualquer status, inclusive fora da vitrine).'),
});
export type SuperReviewSummaryQuery = z.infer<typeof superReviewSummaryQuerySchema>;

/**
 * Resumo das avaliações de um espaço no Super (RF-REVIEW-07): o do painel, para qualquer espaço
 * (inclusive fora da vitrine), mais as avaliações fora da média (autor bloqueado, RN-REVIEW-03).
 */
export const superReviewSummarySchema = z.object({
  /** Avaliações que contam na média (`spaces.rating_count`). */
  count: z.number().int().nonnegative(),
  /** Média das que contam, mesmo abaixo de 5; nula sem nenhuma. */
  average: z.number().nullable(),
  /** O público já vê a média (`count` ≥ `REVIEW_SUMMARY_MIN_COUNT` e espaço na vitrine). */
  publicSummaryVisible: z.boolean(),
  /** Avaliações fora da média e das listas públicas: autor bloqueado (`counted` falso). */
  uncountedCount: z.number().int().nonnegative(),
  /** Das que contam na média. */
  distribution: reviewDistributionSchema,
  /** Das que contam na média: até 5 elogios e até 5 críticas. */
  highlights: reviewHighlightsSchema,
});
export type SuperReviewSummary = z.infer<typeof superReviewSummarySchema>;

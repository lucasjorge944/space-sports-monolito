import type {
  PublicReview,
  ReviewDistribution,
  ReviewReply,
  ReviewReportReason,
  ReviewReportStatus,
  ReviewSummary,
  ReviewTrendPoint,
} from '@space-sports/shared';
import {
  formatReviewAverage,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_REMOVED_AUTHOR_NAME,
  REVIEW_SUMMARY_MIN_COUNT,
} from '@space-sports/shared';
import { DISPLAY_TIME_ZONE, formatDate } from './format';

// Avaliações de espaços no web (RF-REVIEW-03 a 07; docs/05-design-system.md, "Avaliações").

export type ReviewRating = 1 | 2 | 3 | 4 | 5;
export const RATINGS_DESC: readonly ReviewRating[] = [5, 4, 3, 2, 1];

const intFmt = new Intl.NumberFormat('pt-BR');

/** `23` → "23 avaliações"; `1` → "1 avaliação"; milhar com ponto. */
export function reviewCountLabel(count: number): string {
  return `${intFmt.format(count)} ${count === 1 ? 'avaliação' : 'avaliações'}`;
}

/** Contagem do selo "(1.234)". */
export const formatCount = (count: number): string => intFmt.format(count);

/** Rótulo de acessibilidade da nota: "Nota 4,8 de 5, 23 avaliações". */
export function ratingAriaLabel(average: number, count: number): string {
  return `Nota ${formatReviewAverage(average)} de 5, ${reviewCountLabel(count)}`;
}

/** "4 de 5 estrelas". */
export const starsAriaLabel = (rating: number): string =>
  `${rating} de 5 ${rating === 1 ? 'estrela' : 'estrelas'}`;

/** O resumo (média, distribuição, chips) aparece? (RN-REVIEW-03: a partir de 5 avaliações) */
export function hasPublicSummary(rating: { count: number; average: number | null }): boolean {
  return rating.average !== null && rating.count >= REVIEW_SUMMARY_MIN_COUNT;
}

// ---------------------------------------------------------------------------------------------
// Datas

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia de calendário em America/Sao_Paulo, como número de dias desde 1970 (para diferenças). */
function localDayNumber(date: Date): number {
  const [y, m, d] = dayFmt.format(date).split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

const plural = (n: number, one: string, many: string) => `há ${n} ${n === 1 ? one : many}`;

/**
 * Data relativa do item (AV.1), por dia de calendário em America/Sao_Paulo: "hoje", "ontem",
 * "há N dias" (2–6), "há N semana(s)" (7–29), "há N mês(es)" (30–364), "há N ano(s)".
 */
export function relativeReviewDate(iso: string, now: Date = new Date()): string {
  const days = localDayNumber(now) - localDayNumber(new Date(iso));
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return plural(Math.floor(days / 7), 'semana', 'semanas');
  if (days < 365) return plural(Math.floor(days / 30), 'mês', 'meses');
  return plural(Math.floor(days / 365), 'ano', 'anos');
}

/** "4 de 5 estrelas, há 3 dias (12/10/2026)". */
export function reviewMetaAriaLabel(rating: number, createdAt: string, now?: Date): string {
  return `${starsAriaLabel(rating)}, ${relativeReviewDate(createdAt, now)} (${formatDate(createdAt)})`;
}

/**
 * Marca "editada": a avaliação mudou depois da resposta do espaço (`updatedAt` > `reply.repliedAt`),
 * então a resposta pode se referir a um texto que não existe mais.
 */
export function isEditedAfterReply(review: {
  updatedAt: string;
  reply: Pick<ReviewReply, 'repliedAt'> | null;
}): boolean {
  if (!review.reply) return false;
  return new Date(review.updatedAt).getTime() > new Date(review.reply.repliedAt).getTime();
}

/** Autor removido (conta excluída, decisão 105): sem foto nem selo do uso. */
export const isRemovedAuthor = (name: string): boolean => name === REVIEW_REMOVED_AUTHOR_NAME;

// ---------------------------------------------------------------------------------------------
// Distribuição e tendência

export type DistributionRow = {
  rating: ReviewRating;
  count: number;
  /** 0–100, inteiro (contagem ÷ total). */
  percent: number;
};

/** As 5 linhas da distribuição, de 5 para 1, com as que a API não mandou zeradas. */
export function distributionRows(distribution: ReviewDistribution): DistributionRow[] {
  const total = distribution.reduce((sum, row) => sum + row.count, 0);
  return RATINGS_DESC.map((rating) => {
    const count = distribution.find((row) => row.rating === rating)?.count ?? 0;
    return { rating, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 };
  });
}

/** Altura da coluna da tendência (% de 48 px): a média na escala 1–5 (1 = 20%, 5 = 100%). */
export function trendBarPercent(average: number | null): number | null {
  if (average === null) return null;
  return Math.round((Math.min(5, Math.max(1, average)) / 5) * 100);
}

/** "Média semanal dos últimos 90 dias, de 4,2 a 5,0" (ou "sem avaliações" quando não há média). */
export function trendAriaLabel(points: readonly ReviewTrendPoint[]): string {
  const averages = points
    .filter((p) => p.average !== null && p.count > 0)
    .map((p) => p.average as number);
  const base = 'Média semanal dos últimos 90 dias';
  if (averages.length === 0) return `${base}, sem avaliações`;
  const min = Math.min(...averages);
  const max = Math.max(...averages);
  return `${base}, de ${formatReviewAverage(min)} a ${formatReviewAverage(max)}`;
}

/**
 * Linha de apoio do card "Média" do painel e do Super: se o público já vê a média e, se não, por quê.
 * Espaço fora da vitrine (suspenso, encerrado, sem quadra ativa ou sem preço) diz isso primeiro, seja
 * qual for o total: mesmo com 5 avaliações o público não veria a nota (RN-REVIEW-07). `inShowcase`
 * vem do espaço (`showcase.visible` do `getManagedSpace` ou do `superGetSpace`); `null` quando não se
 * sabe (o espaço não carregou) e, aí, só o `publicSummaryVisible` falso com 5 ou mais denuncia a vitrine.
 */
export function averageVisibilityHint(
  summary: { count: number; publicSummaryVisible: boolean },
  inShowcase: boolean | null,
): string {
  const outOfShowcase =
    inShowcase === false ||
    (summary.count >= REVIEW_SUMMARY_MIN_COUNT && !summary.publicSummaryVisible);
  if (outOfShowcase) return 'Não aparece no app nem no site: espaço fora da vitrine';
  if (summary.count === 0) return 'Ainda sem avaliações';
  if (summary.publicSummaryVisible) return 'Aparece no app e no site';
  const missing = REVIEW_SUMMARY_MIN_COUNT - summary.count;
  return `Aparece no app a partir de ${REVIEW_SUMMARY_MIN_COUNT} avaliações (faltam ${missing})`;
}

// ---------------------------------------------------------------------------------------------
// Filtros, URLs e SEO

/** `?nota=` → 1–5 (qualquer outro valor é "Todas"). */
export function parseRatingFilter(
  value: string | string[] | null | undefined,
): ReviewRating | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d$/.test(raw)) return undefined;
  const rating = Number(raw);
  return rating >= REVIEW_RATING_MIN && rating <= REVIEW_RATING_MAX
    ? (rating as ReviewRating)
    : undefined;
}

/** `?cursor=` (texto opaco da API); vazio é a primeira página. */
export function parseCursor(value: string | string[] | null | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw : undefined;
}

/** Caminho da lista "Ver todas", com o filtro e a página (cursor) quando houver. */
export function reviewsPagePath(
  slug: string,
  options: { rating?: ReviewRating | undefined; cursor?: string | undefined } = {},
): string {
  const params = new URLSearchParams();
  if (options.rating) params.set('nota', String(options.rating));
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return `/espacos/${encodeURIComponent(slug)}/avaliacoes${query ? `?${query}` : ''}`;
}

const starsText = (rating: number) => `${rating} ${rating === 1 ? 'estrela' : 'estrelas'}`;

/**
 * Lista "Ver todas" sem itens: com cursor (página além do fim, ou link antigo) é o fim da lista, não
 * um espaço sem avaliações; com filtro, a nota não tem avaliações.
 */
export function emptyReviewsState(
  slug: string,
  options: { rating?: ReviewRating | undefined; cursor?: string | undefined },
): { title: string; action: { label: string; href: string } | null } {
  if (options.cursor) {
    return {
      title: 'Não há mais avaliações',
      action: {
        label: 'Ir para a primeira página',
        href: reviewsPagePath(slug, { rating: options.rating }),
      },
    };
  }
  if (options.rating) {
    return {
      title: `Nenhuma avaliação com ${starsText(options.rating)}`,
      action: { label: 'Ver todas', href: reviewsPagePath(slug) },
    };
  }
  return { title: 'Ninguém avaliou ainda', action: null };
}

/**
 * SEO da lista (AV.1): só a primeira página sem cursor é indexável; o `canonical` aponta sempre para
 * a primeira página sem filtro nem cursor, que é a que muda menos.
 */
export function reviewsPageRobots(cursor: string | undefined): { index: boolean; follow: boolean } {
  return { index: !cursor, follow: true };
}

/** Deep link para avaliar pelo app (o web não avalia: o jogador não usa o web logado). */
export function appReviewDeepLink(appLink: string): string {
  return `${appLink}/avaliar`;
}

const isoDay = (iso: string) => iso.slice(0, 10);

/**
 * `aggregateRating` e `review` (schema.org) para o JSON-LD da página do espaço, só quando o resumo
 * aparece (RN-REVIEW-03); senão `{}` e o JSON-LD do espaço fica como antes. Os comentários ocultos
 * nunca chegam aqui (a API manda só os visíveis em `recent`).
 */
export function reviewsJsonLd(summary: ReviewSummary | null): Record<string, unknown> {
  if (!summary || !hasPublicSummary(summary)) return {};
  const ratingBounds = { bestRating: REVIEW_RATING_MAX, worstRating: REVIEW_RATING_MIN };
  const reviews = summary.recent.filter((r) => r.comment && !r.commentHidden);
  return {
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: summary.average,
      reviewCount: summary.count,
      ...ratingBounds,
    },
    ...(reviews.length > 0
      ? {
          review: reviews.map((r: PublicReview) => ({
            '@type': 'Review',
            author: { '@type': 'Person', name: r.author.name },
            datePublished: isoDay(r.createdAt),
            reviewBody: r.comment,
            reviewRating: { '@type': 'Rating', ratingValue: r.rating, ...ratingBounds },
          })),
        }
      : {}),
  };
}

type RatingPair = { count: number; average: number | null };

/**
 * Nota do cabeçalho da página do espaço: a do resumo do bloco "Avaliações" quando ele carregou, para
 * as duas não divergirem (a página tem cache de 5 min e o resumo, de 60 s); `space.rating` só se o
 * resumo falhar.
 */
export function headerRating(spaceRating: RatingPair, summary: RatingPair | null): RatingPair {
  return summary ? { count: summary.count, average: summary.average } : spaceRating;
}

/** Linha do cabeçalho da página do espaço a partir da nota (`headerRating`). */
export function headerRatingText(rating: RatingPair): string | null {
  if (hasPublicSummary(rating)) return reviewCountLabel(rating.count);
  return rating.count > 0 ? 'Ainda poucas avaliações' : null;
}

/**
 * Número do link "Avaliações" no detalhe do espaço no Super (`superGetSpace.rating`, como no card da
 * vitrine: média nula abaixo de 5): "4,8 (23)", "(3)" ou nada (sem avaliações), e o rótulo de
 * acessibilidade do link.
 */
export function superRatingLink(rating: RatingPair): { text: string | null; ariaLabel: string } {
  if (rating.average !== null) {
    return {
      text: `${formatReviewAverage(rating.average)} (${formatCount(rating.count)})`,
      ariaLabel: `Avaliações, ${ratingAriaLabel(rating.average, rating.count).toLowerCase()}`,
    };
  }
  // Sem avaliações, só "Avaliações" (sem "(0)"); o rótulo diz "do espaço" para não repetir o nome do
  // item "Avaliações" do menu do Super, que leva à fila de denúncias.
  if (rating.count === 0) return { text: null, ariaLabel: 'Avaliações do espaço' };
  return {
    text: `(${formatCount(rating.count)})`,
    ariaLabel: `Avaliações, ${reviewCountLabel(rating.count)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Denúncias e moderação

export const REPORT_REASON_OPTIONS: readonly {
  value: ReviewReportReason;
  label: string;
  description: string;
}[] = [
  {
    value: 'SPAM',
    label: 'Spam ou propaganda',
    description: 'Divulga outro negócio ou não tem a ver com o espaço',
  },
  {
    value: 'OFFENSIVE',
    label: 'Ofensivo ou discriminatório',
    description: 'Xinga, ameaça ou discrimina alguém',
  },
  { value: 'FALSE_INFO', label: 'Informação falsa', description: 'Conta algo que não aconteceu' },
  {
    value: 'PERSONAL_DATA',
    label: 'Expõe dados pessoais',
    description: 'Telefone, endereço ou nome completo de alguém',
  },
  { value: 'OTHER', label: 'Outro motivo', description: 'Conte nos detalhes' },
];

export const REPORT_REASON_LABEL = Object.fromEntries(
  REPORT_REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ReviewReportReason, string>;

export const REPORT_STATUS_LABEL: Record<ReviewReportStatus, string> = {
  OPEN: 'Aberta',
  RESOLVED: 'Resolvida',
  DISMISSED: 'Descartada',
};

/** `?status=` da fila de denúncias; o padrão é `OPEN`. */
export function parseReportStatus(value: string | null | undefined): ReviewReportStatus {
  return value === 'RESOLVED' || value === 'DISMISSED' ? value : 'OPEN';
}

/** As 80 primeiras letras do comentário na fila de denúncias. */
export function commentExcerpt(comment: string, max = 80): string {
  const text = comment.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

const MODERATION_ACTION_LABEL: Record<string, string> = {
  'review.hide': 'Ocultado',
  'review.unhide': 'Reexibido',
  'review.report_dismiss': 'Denúncia descartada',
  'review.report': 'Denunciada pelo espaço',
  'review.reply': 'Resposta do espaço',
  'review.reply_delete': 'Resposta removida',
};

/** "Ocultado por Ana · 04/11/2026 14:32 · Motivo: …" a partir de uma entrada da auditoria. */
export function moderationEntryText(entry: {
  action: string;
  actorName: string | null;
  diff: Record<string, unknown> | null;
}): { title: string; reason: string | null } {
  const label = MODERATION_ACTION_LABEL[entry.action] ?? entry.action;
  const by = entry.actorName ? ` por ${entry.actorName}` : '';
  const reason = entry.diff && typeof entry.diff.reason === 'string' ? entry.diff.reason : null;
  return { title: `${label}${by}`, reason };
}

// ---------------------------------------------------------------------------------------------
// Painel

export type PanelReviewFilters = { rating: ReviewRating | undefined; unanswered: boolean };

/** Filtros do painel na URL: `?nota=5&sem-resposta=1`. */
export function parsePanelFilters(params: {
  get(name: string): string | null;
}): PanelReviewFilters {
  return {
    rating: parseRatingFilter(params.get('nota')),
    unanswered: params.get('sem-resposta') === '1',
  };
}

/**
 * Quantas avaliações a lista filtrada tem, a partir do resumo (a lista é por cursor, sem total).
 * `null` com nota e "sem resposta" juntos: o resumo não cruza os dois.
 */
export function panelFilteredCount(
  summary: { count: number; unansweredCount: number; distribution: ReviewDistribution },
  filters: PanelReviewFilters,
): number | null {
  if (filters.rating && filters.unanswered) return null;
  if (filters.rating) {
    return summary.distribution.find((row) => row.rating === filters.rating)?.count ?? 0;
  }
  return filters.unanswered ? summary.unansweredCount : summary.count;
}

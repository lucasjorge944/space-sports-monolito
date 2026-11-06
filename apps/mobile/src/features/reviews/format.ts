import { isApiError, type ReviewEligibility, type SpaceRating } from '@space-sports/api-client';
import {
  formatReviewAverage,
  REVIEW_RATING_LABELS,
  REVIEW_SUMMARY_MIN_COUNT,
  type ReviewReportReason,
  type ReviewTag,
  reviewTagsForRating,
} from '@space-sports/shared';
import { formatInstantDate, todayIn } from '@/lib/datetime';

// Regras de exibição das avaliações no app (docs/05, "Avaliações"; RF-REVIEW-01 a 04 e 08).

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

/** "Bom" para 4; vazio fora de 1–5. */
export function ratingLabel(rating: number): string {
  return REVIEW_RATING_LABELS[rating as 1 | 2 | 3 | 4 | 5] ?? '';
}

/** "1 estrela, Péssimo" … "5 estrelas, Excelente" (alvo da entrada). */
export function starOptionLabel(rating: number): string {
  return `${rating} ${rating === 1 ? 'estrela' : 'estrelas'}, ${ratingLabel(rating)}`;
}

/** "4 de 5 estrelas". */
export function starsSpoken(rating: number): string {
  return `${rating} de 5 estrelas`;
}

/** Milhar com ponto: 1234 → "1.234". */
export function formatCount(count: number): string {
  return count.toLocaleString('pt-BR').replace(/\s/g, '.');
}

/** "23 avaliações" / "1 avaliação". */
export function reviewsCountLabel(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'avaliação' : 'avaliações'}`;
}

/** Link para a lista: "Ver a avaliação" com uma só, "Ver todas as N avaliações" com mais (como o web). */
export function seeAllReviewsLabel(count: number): string {
  return count === 1 ? 'Ver a avaliação' : `Ver todas as ${reviewsCountLabel(count)}`;
}

/** O selo mostra a média (`count` ≥ 5) ou "Novo" (RN-REVIEW-03). */
export function hasPublicAverage(rating: SpaceRating | null | undefined): rating is {
  count: number;
  average: number;
} {
  return Boolean(rating && rating.average !== null && rating.count >= REVIEW_SUMMARY_MIN_COUNT);
}

/** Rótulo de acessibilidade do selo: "Nota 4,8 de 5, 23 avaliações" ou "Novo, ainda poucas avaliações". */
export function ratingSpoken(rating: SpaceRating | null | undefined): string {
  if (hasPublicAverage(rating)) {
    return `Nota ${formatReviewAverage(rating.average)} de 5, ${reviewsCountLabel(rating.count)}`;
  }
  return 'Novo, ainda poucas avaliações';
}

/** Dias de calendário entre duas datas `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const toUtc = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const plural = (n: number, one: string, many: string) => `há ${n} ${n === 1 ? one : many}`;

/**
 * Data relativa por dia de calendário no fuso de São Paulo (docs/05, "Item de avaliação"):
 * "hoje", "ontem", "há N dias" (2–6), "há N semana(s)" (7–29), "há N mês(es)" (30–364), "há N ano(s)".
 */
export function relativeDate(
  iso: string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const day = todayIn(timeZone, new Date(iso));
  const days = Math.max(0, daysBetween(day, todayIn(timeZone, now)));
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return plural(Math.floor(days / 7), 'semana', 'semanas');
  if (days < 365) return plural(Math.floor(days / 30), 'mês', 'meses');
  return plural(Math.floor(days / 365), 'ano', 'anos');
}

/** "há 3 dias (12/10/2026)" para o leitor de tela. */
export function relativeDateSpoken(iso: string, now: Date = new Date()): string {
  return `${relativeDate(iso, now)} (${formatInstantDate(iso, DEFAULT_TIME_ZONE)})`;
}

/** Marca "editada": a avaliação mudou depois da resposta do espaço. */
export function editedAfterReply(review: {
  updatedAt: string;
  reply: { repliedAt: string } | null;
}): boolean {
  return Boolean(
    review.reply &&
      new Date(review.updatedAt).getTime() > new Date(review.reply.repliedAt).getTime(),
  );
}

/**
 * Chips de cada grupo lembrados enquanto a tela está aberta (docs/05, "(3)"): ao trocar de nota,
 * só os chips do grupo da nota atual são mostrados e enviados.
 */
export function visibleTags(rating: number | null, picked: readonly ReviewTag[]): ReviewTag[] {
  if (rating === null) return [];
  const allowed = reviewTagsForRating(rating);
  return allowed.filter((tag) => picked.includes(tag));
}

/** Liga/desliga um chip, respeitando o limite do grupo visível. */
export function toggleTag(
  picked: readonly ReviewTag[],
  tag: ReviewTag,
  rating: number,
  max: number,
): ReviewTag[] {
  if (picked.includes(tag)) return picked.filter((t) => t !== tag);
  if (visibleTags(rating, picked).length >= max) return [...picked];
  return [...picked, tag];
}

/** Comentário a enviar: sem espaços nas pontas; vazio vira `null`. */
export function cleanComment(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/**
 * O que a tela de avaliar mostra para a elegibilidade (RN-REVIEW-01):
 * - `create`: pode criar;
 * - `edit`: tem avaliação e pode editar;
 * - `readOnly`: tem avaliação, mas é da equipe ativa (só excluir);
 * - `blocked`: não tem avaliação e não pode criar (motivo em `reason`).
 */
export type ReviewMode = 'create' | 'edit' | 'readOnly' | 'blocked';

export function reviewMode(eligibility: ReviewEligibility): ReviewMode {
  if (eligibility.myReview) {
    return eligibility.canEdit && eligibility.reason !== 'REVIEW_NOT_ALLOWED' ? 'edit' : 'readOnly';
  }
  return eligibility.canReview ? 'create' : 'blocked';
}

/** Texto do botão da página do espaço; `null` = sem botão (equipe sem avaliação, sem uso). */
export function reviewButtonLabel(eligibility: ReviewEligibility | undefined): string | null {
  if (!eligibility) return null;
  switch (reviewMode(eligibility)) {
    case 'create':
      return 'Avaliar este espaço';
    case 'edit':
      return 'Editar minha avaliação';
    case 'readOnly':
      return 'Ver minha avaliação';
    case 'blocked':
      return null;
  }
}

/** Motivo de não poder avaliar (estado vazio da tela de avaliar). */
export const BLOCKED_TEXTS = {
  REVIEW_NOT_ELIGIBLE: {
    title: 'Você pode avaliar depois de jogar ou ter aula aqui.',
    description: 'Vale para reservas e aulas dos últimos 6 meses.',
  },
  REVIEW_NOT_ALLOWED: {
    title: 'Você faz parte da equipe deste espaço.',
    description: 'A equipe não avalia o próprio espaço.',
  },
  SPACE_NOT_FOUND: {
    title: 'Este espaço não está recebendo avaliações agora.',
    description: undefined,
  },
} as const;

export const READ_ONLY_NOTICE =
  'Você faz parte da equipe deste espaço. Sua avaliação continua publicada, mas não pode ser editada enquanto você estiver na equipe. Você pode excluí-la.';

/** Erro ao enviar a avaliação (docs/05, "(3) Estados"). */
export function submitErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'REVIEW_NOT_ELIGIBLE':
        return `${BLOCKED_TEXTS.REVIEW_NOT_ELIGIBLE.title} ${BLOCKED_TEXTS.REVIEW_NOT_ELIGIBLE.description}`;
      case 'REVIEW_NOT_ALLOWED':
        return `${BLOCKED_TEXTS.REVIEW_NOT_ALLOWED.title} ${BLOCKED_TEXTS.REVIEW_NOT_ALLOWED.description}`;
      case 'REVIEW_TAGS_MISMATCH':
        return 'Os destaques não combinam com a nota. Confira e envie de novo.';
      case 'SPACE_NOT_FOUND':
        return BLOCKED_TEXTS.SPACE_NOT_FOUND.title;
    }
    if (error.status === 404) return BLOCKED_TEXTS.SPACE_NOT_FOUND.title;
    return 'Não foi possível enviar agora. Tente de novo.';
  }
  return 'Sem conexão. Sua avaliação não foi enviada. Tente de novo.';
}

/** O erro é o 403 da equipe ativa (a tela passa ao estado só leitura). */
export function isNotAllowed(error: unknown): boolean {
  return isApiError(error) && error.code === 'REVIEW_NOT_ALLOWED';
}

export function isAlreadyExists(error: unknown): boolean {
  return isApiError(error) && error.code === 'REVIEW_ALREADY_EXISTS';
}

/** Motivos da denúncia (RN-REVIEW-04; docs/05, "(9)"). */
export const REPORT_REASONS: readonly {
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

/** Resultado de uma denúncia que falhou: o 409 conta como enviada (estado local). */
export function reportErrorOutcome(error: unknown): { reported: boolean; message: string } {
  if (isApiError(error) && error.code === 'REVIEW_ALREADY_REPORTED') {
    return { reported: true, message: 'Você já denunciou esta avaliação.' };
  }
  if (isApiError(error) && error.code === 'REVIEW_REPORT_OWN') {
    return { reported: false, message: 'Você não pode denunciar a sua avaliação.' };
  }
  return { reported: false, message: 'Não foi possível enviar a denúncia. Tente de novo.' };
}

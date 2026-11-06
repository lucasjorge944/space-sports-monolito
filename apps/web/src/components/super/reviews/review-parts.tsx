import {
  REVIEW_REMOVED_AUTHOR_NAME,
  type ReviewReportStatus,
  type SuperReview,
} from '@space-sports/shared';
import { Ban } from 'lucide-react';
import type { ReviewItemData } from '@/components/reviews/review-item';
import { Badge } from '@/components/ui/badge';
import { apiErrorMessage } from '@/lib/painel/errors';
import { REPORT_STATUS_LABEL } from '@/lib/reviews';

/** A avaliação do Super no formato do item; o comentário oculto vai à parte (`hiddenComment`). */
export function superReviewItemData(review: SuperReview): ReviewItemData {
  const removed = review.author.userId === null;
  return {
    id: review.id,
    author: {
      name: removed ? REVIEW_REMOVED_AUTHOR_NAME : review.author.name,
      avatarUrl: null,
      kind: removed ? null : review.authorKind,
    },
    rating: review.rating,
    tags: review.tags,
    comment: review.hidden ? null : review.comment,
    commentHidden: review.hidden !== null,
    reply: review.reply,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/** A nota não entra na média: autor bloqueado (RN-REVIEW-03). Só no Super. */
export const isOutOfAverage = (review: Pick<SuperReview, 'author' | 'counted'>) =>
  review.author.blocked || !review.counted;

export function BlockedAuthorBadge() {
  return (
    <Badge
      variant="muted"
      title="A nota desta pessoa não entra na média enquanto ela estiver bloqueada."
      data-testid="selo-autor-bloqueado"
    >
      <Ban aria-hidden />
      Autor bloqueado · fora da média
    </Badge>
  );
}

export function OpenReportsBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge variant="warning">
      {count} {count === 1 ? 'denúncia aberta' : 'denúncias abertas'}
    </Badge>
  );
}

export function ReportStatusBadge({ status }: { status: ReviewReportStatus }) {
  const variant = status === 'OPEN' ? 'warning' : status === 'RESOLVED' ? 'success' : 'muted';
  return <Badge variant={variant}>{REPORT_STATUS_LABEL[status]}</Badge>;
}

/** Erros das ações do Super nas avaliações (códigos de docs/02 §12, mensagens em português). */
export const reviewActionError = (error: unknown) =>
  apiErrorMessage(error, 'Não foi possível concluir. Tente de novo.');

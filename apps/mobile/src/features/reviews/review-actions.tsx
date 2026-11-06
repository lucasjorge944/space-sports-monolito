import { type ReviewEligibility, useDeleteMyReview } from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { reviewMode } from './format';
import { ReportSheet } from './report-sheet';
import type { ReviewItemData, ReviewMenuAction } from './review-item';
import { confirmDeleteReview } from './review-screen';
import { useInvalidateReviews } from './use-reviews';

/**
 * Ações do menu dos itens de avaliação de um espaço (bloco da página e lista "Ver todas"): denunciar
 * as dos outros (com o "Denúncia enviada" só nesta tela) e editar/excluir a minha, reconhecida por
 * `eligibility.myReview.id` (a lista pública não traz id de usuário).
 */
export function useReviewActions({
  space,
  eligibility,
}: {
  space: { id: string; slug: string };
  eligibility: ReviewEligibility | undefined;
}) {
  const router = useRouter();
  const invalidate = useInvalidateReviews();
  const remove = useDeleteMyReview();
  const [reporting, setReporting] = useState<string | null>(null);
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'success' | 'destructive'; text: string } | null>(
    null,
  );

  // O aviso some sozinho em 4 s.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const myId = eligibility?.myReview?.id ?? null;
  const canEditMine = eligibility ? reviewMode(eligibility) === 'edit' : false;
  const isMine = useCallback((id: string) => id === myId, [myId]);

  const onAction = useCallback(
    (action: ReviewMenuAction, review: ReviewItemData) => {
      if (action === 'report') {
        setReporting(review.id);
        return;
      }
      if (action === 'edit') {
        router.push({ pathname: '/espaco/[slug]/avaliar', params: { slug: space.slug } });
        return;
      }
      confirmDeleteReview(() =>
        remove.mutate(
          { spaceId: space.id },
          {
            onSuccess: () => {
              void invalidate(space.id, space.slug);
              setNotice({ tone: 'success', text: 'Sua avaliação foi excluída.' });
            },
            onError: () =>
              setNotice({
                tone: 'destructive',
                text: 'Não foi possível excluir agora. Tente de novo.',
              }),
          },
        ),
      );
    },
    [router, space.id, space.slug, remove, invalidate],
  );

  const sheet = reporting ? (
    <ReportSheet
      reviewId={reporting}
      onClose={() => setReporting(null)}
      onReported={(id, text) => {
        setReporting(null);
        setReported((set) => new Set(set).add(id));
        setNotice({ tone: 'success', text });
      }}
    />
  ) : null;

  return { onAction, isMine, canEditMine, reported, notice, sheet };
}

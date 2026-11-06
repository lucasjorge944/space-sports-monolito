import {
  getGetReviewEligibilityQueryKey,
  isApiError,
  type ReviewEligibility,
  useGetReviewEligibility,
  useUpsertMyReview,
} from '@space-sports/api-client';
import { REVIEW_ELIGIBILITY_MONTHS } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  isAlreadyExists,
  ratingLabel,
  reviewMode,
  starsSpoken,
  submitErrorMessage,
} from './format';
import { StarInput, StarRow } from './stars';
import { useInvalidateReviews } from './use-reviews';

/**
 * O uso já terminou há no máximo 6 meses (RN-REVIEW-01)? O resto da regra (status, presença,
 * equipe) fica com quem chama e com a elegibilidade da API.
 */
export function endedWithinReviewWindow(endsAt: string, now: Date = new Date()): boolean {
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime()) || end.getTime() > now.getTime()) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - REVIEW_ELIGIBILITY_MONTHS);
  return end.getTime() >= limit.getTime();
}

/**
 * Card "Avalie sua experiência" (RF-REVIEW-02; docs/05, "Avaliações (4)") no detalhe da reserva
 * ou da aula passada. Sem avaliação: as estrelas gravam a nota com um toque (`createOnly`, que
 * nunca sobrescreve) e levam à tela de avaliar. Com avaliação: "Sua avaliação" com "Editar" (ou
 * "Ver", na equipe). Sem resposta da elegibilidade, não aparece (é convite, não mostra erro).
 */
export function ReviewPromptCard({
  space,
  kind,
  testID,
}: {
  space: { id: string; slug: string; name: string };
  kind: 'booking' | 'class';
  testID: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReviews();
  const eligibility = useGetReviewEligibility(space.id);
  const upsert = useUpsertMyReview();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alreadyNote, setAlreadyNote] = useState(false);

  useEffect(() => {
    if (!alreadyNote) return;
    const timer = setTimeout(() => setAlreadyNote(false), 4000);
    return () => clearTimeout(timer);
  }, [alreadyNote]);

  const data = eligibility.data;
  if (!data) return null;
  const mode = reviewMode(data);
  if (mode === 'blocked') return null;

  const openReview = (params: { salva?: '1' } = {}) =>
    router.push({ pathname: '/espaco/[slug]/avaliar', params: { slug: space.slug, ...params } });

  if (data.myReview && mode !== 'create') {
    const review = data.myReview;
    return (
      <Card testID={testID}>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="large" className="flex-1">
            Sua avaliação
          </Text>
          <Button
            testID={`${testID}-editar`}
            variant="ghost"
            size="sm"
            onPress={() => openReview()}
          >
            <Text>{mode === 'readOnly' ? 'Ver' : 'Editar'}</Text>
          </Button>
        </View>
        <View
          className="flex-row items-center gap-2"
          accessible
          accessibilityLabel={`${starsSpoken(review.rating)}, ${ratingLabel(review.rating)}`}
          testID={`${testID}-nota`}
        >
          <StarRow value={review.rating} size="item" />
          <Text variant="muted">{ratingLabel(review.rating)}</Text>
        </View>
        {alreadyNote ? <Text variant="muted">Você já tinha avaliado este espaço.</Text> : null}
      </Card>
    );
  }

  const rate = (rating: number) => {
    setPending(rating);
    setError(null);
    upsert.mutate(
      { spaceId: space.id, data: { rating }, params: { createOnly: 'true' } },
      {
        onSuccess: (review) => {
          // A tela de avaliar abre já em edição, sem esperar a elegibilidade de novo.
          queryClient.setQueryData<ReviewEligibility>(getGetReviewEligibilityQueryKey(space.id), {
            canReview: false,
            canEdit: true,
            reason: null,
            myReview: review,
          });
          void invalidate(space.id, space.slug);
          setPending(null);
          openReview({ salva: '1' });
        },
        onError: (err) => {
          setPending(null);
          if (isAlreadyExists(err)) {
            // Avaliou por outro caminho (ex.: pelo push) com esta tela aberta: não é erro.
            setAlreadyNote(true);
            void eligibility.refetch();
            return;
          }
          const code = isApiError(err) ? err.code : null;
          setError(
            code === 'REVIEW_NOT_ELIGIBLE' || code === 'REVIEW_NOT_ALLOWED'
              ? submitErrorMessage(err)
              : 'Não foi possível salvar a nota. Tente de novo.',
          );
          if (code) void eligibility.refetch();
        },
      },
    );
  };

  return (
    <Card testID={testID}>
      <Text variant="large">Avalie sua experiência</Text>
      {pending !== null ? (
        <Text variant="muted">Salvando sua nota…</Text>
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <Text variant="muted">
          {kind === 'class'
            ? `Como foi a aula no ${space.name}? Toque numa estrela.`
            : `Como foi jogar no ${space.name}? Toque numa estrela.`}
        </Text>
      )}
      <StarInput
        value={pending}
        size="prompt"
        label={`Sua nota para ${space.name}`}
        disabled={pending !== null}
        testIDPrefix={`${testID}-estrela`}
        onChange={rate}
      />
    </Card>
  );
}

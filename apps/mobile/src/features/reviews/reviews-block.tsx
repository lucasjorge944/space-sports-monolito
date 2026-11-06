import {
  type PublicSpace,
  type ReviewSummary,
  type SpaceRating,
  useGetReviewEligibility,
  useGetSpaceReviewSummary,
} from '@space-sports/api-client';
import {
  formatReviewAverage,
  isPositiveReviewTag,
  REVIEW_TAG_LABELS,
  type ReviewTag,
} from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { useRouter } from 'expo-router';
import { ChevronRight, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { SpaceSection } from '@/features/space/space-section';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  formatCount,
  hasPublicAverage,
  ratingSpoken,
  reviewButtonLabel,
  reviewMode,
  reviewsCountLabel,
  seeAllReviewsLabel,
} from './format';
import { useReviewActions } from './review-actions';
import { ReviewItem } from './review-item';
import { Notice } from './review-screen';
import { StarIcon, StarRow } from './stars';

const DIST = reviewLayout.distribution;

/** Distribuição 5 → 1 com barras (trilho `muted`, barra `primary`), decorativas. */
export function Distribution({
  summary,
}: {
  summary: Pick<ReviewSummary, 'count' | 'distribution'>;
}) {
  const rows = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: summary.distribution.find((d) => d.rating === rating)?.count ?? 0,
  }));
  return (
    <View style={{ gap: DIST.rowGap }}>
      {rows.map(({ rating, count }) => {
        const share = summary.count > 0 ? count / summary.count : 0;
        return (
          <View
            key={rating}
            testID={`avaliacoes-distribuicao-${rating}`}
            className="flex-row items-center gap-2"
            accessible
            accessibilityLabel={`${rating} ${rating === 1 ? 'estrela' : 'estrelas'}: ${reviewsCountLabel(count)}`}
          >
            <View className="flex-row items-center gap-0.5" style={{ width: DIST.labelWidth }}>
              <Text className="text-sm font-medium text-foreground">{rating}</Text>
              <StarIcon fill="full" size={reviewLayout.star.badge.size} />
            </View>
            <View
              className="flex-1 overflow-hidden rounded-full bg-muted"
              style={{ height: DIST.barHeight }}
            >
              {count > 0 ? (
                <View
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${share * 100}%`, minWidth: 4 }}
                />
              ) : null}
            </View>
            <Text
              className="text-right text-sm tabular-nums text-muted-foreground"
              style={{ width: DIST.countWidth }}
            >
              {formatCount(count)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Etiqueta "Quadra boa 12" com o polegar (o ícone diz se é elogio ou crítica). */
function TopTag({ tag, count }: { tag: ReviewTag; count: number }) {
  const name = useThemeName();
  const Icon = isPositiveReviewTag(tag) ? ThumbsUp : ThumbsDown;
  return (
    <Badge
      variant="sport"
      className="gap-1.5"
      accessible
      accessibilityLabel={`${REVIEW_TAG_LABELS[tag]}, citado ${count} ${count === 1 ? 'vez' : 'vezes'}`}
    >
      <Icon size={14} color={color(name, 'mutedForeground')} aria-hidden />
      <Text>
        {REVIEW_TAG_LABELS[tag]} <Text className="font-medium tabular-nums">{count}</Text>
      </Text>
    </Badge>
  );
}

/** Card do resumo (≥ 5 avaliações): média, estrelas, total, distribuição e mais citados. */
export function SummaryCard({ summary }: { summary: ReviewSummary & { average: number } }) {
  const topTags = summary.topTags.slice(0, reviewLayout.topTagsCount);
  return (
    <Card testID="avaliacoes-resumo">
      <View
        className="flex-row items-center gap-3"
        accessible
        accessibilityLabel={ratingSpoken(summary)}
      >
        <Text
          className="font-display-bold tabular-nums text-foreground"
          style={reviewLayout.summaryAverage.app}
          testID="avaliacoes-media"
        >
          {formatReviewAverage(summary.average)}
        </Text>
        <View className="gap-1">
          <StarRow value={summary.average} size="summary" />
          <Text variant="muted">{reviewsCountLabel(summary.count)}</Text>
        </View>
      </View>
      <View className="pt-1">
        <Distribution summary={summary} />
      </View>
      {topTags.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <Text variant="overline">Mais citados</Text>
          <View className="flex-row flex-wrap gap-2">
            {topTags.map((item) => (
              <TopTag key={item.tag} tag={item.tag} count={item.count} />
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** Card "Novo" (0 a 4 avaliações): sem média, distribuição nem chips. */
function NewCard({ count, canReview }: { count: number; canReview: boolean }) {
  return (
    <Card testID="avaliacoes-novo">
      <View className="flex-row items-center gap-2">
        <Badge variant="info">
          <Text>Novo</Text>
        </Badge>
        <Text className="flex-1">
          {count === 0 ? 'Ninguém avaliou ainda.' : 'Ainda poucas avaliações'}
        </Text>
      </View>
      <Text variant="muted">
        {count === 0 && canReview
          ? 'Jogou aqui? Sua avaliação ajuda outros jogadores.'
          : 'A nota aparece a partir de 5 avaliações.'}
      </Text>
    </Card>
  );
}

/**
 * Linha do cabeçalho da página (docs/05, "(2)"): "★ 4,8 · 23 avaliações" ou o badge "Novo" com
 * "Ainda poucas avaliações"; leva ao bloco. Também é a linha resumida da lista "Ver todas".
 */
export function RatingHeaderLine({
  rating,
  onPress,
  testID,
}: {
  rating: SpaceRating | null | undefined;
  onPress?: () => void;
  testID?: string;
}) {
  const content = hasPublicAverage(rating) ? (
    <View className="flex-row items-center" style={{ gap: reviewLayout.star.badge.gap }}>
      <StarIcon fill="full" size={reviewLayout.star.badge.size} />
      <Text className="text-sm font-semibold tabular-nums text-foreground">
        {formatReviewAverage(rating.average)}
        <Text className="text-sm font-normal text-muted-foreground">
          {' '}
          · {reviewsCountLabel(rating.count)}
        </Text>
      </Text>
    </View>
  ) : (
    <View className="flex-row items-center gap-2">
      <Badge variant="info">
        <Text>Novo</Text>
      </Badge>
      {rating && rating.count > 0 ? <Text variant="muted">Ainda poucas avaliações</Text> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={ratingSpoken(rating)}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      role="link"
      accessibilityLabel={`${ratingSpoken(rating)}. Ver avaliações`}
      onPress={onPress}
      className="min-h-11 justify-center self-start"
    >
      {content}
    </Pressable>
  );
}

/**
 * Bloco "Avaliações" da página do espaço (RF-REVIEW-03; docs/05, "(5)"): resumo ou "Novo", o botão
 * de avaliar conforme a elegibilidade, os 3 comentários recentes e "Ver todas".
 */
export function ReviewsBlock({ space }: { space: PublicSpace }) {
  const name = useThemeName();
  const router = useRouter();
  const summary = useGetSpaceReviewSummary(space.id, { query: { staleTime: 60_000 } });
  const eligibility = useGetReviewEligibility(space.id);
  const actions = useReviewActions({ space, eligibility: eligibility.data });
  const buttonLabel = reviewButtonLabel(eligibility.data);
  const data = summary.data;

  let content: React.ReactNode;
  if (summary.isPending) {
    content = (
      <View className="gap-3" testID="avaliacoes-carregando">
        <Skeleton className="rounded-lg" style={{ height: 168 }} />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-12" />
      </View>
    );
  } else if (summary.isError || !data) {
    content = (
      <View className="gap-2" testID="avaliacoes-erro">
        <Text variant="muted">Não foi possível carregar as avaliações.</Text>
        <Button variant="ghost" className="self-start" onPress={() => void summary.refetch()}>
          <Text>Tentar de novo</Text>
        </Button>
      </View>
    );
  } else {
    const recent = data.recent.slice(0, reviewLayout.recentCount);
    content = (
      <View className="gap-4">
        {hasPublicAverage(data) ? (
          <SummaryCard summary={data} />
        ) : (
          <NewCard
            count={data.count}
            canReview={eligibility.data ? reviewMode(eligibility.data) === 'create' : false}
          />
        )}
        {buttonLabel ? (
          <Button
            testID="espaco-avaliar"
            variant="outline"
            onPress={() =>
              router.push({ pathname: '/espaco/[slug]/avaliar', params: { slug: space.slug } })
            }
          >
            <Text>{buttonLabel}</Text>
          </Button>
        ) : null}
        {actions.notice ? <Notice tone={actions.notice.tone} text={actions.notice.text} /> : null}
        {recent.length > 0 ? (
          <View>
            {recent.map((review, index) => (
              <View key={review.id} className={index > 0 ? 'border-t border-border' : undefined}>
                <ReviewItem
                  review={review}
                  spaceName={space.name}
                  spaceLogoUrl={space.logoUrl}
                  mine={actions.isMine(review.id)}
                  canEditMine={actions.canEditMine}
                  reported={actions.reported.has(review.id)}
                  onAction={actions.onAction}
                />
              </View>
            ))}
          </View>
        ) : null}
        {data.count > recent.length ? (
          <Pressable
            testID="espaco-avaliacoes-ver-todas"
            role="link"
            onPress={() =>
              router.push({ pathname: '/espaco/[slug]/avaliacoes', params: { slug: space.slug } })
            }
            className="min-h-11 flex-row items-center gap-1 self-start"
          >
            <Text className="font-semibold text-link">{seeAllReviewsLabel(data.count)}</Text>
            <ChevronRight size={16} color={color(name, 'link')} aria-hidden />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View testID="espaco-avaliacoes">
      <SpaceSection title="Avaliações">{content}</SpaceSection>
      {actions.sheet}
    </View>
  );
}

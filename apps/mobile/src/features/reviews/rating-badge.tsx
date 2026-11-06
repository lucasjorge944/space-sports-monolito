import type { SpaceRating } from '@space-sports/api-client';
import { formatReviewAverage } from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { formatCount, hasPublicAverage } from './format';
import { StarIcon } from './stars';

/**
 * Selo da nota (docs/05, "Avaliações (2)"): "★ 4,8 (23)" com 5 ou mais avaliações; abaixo disso, o
 * badge `info` "Novo" (sem estrela, para não parecer nota zero). Fica dentro de um contêiner com
 * rótulo próprio (card, callout), que diz a nota (`ratingSpoken`). Não quebra linha nem encolhe.
 */
export function RatingBadge({
  rating,
  testID,
}: {
  rating: SpaceRating | null | undefined;
  testID?: string;
}) {
  if (!hasPublicAverage(rating)) {
    return (
      <Badge variant="info" testID={testID ?? 'selo-novo'} className="shrink-0">
        <Text>Novo</Text>
      </Badge>
    );
  }
  const badge = reviewLayout.star.badge;
  return (
    <View
      testID={testID ?? 'selo-avaliacao'}
      className="shrink-0 flex-row items-center"
      style={{ gap: badge.gap }}
    >
      <StarIcon fill="full" size={badge.size} />
      <Text numberOfLines={1} className="text-sm font-semibold tabular-nums text-foreground">
        {formatReviewAverage(rating.average)}
        <Text className="text-sm font-normal text-muted-foreground">
          {' '}
          ({formatCount(rating.count)})
        </Text>
      </Text>
    </View>
  );
}

/** Linha "selo · local": o selo fica inteiro e o local encolhe com "…". */
export function RatingLocationLine({
  rating,
  location,
  testID,
}: {
  rating: SpaceRating | null | undefined;
  location: string;
  testID?: string;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <RatingBadge rating={rating} testID={testID} />
      {location ? (
        <>
          <Text variant="muted">·</Text>
          <Text variant="muted" numberOfLines={1} className="flex-1">
            {location}
          </Text>
        </>
      ) : null}
    </View>
  );
}

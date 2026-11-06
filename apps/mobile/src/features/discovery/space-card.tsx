import type { SpaceCard as SpaceCardData } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { exploreLayout } from '@space-sports/ui-tokens';
import { useRouter } from 'expo-router';
import { Image as ImageIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { RemoteImage } from '@/components/remote-image';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { SponsoredBadge } from '@/features/explore/sponsored-badge';
import { ratingSpoken } from '@/features/reviews/format';
import { RatingLocationLine } from '@/features/reviews/rating-badge';
import { formatDistance } from '@/lib/datetime';
import { isServiceVisible } from '@/lib/features';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** "Savassi · Belo Horizonte". */
export function spaceLocationLabel(space: Pick<SpaceCardData, 'neighborhood' | 'city'>): string {
  return [space.neighborhood, space.city].filter(Boolean).join(' · ');
}

const SERVICE_LABELS = { RENTAL: 'Aluguel', CLASSES: 'Aulas', TOURNAMENTS: 'Torneios' } as const;

/**
 * Card da vitrine (RF-SPACE-05), no desenho do card de quadra das pranchas 06 e 07 (raio 24,
 * elevação por superfície): foto 4:5 com a logo do espaço (RF-SPACE-11), nome, a nota ou "Novo"
 * (RF-REVIEW-03) + bairro + distância, esportes e preço/hora. Só mostra o que a API traz.
 */
function SpaceCardBase({
  space,
  sponsor,
  onPress,
  testID,
}: {
  space: SpaceCardData;
  /**
   * Anunciante do card patrocinado de espaço sem imagem própria (RF-ADS-05): o card fica igual, com
   * o selo "Patrocinado · <anunciante>" sobre a capa e "Patrocinado, " no rótulo.
   */
  sponsor?: string;
  /** Toque próprio (o patrocinado conta o clique antes de abrir o espaço). */
  onPress?: () => void;
  testID?: string;
}) {
  const router = useRouter();
  const name = useThemeName();
  const distance = space.distanceMeters === null ? null : formatDistance(space.distanceMeters);
  const label = [
    sponsor ? `Patrocinado, ${sponsor}` : null,
    space.name,
    // A nota vem logo depois do nome (RF-REVIEW-03; docs/05, "Avaliações (2)").
    ratingSpoken(space.rating).replace(/^N/, 'n'),
    spaceLocationLabel(space),
    distance,
    `${formatCents(space.pricePerHourCents)} por hora`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      testID={testID ?? `espaco-card-${space.slug}`}
      role="link"
      accessibilityLabel={label}
      accessibilityHint="Abre a página do espaço"
      className="overflow-hidden rounded-xl border border-border bg-card active:opacity-90"
      onPress={
        onPress ?? (() => router.push({ pathname: '/espaco/[slug]', params: { slug: space.slug } }))
      }
    >
      {space.cover ? (
        <RemoteImage
          uri={space.cover.url}
          blurhash={space.cover.blurhash}
          style={{ width: '100%', aspectRatio: 4 / 5 }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          className="w-full items-center justify-center bg-muted"
          style={{ aspectRatio: 4 / 5 }}
        >
          <ImageIcon size={40} color={color(name, 'mutedForeground')} />
        </View>
      )}
      {sponsor ? (
        <View
          pointerEvents="none"
          className="absolute flex-row"
          style={{
            top: exploreLayout.feed.badgeInset,
            left: exploreLayout.feed.badgeInset,
            right: exploreLayout.feed.badgeInset,
          }}
        >
          <SponsoredBadge advertiser={sponsor} testID={`${testID ?? 'espaco-card'}-selo`} />
        </View>
      ) : null}
      <View className="gap-3 px-5 pb-5 pt-4">
        <View className="flex-row items-center gap-3">
          <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={44} />
          <View className="flex-1 gap-0.5">
            <Text variant="h4" numberOfLines={1} className="tracking-normal">
              {space.name}
            </Text>
            <RatingLocationLine
              rating={space.rating}
              location={[spaceLocationLabel(space), distance].filter(Boolean).join(' · ')}
            />
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {space.sports.map((sport) => (
            <Badge key={sport.slug} variant="sport">
              <Text>{sport.name}</Text>
            </Badge>
          ))}
        </View>
        <View className="flex-row items-center justify-between gap-2 border-t border-border pt-3">
          <Text variant="muted">
            <Text variant="price" className="text-xl">
              {formatCents(space.pricePerHourCents)}
            </Text>{' '}
            / hora
          </Text>
          <Text variant="muted" numberOfLines={1} className="shrink">
            {space.services
              .filter(isServiceVisible)
              .map((s) => SERVICE_LABELS[s])
              .join(' · ')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const SpaceCard = memo(SpaceCardBase);

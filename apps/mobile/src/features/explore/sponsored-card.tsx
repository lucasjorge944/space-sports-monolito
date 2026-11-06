import { exploreLayout } from '@space-sports/ui-tokens';
import { Image } from 'expo-image';
import { Image as ImageIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { SpaceCard } from '@/features/discovery/space-card';
import { RatingLocationLine } from '@/features/reviews/rating-badge';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  adAccessibilityLabel,
  destinationHint,
  destinationIcon,
  destinationLabel,
} from './ad-destination';
import type { Ad } from './feed';
import { SponsoredBadge } from './sponsored-badge';

const FEED = exploreLayout.feed;

/**
 * Card patrocinado da lista (`EXPLORE_FEED`, RF-ADS-05): o esqueleto do card de espaço, com o selo
 * sobre a foto, título e texto da peça e, no rodapé, o destino e o botão de contorno (só visual: o
 * card inteiro é o alvo de toque).
 */
function SponsoredCardBase({ ad, onPress }: { ad: Ad; onPress: (ad: Ad) => void }) {
  const name = useThemeName();
  const testID = `explorar-anuncio-card-${ad.creativeId}`;

  // Anunciante espaço sem imagem própria: o próprio card do espaço, com o selo.
  if (ad.imageUrl === null && ad.destination.type === 'SPACE') {
    return (
      <SpaceCard
        space={ad.destination.space}
        sponsor={ad.advertiser.name}
        onPress={() => onPress(ad)}
        testID={testID}
      />
    );
  }

  const Icon = destinationIcon(ad.destination);
  const foreground = color(name, 'foreground');
  return (
    <Pressable
      testID={testID}
      role="link"
      accessibilityLabel={adAccessibilityLabel(ad)}
      accessibilityHint={destinationHint(ad.destination)}
      className="overflow-hidden rounded-xl border border-border bg-card active:opacity-90"
      onPress={() => onPress(ad)}
    >
      <View className="w-full bg-muted" style={{ aspectRatio: FEED.aspectRatio }}>
        {ad.imageUrl ? (
          <Image
            source={{ uri: ad.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <ImageIcon size={40} color={color(name, 'mutedForeground')} />
          </View>
        )}
        <View
          pointerEvents="none"
          className="absolute flex-row"
          style={{ top: FEED.badgeInset, left: FEED.badgeInset, right: FEED.badgeInset }}
        >
          <SponsoredBadge advertiser={ad.advertiser.name} testID={`${testID}-selo`} />
        </View>
      </View>
      <View className="gap-3 px-5 pb-5 pt-4">
        <View className="gap-1">
          <Text numberOfLines={2} className="font-display-semibold text-xl text-foreground">
            {ad.title}
          </Text>
          {ad.body ? (
            <Text numberOfLines={3} className="text-sm text-muted-foreground">
              {ad.body}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
          {ad.destination.type === 'SPACE' ? (
            // Anunciante espaço com imagem própria: a nota antes do bairro (docs/05, "Avaliações (2)").
            <View className="shrink flex-1">
              <RatingLocationLine
                rating={ad.destination.space.rating}
                location={destinationLabel(ad.destination)}
                testID={`${testID}-nota`}
              />
            </View>
          ) : (
            <Text variant="muted" numberOfLines={1} className="shrink">
              {destinationLabel(ad.destination)}
            </Text>
          )}
          <View
            className="flex-row items-center gap-1.5 rounded-md border-[1.5px] border-outline-border bg-outline-background px-4"
            style={{ minHeight: FEED.ctaHeight }}
          >
            <Text className="text-sm font-semibold text-foreground">{ad.ctaLabel}</Text>
            <Icon size={16} color={foreground} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const SponsoredCard = memo(SponsoredCardBase);

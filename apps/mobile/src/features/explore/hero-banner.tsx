import { exploreLayout, mediaOverlayStops } from '@space-sports/ui-tokens';
import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SpaceAvatar } from '@/components/space-avatar';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { adAccessibilityLabel, destinationHint, destinationIcon } from './ad-destination';
import type { Ad } from './feed';
import { SponsoredBadge } from './sponsored-badge';

const HERO = exploreLayout.hero;
const MAX_FONT = exploreLayout.mediaMaxFontSizeMultiplier;
const LOGO_SIZE = 40;
/** Largura que o selo perde para não encostar na logo do espaço (logo 40 + 12). */
const LOGO_CLEARANCE = 52;

/**
 * Corte do bloco de texto para caber abaixo do selo: 0 = título (até 2 linhas) e texto; 1 = sem o
 * texto; 2 = sem o texto e título em 1 linha.
 */
type Fit = 0 | 1 | 2;

/** Imagem da peça ou, de anunciante espaço sem imagem própria, a capa do espaço. */
function heroImage(ad: Ad): { uri: string; blurhash: string | null } | null {
  if (ad.imageUrl) return { uri: ad.imageUrl, blurhash: null };
  if (ad.destination.type === 'SPACE' && ad.destination.space.cover) {
    return { uri: ad.destination.space.cover.url, blurhash: ad.destination.space.cover.blurhash };
  }
  return null;
}

/** Degradê de leitura em `media-overlay`, com as opacidades de `mediaOverlayStops`. */
function Overlay({ id, stopColor }: { id: string; stopColor: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {mediaOverlayStops.map((stop) => (
            <Stop
              key={stop.offset}
              offset={stop.offset}
              stopColor={stopColor}
              stopOpacity={stop.opacity}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/**
 * Banner do carrossel (`EXPLORE_HERO`, RF-ADS-04): imagem → degradê → selo → título, texto e
 * botão desenhados pelo app (nunca dentro da imagem). O banner inteiro é o alvo de toque.
 */
function HeroBannerBase({
  ad,
  index,
  total,
  width,
  onPress,
}: {
  ad: Ad;
  index: number;
  total: number;
  width: number;
  onPress: (ad: Ad) => void;
}) {
  const name = useThemeName();
  const height = width / HERO.aspectRatio;
  const image = heroImage(ad);
  const spaceLogo =
    ad.imageUrl === null && ad.destination.type === 'SPACE' ? ad.destination.space : null;
  const [fit, setFit] = useState<Fit>(0);
  const [badgeHeight, setBadgeHeight] = useState<number | null>(null);
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const Icon = destinationIcon(ad.destination);

  // Nova largura (rotação): mede de novo a partir do bloco completo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomeça a medição quando a peça ou a largura mudam.
  useEffect(() => setFit(0), [width, ad.creativeId]);

  // Regra de caber: o bloco não sobe além de 4 abaixo do selo; corta o texto e depois o título.
  useEffect(() => {
    if (badgeHeight === null || blockHeight === null || fit >= 2) return;
    const available = height - HERO.padding - (HERO.badgeInset + badgeHeight + HERO.badgeClearance);
    if (blockHeight > available) setFit((fit + 1) as Fit);
  }, [badgeHeight, blockHeight, fit, height]);

  const badgeMaxWidth = width - HERO.badgeInset * 2 - (spaceLogo ? LOGO_CLEARANCE : 0);

  return (
    <Pressable
      testID={`explorar-anuncio-banner-${ad.creativeId}`}
      role="link"
      accessibilityLabel={adAccessibilityLabel(ad, { index, total })}
      accessibilityHint={destinationHint(ad.destination)}
      className="overflow-hidden rounded-xl bg-muted active:opacity-90"
      style={{ width, height }}
      onPress={() => onPress(ad)}
    >
      {image ? (
        <Image
          source={{ uri: image.uri }}
          placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Overlay id={`hero-overlay-${ad.creativeId}`} stopColor={color(name, 'mediaOverlay')} />
      <View
        pointerEvents="none"
        className="absolute"
        style={{ top: HERO.badgeInset, left: HERO.badgeInset }}
        onLayout={(e) => setBadgeHeight(e.nativeEvent.layout.height)}
      >
        <SponsoredBadge
          advertiser={ad.advertiser.name}
          maxWidth={badgeMaxWidth}
          testID={`explorar-anuncio-banner-${ad.creativeId}-selo`}
        />
      </View>
      {spaceLogo ? (
        <View
          pointerEvents="none"
          className="absolute"
          style={{ top: HERO.badgeInset, right: HERO.badgeInset }}
        >
          <SpaceAvatar
            name={spaceLogo.name}
            logoUrl={spaceLogo.logoUrl}
            size={LOGO_SIZE}
            className="border-2 border-media-foreground"
            testID="anuncio-banner-logo"
          />
        </View>
      ) : null}
      <View
        pointerEvents="none"
        className="absolute items-start"
        style={{ left: HERO.padding, right: HERO.padding, bottom: HERO.padding }}
        onLayout={(e) => setBlockHeight(e.nativeEvent.layout.height)}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT}
          numberOfLines={fit === 2 ? 1 : 2}
          className="font-display-bold text-xl text-media-foreground"
          style={{ lineHeight: 24 }}
        >
          {ad.title}
        </Text>
        {ad.body && fit === 0 ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT}
            numberOfLines={1}
            className="mt-0.5 text-sm text-media-foreground"
          >
            {ad.body}
          </Text>
        ) : null}
        <View
          className="mt-2 flex-row items-center gap-1.5 rounded-full bg-media-action pl-3.5 pr-3"
          style={{ minHeight: HERO.ctaHeight }}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT}
            className="text-sm font-semibold text-media-action-foreground"
          >
            {ad.ctaLabel}
          </Text>
          <Icon size={16} color={color(name, 'mediaActionForeground')} />
        </View>
      </View>
    </Pressable>
  );
}

export const HeroBanner = memo(HeroBannerBase);

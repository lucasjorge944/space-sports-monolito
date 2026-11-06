import { exploreLayout } from '@space-sports/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/skeleton';
import type { Ad } from './feed';
import { HeroBanner } from './hero-banner';
import { useCalmMotion } from './use-calm-motion';

const HERO = exploreLayout.hero;
const INDICATOR = HERO.indicator;
/** Margem lateral da página do carrossel (a do resto da tela). */
const GUTTER = 16;

/** Segmento do indicador: o da peça atual enche da esquerda para a direita durante os 5 s. */
function Segment({
  current,
  running,
  full,
  cycle,
}: {
  current: boolean;
  running: boolean;
  full: boolean;
  cycle: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `cycle` reinicia o enchimento depois de um toque ou arrasto.
  useEffect(() => {
    if (!current) {
      progress.setValue(0);
      return;
    }
    if (full) {
      progress.setValue(1);
      return;
    }
    if (!running) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: HERO.autoplayMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [current, running, full, cycle, progress]);

  return (
    <View
      className="overflow-hidden rounded-full bg-border"
      style={{ width: INDICATOR.segmentWidth, height: INDICATOR.height }}
    >
      <Animated.View
        className="h-full w-full rounded-full bg-primary"
        style={{ transformOrigin: 'left', transform: [{ scaleX: progress }] }}
      />
    </View>
  );
}

/** Esqueleto do banner na primeira carga (sem indicador). */
export function HeroCarouselSkeleton() {
  const { width } = useWindowDimensions();
  const bannerWidth = width - GUTTER * 2;
  return (
    <View className="px-4" accessibilityLabel="Carregando anúncios">
      <Skeleton
        className="rounded-xl"
        style={{ width: bannerWidth, height: bannerWidth / HERO.aspectRatio }}
      />
    </View>
  );
}

/**
 * Carrossel patrocinado (`EXPLORE_HERO`, RF-ADS-04): uma peça por página, troca sozinho a cada 5 s
 * (da última volta para a primeira), pausa enquanto a pessoa toca ou arrasta e fica parado com
 * "reduzir movimento" ou leitor de tela, fora de foco, em segundo plano ou fora da tela (`active`).
 */
export function HeroCarousel({
  ads,
  active,
  onPressAd,
  onCurrentChange,
}: {
  ads: Ad[];
  /** Explorar em foco, app em primeiro plano e o carrossel na tela. */
  active: boolean;
  onPressAd: (ad: Ad) => void;
  /** Peça na tela agora (para a impressão). */
  onCurrentChange?: (ad: Ad | null) => void;
}) {
  const { width } = useWindowDimensions();
  const bannerWidth = width - GUTTER * 2;
  const listRef = useRef<FlatList<Ad>>(null);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);
  const [cycle, setCycle] = useState(0);
  const calm = useCalmMotion();
  const total = ads.length;

  // Nova entrega com outras peças (ou outra ordem): volta para a primeira, sem herdar a posição.
  const idsKey = ads.map((ad) => ad.creativeId).join('|');
  const [shownIds, setShownIds] = useState(idsKey);
  if (shownIds !== idsKey) {
    setShownIds(idsKey);
    setIndex(0);
    setCycle((c) => c + 1);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola para o início só quando as peças mudam.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [shownIds]);

  const current = Math.min(index, Math.max(0, total - 1));
  const running = active && !touching && !calm && total > 1;

  const currentAd = ads[current] ?? null;
  useEffect(() => {
    onCurrentChange?.(currentAd);
  }, [currentAd, onCurrentChange]);

  // Troca automática: a peça atual fica 5 s; `cycle` dá 5 s inteiros depois de soltar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cycle` reinicia o tempo da peça atual.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      const next = (current + 1) % total;
      listRef.current?.scrollToOffset({ offset: next * width, animated: true });
      setIndex(next);
    }, HERO.autoplayMs);
    return () => clearTimeout(timer);
  }, [running, current, total, width, cycle]);

  const release = () => {
    setTouching(false);
    setCycle((c) => c + 1);
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next >= 0 && next < total) setIndex(next);
  };

  if (total === 0) return null;

  return (
    <View testID="explorar-carrossel" accessibilityLabel="Anúncios">
      <FlatList
        testID="explorar-carrossel-lista"
        ref={listRef}
        data={ads}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(ad) => ad.creativeId}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <View className="px-4" style={{ width }}>
            <HeroBanner ad={item} index={i} total={total} width={bannerWidth} onPress={onPressAd} />
          </View>
        )}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={release}
        onTouchCancel={release}
        onScrollBeginDrag={() => setTouching(true)}
        onMomentumScrollEnd={(event) => {
          onMomentumScrollEnd(event);
          if (touching) release();
        }}
      />
      {total > 1 ? (
        <View
          testID="explorar-carrossel-indicador"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          className="flex-row justify-center"
          style={{ marginTop: INDICATOR.offset, gap: INDICATOR.gap }}
        >
          {ads.map((ad, i) => (
            <Segment
              key={ad.creativeId}
              current={i === current}
              running={running}
              full={calm}
              cycle={cycle}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

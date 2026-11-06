import { FlashList, type ViewToken } from '@shopify/flash-list';
import { useListSports } from '@space-sports/api-client';
import { exploreLayout } from '@space-sports/ui-tokens';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { EmptyView, ErrorView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import {
  clearSearchAndFilters,
  countActiveFilters,
  isOnlyMinRatingOn,
  type SpaceFilters,
  setFilters,
  useFilters,
} from '@/features/discovery/filters-store';
import {
  clearAllLabel,
  MIN_RATING_EMPTY,
  MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION,
} from '@/features/discovery/labels';
import { SearchHeader } from '@/features/discovery/search-header';
import { buildSearchParams } from '@/features/discovery/search-params';
import { SpaceCard } from '@/features/discovery/space-card';
import { useSpacesSearch } from '@/features/discovery/use-spaces-search';
import { LocationBanner } from '@/features/location/location-banner';
import { useLocation } from '@/features/location/location-provider';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { openAdDestination } from './ad-destination';
import {
  type Ad,
  buildFeed,
  currentFeedSlots,
  type FeedItem,
  feedSlotsReducer,
  initialFeedSlots,
} from './feed';
import { HeroCarousel, HeroCarouselSkeleton } from './hero-carousel';
import { RecentSpaces } from './recent-spaces';
import { exploreSections } from './sections';
import { SponsoredCard } from './sponsored-card';
import { SportShortcuts, SportShortcutsSkeleton } from './sport-shortcuts';
import { useAdMetrics } from './use-ad-metrics';
import { useAds } from './use-ads';
import { useExploreOpenings } from './use-explore-openings';
import { useRecentSpaces } from './use-recent-spaces';

/** `paddingTop` da lista: o cabeçalho das seções começa aqui. */
const LIST_PADDING_TOP = 8;

function CardSkeleton() {
  return (
    <View className="overflow-hidden rounded-xl border border-border bg-card">
      <Skeleton className="w-full rounded-none" style={{ aspectRatio: 4 / 5 }} />
      <View className="gap-2 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </View>
    </View>
  );
}

/**
 * Lista vazia. Com o "4+ estrelas" como único filtro, o motivo mais provável é a regra da nota pública
 * (decisão 109): explica e oferece tirar só ele. Com o "4+ estrelas" e mais busca ou filtro, o vazio
 * genérico lembra a regra e oferece as duas saídas.
 */
function SearchEmpty({
  filters,
  hasLocation,
  hasFilters,
}: {
  filters: SpaceFilters;
  hasLocation: boolean;
  hasFilters: boolean;
}) {
  const removeMinRating = (
    <Button
      testID="explorar-vazio-tirar-nota"
      variant="outline"
      onPress={() => setFilters({ minRating: null })}
    >
      <Text>{MIN_RATING_EMPTY.action}</Text>
    </Button>
  );
  if (isOnlyMinRatingOn(filters)) {
    return (
      <EmptyView
        testID="explorar-vazio-nota"
        title={MIN_RATING_EMPTY.title}
        description={MIN_RATING_EMPTY.description}
        action={removeMinRating}
      />
    );
  }
  const clearAll = hasFilters ? (
    <Button testID="explorar-vazio-limpar" variant="outline" onPress={clearSearchAndFilters}>
      <Text>{clearAllLabel(filters.q.trim() !== '')}</Text>
    </Button>
  ) : undefined;
  const minRatingOn = filters.minRating !== null;
  return (
    <EmptyView
      testID="explorar-vazio"
      title="Nenhum espaço encontrado"
      description={
        minRatingOn
          ? MIN_RATING_WITH_OTHERS_EMPTY_DESCRIPTION
          : hasFilters
            ? 'Tente outro nome ou afrouxe os filtros.'
            : hasLocation
              ? 'Ainda não há espaços por perto. Aumente a distância nos filtros.'
              : 'Ainda não há espaços cadastrados.'
      }
      action={
        minRatingOn ? (
          <View className="items-center gap-2">
            {removeMinRating}
            {clearAll}
          </View>
        ) : (
          clearAll
        )
      }
    />
  );
}

function isAdItem(item: FeedItem): item is Extract<FeedItem, { ad: Ad }> {
  return item.type !== 'space';
}

/**
 * Explorar (RF-SPACE-05/06, RF-SPACE-12, RF-SPACE-13, RF-ADS-04 a 08), no estilo do iFood: busca e
 * filtros fixos no topo; numa lista só, atalhos por esporte → carrossel patrocinado → Espaços
 * recentes → título → espaços, com cards patrocinados em vagas fixas. Os anúncios chegam em chamadas
 * separadas e nunca seguram a lista.
 */
export function ExploreScreen() {
  const name = useThemeName();
  const router = useRouter();
  const filters = useFilters();
  const { coords } = useLocation();
  const debouncedQ = useDebouncedValue(filters.q);
  const params = useMemo(
    () => buildSearchParams(filters, coords, debouncedQ),
    [filters, coords, debouncedQ],
  );
  const search = useSpacesSearch(params);
  const sections = exploreSections({ query: debouncedQ, filters, hasLocation: !!coords });
  const hasFilters = countActiveFilters(filters) > 0 || filters.q.trim() !== '';

  const sports = useListSports({ query: { staleTime: 10 * 60_000 } });
  const metrics = useAdMetrics();
  const heroAds = useAds('EXPLORE_HERO', coords, filters.sport, {
    enabled: sections.hero,
    active: metrics.active,
  });
  const feedAds = useAds('EXPLORE_FEED', coords, filters.sport, { active: metrics.active });
  const recents = useRecentSpaces({ enabled: sections.recents });

  // Cada abertura do Explorar (foco da aba, volta do segundo plano) busca as duas vagas de novo:
  // uma impressão por abertura (RF-ADS-08) e campanha encerrada ou pausada sai. Uma busca por vaga
  // (junta com a que já estiver em andamento); a impressão volta a valer com a entrega nova.
  const opening = useExploreOpenings();
  const openingRefetch = useRef({
    heroAds,
    feedAds,
    hero: sections.hero,
    restart: metrics.restart,
  });
  openingRefetch.current = { heroAds, feedAds, hero: sections.hero, restart: metrics.restart };
  useEffect(() => {
    if (opening === 0) return;
    const { heroAds: hero, feedAds: feed, hero: heroOn, restart } = openingRefetch.current;
    let alive = true;
    void Promise.allSettled([
      heroOn ? hero.refetch({ cancelRefetch: false }) : null,
      feed.refetch({ cancelRefetch: false }),
    ]).then(() => {
      if (alive) restart();
    });
    return () => {
      alive = false;
    };
  }, [opening]);

  // Vagas do feed: uma "sessão" por busca; o puxar para atualizar começa outra.
  const [refreshCount, setRefreshCount] = useState(0);
  const listKey = `${JSON.stringify(params)}#${refreshCount}`;
  const [slotsState, dispatch] = useReducer(feedSlotsReducer, listKey, initialFeedSlots);
  const slots = currentFeedSlots(slotsState, listKey);
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;

  useEffect(() => {
    if (feedAds.data) dispatch({ type: 'ads', listKey, ads: feedAds.data.items });
  }, [feedAds.data, listKey]);

  const items = useMemo(() => buildFeed(search.items, slots.ads, slots), [search.items, slots]);

  // Visibilidade: ≥ 50% conta a impressão (com 1 s no tracker); qualquer pedaço marca a vaga vista.
  // A lista guarda as chaves das vagas visíveis: uma entrega nova troca o token da peça sem mudar a
  // chave, e o tracker precisa do token atual.
  const tracker = metrics.tracker;
  const visibleAdKeys = useRef<string[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const syncFeedVisible = useCallback(() => {
    const keys = new Set(visibleAdKeys.current);
    const ads = itemsRef.current.flatMap((item) =>
      isAdItem(item) && keys.has(item.key) ? [item.ad] : [],
    );
    tracker.setVisible('feed', ads);
  }, [tracker]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` muda o token das vagas visíveis.
  useEffect(() => syncFeedVisible(), [items, syncFeedVisible]);
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 50, minimumViewTime: 0 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
        visibleAdKeys.current = viewableItems.flatMap((token) =>
          token.item && isAdItem(token.item) ? [token.item.key] : [],
        );
        syncFeedVisible();
      },
    },
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 1, minimumViewTime: 0 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
        let max = -1;
        for (const token of viewableItems) {
          if (token.item?.type === 'space') max = Math.max(max, token.item.spaceIndex);
        }
        if (max >= 0) dispatch({ type: 'seen', listKey: listKeyRef.current, spaceIndex: max });
      },
    },
  ]).current;

  // Carrossel na tela (≥ 50% visível): para a troca automática e para a impressão do slide ativo.
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const heroBox = useRef<{ y: number; height: number } | null>(null);
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  const updateHeroOnScreen = useCallback(() => {
    const box = heroBox.current;
    if (!box || viewportHeight.current === 0) return;
    const top = LIST_PADDING_TOP + box.y;
    const visible =
      Math.min(top + box.height, scrollY.current + viewportHeight.current) -
      Math.max(top, scrollY.current);
    setHeroOnScreen(visible >= box.height / 2);
  }, []);

  const heroList = sections.hero ? heroAds.ads : [];
  const heroActive = metrics.active && heroOnScreen && heroList.length > 0;
  const [heroCurrent, setHeroCurrent] = useState<Ad | null>(null);
  useEffect(() => {
    tracker.setVisible('hero', heroActive && heroCurrent ? [heroCurrent] : []);
  }, [tracker, heroActive, heroCurrent]);

  // O clique só conta se o destino abriu (URL recusada ou sem app para ela não conta).
  const openAd = useCallback(
    (ad: Ad) => {
      void openAdDestination(ad.destination, (slug) =>
        router.push({ pathname: '/espaco/[slug]', params: { slug } }),
      ).then((opened) => {
        if (opened) metrics.click(ad);
      });
    },
    [metrics.click, router],
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        search.refetch(),
        sports.refetch(),
        sections.hero ? heroAds.refetch() : null,
        feedAds.refetch(),
        recents.refetch(),
      ]);
    } finally {
      // Nova sessão da lista com os anúncios recém-entregues: as vagas voltam a valer.
      setRefreshCount((count) => count + 1);
      metrics.restart();
      setRefreshing(false);
    }
  }, [search, sports, sections.hero, heroAds, feedAds, recents, metrics.restart]);

  const sportItems = sports.data?.items ?? [];
  const header = (
    <View style={{ gap: exploreLayout.sectionGap, paddingBottom: exploreLayout.sectionTitleGap }}>
      {sections.shortcuts ? (
        sports.isPending ? (
          <SportShortcutsSkeleton />
        ) : sportItems.length > 0 ? (
          <SportShortcuts sports={sportItems} selected={filters.sport} />
        ) : null
      ) : null}
      {sections.hero ? (
        heroAds.isLoading ? (
          <HeroCarouselSkeleton />
        ) : heroList.length > 0 ? (
          <View
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              heroBox.current = { y, height };
              updateHeroOnScreen();
            }}
          >
            <HeroCarousel
              ads={heroList}
              active={heroActive}
              onPressAd={openAd}
              onCurrentChange={setHeroCurrent}
            />
          </View>
        ) : null
      ) : null}
      {sections.recents ? <RecentSpaces spaces={recents.items} loading={recents.loading} /> : null}
      <Text
        testID="explorar-titulo-lista"
        role="heading"
        className="px-4 font-display-semibold text-xl text-foreground"
      >
        {sections.listTitle}
      </Text>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-4 pb-2 pt-3">
        <SearchHeader filters={filters} />
        <LocationBanner />
      </View>
      <FlashList
        testID="explorar-lista"
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={({ item }) => (
          <View className="px-4">
            {item.type === 'space' ? (
              <SpaceCard space={item.space} />
            ) : (
              <SponsoredCard ad={item.ad} onPress={openAd} />
            )}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: exploreLayout.listGap }} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 24, paddingTop: LIST_PADDING_TOP }}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          updateHeroOnScreen();
        }}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
          updateHeroOnScreen();
        }}
        scrollEventThrottle={64}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        ListEmptyComponent={
          search.isPending ? (
            <View className="gap-4 px-4" accessibilityLabel="Carregando espaços">
              <CardSkeleton />
              <CardSkeleton />
            </View>
          ) : search.isError ? (
            <ErrorView error={search.error} onRetry={() => void search.refetch()} />
          ) : (
            <SearchEmpty filters={filters} hasLocation={!!coords} hasFilters={hasFilters} />
          )
        }
        ListFooterComponent={
          search.isFetchingNextPage ? (
            <ActivityIndicator className="py-4" color={color(name, 'primary')} />
          ) : search.isError && search.items.length > 0 ? (
            <ErrorView error={search.error} onRetry={() => void search.fetchNextPage()} />
          ) : null
        }
      />
    </View>
  );
}

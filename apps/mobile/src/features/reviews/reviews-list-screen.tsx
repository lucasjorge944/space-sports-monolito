import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  type PublicReviewPageItemsItem,
  useGetReviewEligibility,
  useGetSpaceBySlug,
  useGetSpaceReviewSummary,
} from '@space-sports/api-client';
import { reviewLayout } from '@space-sports/ui-tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useCalmMotion } from '@/features/explore/use-calm-motion';
import { isNotFound } from '@/lib/api-errors';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { hasPublicAverage } from './format';
import { useReviewActions } from './review-actions';
import { ReviewItem } from './review-item';
import { Notice } from './review-screen';
import { RatingHeaderLine } from './reviews-block';
import { StarIcon } from './stars';
import { useSpaceReviews } from './use-reviews';

/** `?nota=5` → 5; o resto → `null` (todas). */
export function parseRatingFilter(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function ItemSkeleton() {
  return (
    <View className="flex-row gap-3 py-4">
      <Skeleton className="h-9 w-9 rounded-full" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-12" />
      </View>
    </View>
  );
}

/**
 * Lista "Ver todas" do espaço (RF-REVIEW-04; docs/05, "(6)"), rota `espaco/[slug]/avaliacoes`:
 * resumo em uma linha, filtro por nota (na URL, `?nota=`), itens com cursor e "Denunciar". Com
 * `?avaliacao=<id>` (push `review.replied`), rola até o item e o destaca por 2 s; se ele não estiver
 * na primeira página, abre Minhas avaliações.
 */
export function ReviewsListScreen() {
  const name = useThemeName();
  const router = useRouter();
  const calm = useCalmMotion();
  const { slug, nota, avaliacao } = useLocalSearchParams<{
    slug: string;
    nota?: string;
    avaliacao?: string;
  }>();
  const filter = parseRatingFilter(nota);
  const space = useGetSpaceBySlug(slug, { query: { staleTime: 60_000 } });
  const spaceId = space.data?.id;
  const summary = useGetSpaceReviewSummary(spaceId ?? '', {
    query: { enabled: Boolean(spaceId), staleTime: 60_000 },
  });
  const eligibility = useGetReviewEligibility(spaceId ?? '', {
    query: { enabled: Boolean(spaceId) },
  });
  const query = useSpaceReviews(spaceId, filter);
  const actions = useReviewActions({
    space: { id: spaceId ?? '', slug },
    eligibility: eligibility.data,
  });
  const listRef = useRef<FlashListRef<PublicReviewPageItemsItem>>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const handledTarget = useRef(false);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const withCounts = summary.data ? hasPublicAverage(summary.data) : false;

  const setFilter = (rating: number | null) =>
    router.setParams({ nota: rating ? String(rating) : undefined });

  // Vindo da resposta do espaço: rola até a avaliação (primeira página) ou abre Minhas avaliações.
  const firstPage = query.data?.pages[0];
  useEffect(() => {
    if (!avaliacao || handledTarget.current || !firstPage) return;
    handledTarget.current = true;
    const index = firstPage.items.findIndex((item) => item.id === avaliacao);
    if (index < 0) {
      router.replace({ pathname: '/minhas-avaliacoes', params: { avaliacao } });
      return;
    }
    setTimeout(() => listRef.current?.scrollToIndex({ index, animated: !calm }), 0);
    if (!calm) {
      setHighlighted(avaliacao);
      setTimeout(() => setHighlighted(null), 2000);
    }
  }, [avaliacao, firstPage, router, calm]);

  if (space.isPending) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-background">
        <ScreenHeader title="Avaliações" testID="avaliacoes-titulo" />
        <LoadingView />
      </SafeAreaView>
    );
  }
  if (space.isError || !space.data) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-background">
        <ScreenHeader title="Avaliações" testID="avaliacoes-titulo" />
        {isNotFound(space.error) ? (
          <EmptyView title="Espaço não encontrado" description="Ele pode ter sido desativado." />
        ) : (
          <ErrorView error={space.error} onRetry={() => void space.refetch()} />
        )}
      </SafeAreaView>
    );
  }
  const spaceData = space.data;

  const header = (
    <View className="gap-3 pb-1 pt-4">
      <RatingHeaderLine rating={summary.data ?? spaceData.rating} testID="avaliacoes-nota" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        role="radiogroup"
        accessibilityLabel="Filtrar por nota"
      >
        <Chip
          testID="avaliacoes-filtro-todas"
          selected={filter === null}
          onPress={() => setFilter(null)}
        >
          <Text>Todas</Text>
        </Chip>
        {[5, 4, 3, 2, 1].map((rating) => {
          const count = summary.data?.distribution.find((d) => d.rating === rating)?.count ?? 0;
          return (
            <Chip
              key={rating}
              testID={`avaliacoes-filtro-${rating}`}
              selected={filter === rating}
              disabled={withCounts && count === 0}
              accessibilityLabel={`${rating} ${rating === 1 ? 'estrela' : 'estrelas'}${withCounts ? `, ${count}` : ''}`}
              onPress={() => setFilter(rating)}
            >
              <Text>{rating}</Text>
              <StarIcon fill="full" size={reviewLayout.star.badge.size} />
              {withCounts ? <Text className="tabular-nums">{count}</Text> : null}
            </Chip>
          );
        })}
      </ScrollView>
      {actions.notice ? <Notice tone={actions.notice.tone} text={actions.notice.text} /> : null}
    </View>
  );

  const empty = query.isPending ? (
    <View accessibilityLabel="Carregando avaliações">
      <ItemSkeleton />
      <ItemSkeleton />
      <ItemSkeleton />
    </View>
  ) : query.isError ? (
    <ErrorView error={query.error} onRetry={() => void query.refetch()} />
  ) : filter ? (
    <EmptyView
      title={`Nenhuma avaliação com ${filter} ${filter === 1 ? 'estrela' : 'estrelas'}`}
      action={
        <Button variant="outline" testID="avaliacoes-limpar-filtro" onPress={() => setFilter(null)}>
          <Text>Ver todas</Text>
        </Button>
      }
    />
  ) : (
    <EmptyView title="Ninguém avaliou ainda" />
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Avaliações" testID="avaliacoes-titulo" />
      <FlashList
        ref={listRef}
        testID="avaliacoes-lista"
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <View className={index > 0 ? 'border-t border-border' : undefined}>
            <ReviewItem
              review={item}
              spaceName={spaceData.name}
              spaceLogoUrl={spaceData.logoUrl}
              mine={actions.isMine(item.id)}
              canEditMine={actions.canEditMine}
              reported={actions.reported.has(item.id)}
              highlighted={highlighted === item.id}
              onAction={actions.onAction}
            />
          </View>
        )}
        onEndReachedThreshold={1}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
            void query.fetchNextPage();
          }
        }}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => {
          void query.refetch();
          void summary.refetch();
        }}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator color={color(name, 'primary')} />
            </View>
          ) : query.isFetchNextPageError ? (
            <View className="items-center gap-1 py-4">
              <Text variant="muted">Não foi possível carregar mais.</Text>
              <Pressable
                role="button"
                onPress={() => void query.fetchNextPage()}
                className="min-h-11 justify-center"
              >
                <Text className="font-medium text-link">Tentar de novo</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
      {actions.sheet}
    </SafeAreaView>
  );
}

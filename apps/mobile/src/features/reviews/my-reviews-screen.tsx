import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { type MyReviewPageItemsItem, useDeleteMyReview } from '@space-sports/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { EllipsisVertical } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet, useMenuSheet } from '@/components/bottom-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { SpaceAvatar } from '@/components/space-avatar';
import { EmptyView, ErrorView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { spaceLocationLabel } from '@/features/discovery/space-card';
import { useCalmMotion } from '@/features/explore/use-calm-motion';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { ClampedText, HiddenCommentLine, RatingDateLine, ReplyBlock, TagList } from './review-item';
import { confirmDeleteReview, Notice } from './review-screen';
import { useInvalidateReviews, useMyReviews } from './use-reviews';

type Item = MyReviewPageItemsItem;

/** Páginas carregadas no máximo atrás da avaliação do push (`?avaliacao=`) antes de desistir. */
export const TARGET_MAX_PAGES = 5;

type MenuAction = 'edit' | 'space' | 'delete';

function MyReviewCard({
  review,
  highlighted,
  onOpen,
  onDelete,
}: {
  review: Item;
  highlighted: boolean;
  onOpen: (review: Item) => void;
  onDelete: (review: Item) => void;
}) {
  const name = useThemeName();
  const router = useRouter();
  const inShowcase = review.space.inShowcase;
  const canEdit = review.canEdit && inShowcase;
  const location = spaceLocationLabel(review.space);
  // A ação roda depois que o menu fecha: no iOS, o Alert de excluir não abre no mesmo toque em que o
  // Modal está fechando.
  const menu = useMenuSheet<MenuAction>((action) => {
    if (action === 'edit') onOpen(review);
    else if (action === 'space') {
      router.push({ pathname: '/espaco/[slug]', params: { slug: review.space.slug } });
    } else onDelete(review);
  });

  const content = (
    <>
      <View className="flex-row items-center gap-3">
        <SpaceAvatar name={review.space.name} logoUrl={review.space.logoUrl} size={40} />
        <View className="flex-1">
          <Text numberOfLines={2} className="text-base font-semibold text-foreground">
            {review.space.name}
          </Text>
          {location ? (
            <Text testID={`minhas-avaliacoes-local-${review.id}`} variant="muted" numberOfLines={1}>
              {location}
            </Text>
          ) : null}
        </View>
        <Pressable
          testID={`minhas-avaliacoes-menu-${review.id}`}
          role="button"
          accessibilityLabel={`Mais opções da avaliação do ${review.space.name}`}
          onPress={menu.open}
          className="-mr-2 h-11 w-11 items-center justify-center rounded-full active:bg-accent"
        >
          <EllipsisVertical size={20} color={color(name, 'mutedForeground')} />
        </Pressable>
      </View>
      <RatingDateLine review={review} />
      <TagList tags={review.tags} />
      {review.comment ? (
        review.commentHidden ? (
          <View className="gap-1.5">
            <Text className="text-base text-muted-foreground">{review.comment}</Text>
            <HiddenCommentLine text="Oculto pela moderação: só você vê este comentário. A nota continua valendo." />
          </View>
        ) : (
          <ClampedText text={review.comment} />
        )
      ) : null}
      {review.reply ? (
        <ReplyBlock
          reply={review.reply}
          spaceName={review.space.name}
          spaceLogoUrl={review.space.logoUrl}
          indent={false}
        />
      ) : null}
      {!inShowcase ? <Text variant="muted">Este espaço não está mais no app.</Text> : null}
    </>
  );

  return (
    <>
      {inShowcase ? (
        <Pressable
          testID={`minhas-avaliacoes-item-${review.id}`}
          role="button"
          accessibilityHint={canEdit ? 'Abre a avaliação para editar' : 'Abre a sua avaliação'}
          onPress={() => onOpen(review)}
          className={cn(
            'gap-3 rounded-lg border border-border bg-card p-4 active:bg-accent',
            highlighted && 'bg-accent',
          )}
        >
          {content}
        </Pressable>
      ) : (
        <View
          testID={`minhas-avaliacoes-item-${review.id}`}
          className="gap-3 rounded-lg border border-border bg-card p-4"
        >
          {content}
        </View>
      )}
      {menu.mounted ? (
        <BottomSheet
          visible={menu.visible}
          title={review.space.name}
          onClose={menu.close}
          onDismissed={menu.onDismissed}
        >
          {canEdit ? (
            <Button
              testID={`minhas-avaliacoes-editar-${review.id}`}
              variant="outline"
              onPress={() => menu.choose('edit')}
            >
              <Text>Editar</Text>
            </Button>
          ) : null}
          {inShowcase ? (
            <Button
              testID={`minhas-avaliacoes-ver-espaco-${review.id}`}
              variant="outline"
              onPress={() => menu.choose('space')}
            >
              <Text>Ver no espaço</Text>
            </Button>
          ) : null}
          <Button
            testID={`minhas-avaliacoes-excluir-${review.id}`}
            variant="outline"
            className="border-destructive"
            onPress={() => menu.choose('delete')}
          >
            <Text className="text-destructive">Excluir</Text>
          </Button>
        </BottomSheet>
      ) : null}
    </>
  );
}

/**
 * Minhas avaliações (RF-REVIEW-08; docs/05, "(10)"), no Perfil: as avaliações da pessoa, com
 * editar (a qualquer tempo, fora da equipe), excluir e ver no espaço. Com `?avaliacao=<id>` (push
 * `review.replied`), rola até o item e o destaca por 2 s, carregando até `TARGET_MAX_PAGES` páginas
 * para achá-lo; sem achar, mostra a lista do começo.
 */
export function MyReviewsScreen() {
  const name = useThemeName();
  const router = useRouter();
  const calm = useCalmMotion();
  const { avaliacao } = useLocalSearchParams<{ avaliacao?: string }>();
  const query = useMyReviews();
  const invalidate = useInvalidateReviews();
  const remove = useDeleteMyReview();
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<FlashListRef<Item>>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const handledTarget = useRef(false);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // Vindo da resposta do espaço: carrega as páginas até achar a avaliação (com limite) e rola até ela.
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (!avaliacao || handledTarget.current || !data) return;
    const index = data.pages.flatMap((page) => page.items).findIndex((i) => i.id === avaliacao);
    if (index < 0) {
      if (hasNextPage && !isFetchNextPageError && data.pages.length < TARGET_MAX_PAGES) {
        if (!isFetchingNextPage) void fetchNextPage();
        return;
      }
      handledTarget.current = true;
      return;
    }
    handledTarget.current = true;
    setTimeout(() => listRef.current?.scrollToIndex({ index, animated: !calm }), 0);
    if (!calm) setHighlighted(avaliacao);
  }, [avaliacao, data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, calm]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => clearTimeout(timer);
  }, [highlighted]);

  const open = (review: Item) =>
    router.push({ pathname: '/espaco/[slug]/avaliar', params: { slug: review.space.slug } });

  const deleteReview = (review: Item) =>
    confirmDeleteReview(() => {
      setNotice(null);
      remove.mutate(
        { spaceId: review.spaceId },
        {
          onSuccess: () => void invalidate(review.spaceId, review.space.slug),
          onError: () => setNotice('Não foi possível excluir agora. Tente de novo.'),
        },
      );
    });

  const empty = query.isPending ? (
    <View className="gap-3" accessibilityLabel="Carregando avaliações">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 rounded-lg" />
      ))}
    </View>
  ) : query.isError ? (
    <ErrorView error={query.error} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyView
      title="Você ainda não avaliou nenhum espaço"
      description="Depois de jogar ou ter aula, a gente pede sua opinião."
    />
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Minhas avaliações" testID="minhas-avaliacoes" />
      <FlashList
        ref={listRef}
        testID="minhas-avaliacoes-lista"
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}
        ListHeaderComponent={
          notice ? (
            <View className="pb-3">
              <Notice tone="destructive" text={notice} />
            </View>
          ) : null
        }
        ListEmptyComponent={empty}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <MyReviewCard
            review={item}
            highlighted={highlighted === item.id}
            onOpen={open}
            onDelete={deleteReview}
          />
        )}
        onEndReachedThreshold={1}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
            void query.fetchNextPage();
          }
        }}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => void query.refetch()}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator color={color(name, 'primary')} />
            </View>
          ) : query.isFetchNextPageError ? (
            <Pressable
              role="button"
              onPress={() => void query.fetchNextPage()}
              className="min-h-11 items-center justify-center"
            >
              <Text className="text-link">Não foi possível carregar mais. Tentar de novo</Text>
            </Pressable>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

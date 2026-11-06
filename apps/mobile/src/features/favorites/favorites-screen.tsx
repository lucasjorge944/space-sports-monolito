import { formatCents, type SpaceCard } from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { Heart } from 'lucide-react-native';
import { FlatList, Image, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { SpaceAvatar } from '@/components/space-avatar';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { spaceHref } from './space-href';
import { useFavorites, useRemoveFavorite } from './use-favorites';

function locality(space: Pick<SpaceCard, 'neighborhood' | 'city'>): string {
  return [space.neighborhood, space.city].filter(Boolean).join(' · ');
}

function FavoriteRow({
  space,
  onOpen,
  onRemove,
}: {
  space: SpaceCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const name = useThemeName();
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Abrir ${space.name}`}
        className="min-h-11 flex-1 flex-row items-center gap-3"
      >
        {space.cover ? (
          <Image
            source={{ uri: space.cover.url }}
            accessibilityIgnoresInvertColors
            className="h-16 w-16 rounded-lg bg-muted"
          />
        ) : (
          <View className="h-16 w-16 rounded-lg bg-muted" />
        )}
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={28} />
            <Text variant="large" numberOfLines={1} className="flex-1">
              {space.name}
            </Text>
          </View>
          <Text variant="muted" numberOfLines={1}>
            {locality(space)}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {space.sports.map((sport) => sport.name).join(', ')}
            {space.pricePerHourCents > 0 ? ` · ${formatCents(space.pricePerHourCents)}/h` : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remover ${space.name} dos favoritos`}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-accent"
      >
        <Heart size={22} color={color(name, 'primary')} fill={color(name, 'primary')} />
      </Pressable>
    </View>
  );
}

/** Espaços favoritados, com remoção direta. */
export function FavoritesScreen() {
  const router = useRouter();
  const query = useFavorites();
  const remove = useRemoveFavorite();

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Favoritos" />
      {query.isPending ? (
        <LoadingView label="Carregando favoritos…" />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={query.data.items}
          keyExtractor={(space) => space.id}
          contentContainerClassName="grow gap-3 p-4"
          renderItem={({ item }) => (
            <FavoriteRow
              space={item}
              onOpen={() => router.push(spaceHref(item.slug))}
              onRemove={() => remove.mutate({ spaceId: item.id })}
            />
          )}
          ListEmptyComponent={
            <EmptyView
              title="Nenhum favorito ainda"
              description="Toque no coração de um espaço para guardá-lo aqui."
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

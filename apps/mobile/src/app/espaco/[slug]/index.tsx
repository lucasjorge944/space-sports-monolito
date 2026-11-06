import { useGetSpaceBySlug } from '@space-sports/api-client';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { SpaceAvatar } from '@/components/space-avatar';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { ClassesTab } from '@/features/classes/classes-tab';
import { spaceLocationLabel } from '@/features/discovery/space-card';
import {
  recentEntryFromSpace,
  recordRecentSpace,
  removeRecentSpace,
} from '@/features/explore/recent-spaces-store';
import { RatingHeaderLine, ReviewsBlock } from '@/features/reviews/reviews-block';
import { Gallery } from '@/features/space/gallery';
import { SERVICE_TAB_LABELS } from '@/features/space/labels';
import { QuickInfo } from '@/features/space/quick-info';
import { RentTab } from '@/features/space/rent-tab';
import { SpaceInfo } from '@/features/space/space-info';
import { isNotFound } from '@/lib/api-errors';
import { isServiceVisible } from '@/lib/features';

/** Página do espaço (RF-SPACE-08). */
export default function EspacoScreen() {
  // `avaliacoes=1` (vindo do "Ver no espaço" da tela de avaliar) rola até o bloco de avaliações.
  const { slug, avaliacoes } = useLocalSearchParams<{ slug: string; avaliacoes?: string }>();
  const query = useGetSpaceBySlug(slug, { query: { staleTime: 60_000 } });
  const [picked, setTab] = useState<'RENTAL' | 'CLASSES' | 'TOURNAMENTS' | null>(null);
  const space = query.data;
  const services = space?.services.filter(isServiceVisible) ?? [];
  // Sem escolha, abre em Alugar; espaço sem aluguel abre no primeiro serviço que tiver.
  const tab = picked ?? (services.includes('RENTAL') ? 'RENTAL' : services[0]);
  const notFound = query.isError && isNotFound(query.error);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const reviewsY = useRef<number | null>(null);
  const scrolledToReviews = useRef(false);
  const scrollToReviews = () => {
    if (reviewsY.current !== null)
      scrollRef.current?.scrollTo({ y: reviewsY.current, animated: true });
  };

  // Espaços recentes (RF-SPACE-12): a abertura entra no histórico do aparelho; 404 (removido,
  // suspenso ou fora da vitrine) tira o espaço de lá.
  useEffect(() => {
    if (space) void recordRecentSpace(recentEntryFromSpace(space));
  }, [space]);
  useEffect(() => {
    if (notFound && slug) void removeRecentSpace(slug);
  }, [notFound, slug]);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title={space?.name ?? 'Espaço'} testID="espaco-titulo" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError || !space ? (
        isNotFound(query.error) ? (
          <EmptyView title="Espaço não encontrado" description="Ele pode ter sido desativado." />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <ScrollView ref={scrollRef} contentContainerClassName="gap-5 pb-10">
          <Gallery photos={space.photos} spaceName={space.name} />
          <View className="gap-3 px-4">
            <View className="flex-row items-center gap-3">
              <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={56} />
              <View className="flex-1 gap-0.5">
                <Text variant="h3">{space.name}</Text>
                <Text variant="muted">
                  {spaceLocationLabel({
                    neighborhood: space.address.neighborhood,
                    city: space.address.city.name,
                  })}
                </Text>
              </View>
            </View>
            {/* Nota do espaço (RF-REVIEW-03): leva ao bloco "Avaliações". */}
            <RatingHeaderLine
              rating={space.rating}
              onPress={scrollToReviews}
              testID="espaco-nota"
            />
            <View className="flex-row flex-wrap gap-2">
              {space.sports.map((sport) => (
                <Badge key={sport.slug} variant="sport">
                  <Text>{sport.name}</Text>
                </Badge>
              ))}
            </View>
            <QuickInfo space={space} />
          </View>

          {tab ? (
            <View className="gap-4 px-4">
              <View
                className="flex-row flex-wrap gap-2"
                role="radiogroup"
                accessibilityLabel="Serviços"
              >
                {services.map((service) => (
                  <Chip
                    key={service}
                    testID={`espaco-servico-${service}`}
                    selected={tab === service}
                    onPress={() => setTab(service)}
                  >
                    <Text>{SERVICE_TAB_LABELS[service]}</Text>
                  </Chip>
                ))}
              </View>
              {tab === 'RENTAL' ? (
                <RentTab space={space} />
              ) : tab === 'CLASSES' ? (
                <ClassesTab space={space} />
              ) : (
                <EmptyView
                  title="Em breve no app"
                  description="Por enquanto, fale com o espaço para saber mais."
                />
              )}
            </View>
          ) : null}

          <View
            className="px-4"
            onLayout={(event) => {
              reviewsY.current = event.nativeEvent.layout.y;
              if (avaliacoes === '1' && !scrolledToReviews.current) {
                scrolledToReviews.current = true;
                scrollToReviews();
              }
            }}
          >
            <ReviewsBlock space={space} />
          </View>

          <View className="px-4">
            <SpaceInfo space={space} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

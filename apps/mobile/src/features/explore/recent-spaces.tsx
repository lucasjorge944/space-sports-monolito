import { exploreLayout } from '@space-sports/ui-tokens';
import { useRouter } from 'expo-router';
import { Image as ImageIcon } from 'lucide-react-native';
import { memo } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { RemoteImage } from '@/components/remote-image';
import { SpaceAvatar } from '@/components/space-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { spaceLocationLabel } from '@/features/discovery/space-card';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import type { RecentSpace } from './recent-spaces-store';

const RECENT = exploreLayout.recent;
const CARD_HEIGHT = 170;

/** Card compacto: foto, logo meio sobre a foto, nome e bairro · cidade. Sem distância nem preço. */
function RecentSpaceCardBase({ space }: { space: RecentSpace }) {
  const router = useRouter();
  const name = useThemeName();
  const location = spaceLocationLabel(space);
  return (
    <Pressable
      testID={`explorar-recente-${space.slug}`}
      role="link"
      accessibilityLabel={[space.name, space.neighborhood].filter(Boolean).join(', ')}
      accessibilityHint="Abre a página do espaço"
      className="overflow-hidden rounded-lg border border-border bg-card active:opacity-90"
      style={{ width: RECENT.width, height: CARD_HEIGHT }}
      onPress={() => router.push({ pathname: '/espaco/[slug]', params: { slug: space.slug } })}
    >
      {space.cover ? (
        <RemoteImage
          uri={space.cover.url}
          blurhash={space.cover.blurhash}
          style={{ width: '100%', height: RECENT.imageHeight }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          className="w-full items-center justify-center bg-muted"
          style={{ height: RECENT.imageHeight }}
        >
          <ImageIcon size={24} color={color(name, 'mutedForeground')} />
        </View>
      )}
      <View className="absolute left-3" style={{ top: RECENT.imageHeight - RECENT.logoSize / 2 }}>
        <SpaceAvatar
          name={space.name}
          logoUrl={space.logoUrl}
          size={RECENT.logoSize}
          className="border-2 border-card"
          testID={`explorar-recente-${space.slug}-logo`}
        />
      </View>
      <View className="px-3 pb-3" style={{ paddingTop: RECENT.logoSize / 2 + 4 }}>
        <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
          {space.name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted-foreground">
          {location}
        </Text>
      </View>
    </Pressable>
  );
}

const RecentSpaceCard = memo(RecentSpaceCardBase);

function SectionTitle() {
  return (
    <Text
      role="heading"
      className="px-4 font-display-semibold text-xl text-foreground"
      style={{ marginBottom: exploreLayout.sectionTitleGap }}
    >
      Espaços recentes
    </Text>
  );
}

/** Espaços recentes (RF-SPACE-12): faixa horizontal com até 10 cards compactos. */
export function RecentSpaces({ spaces, loading }: { spaces: RecentSpace[]; loading: boolean }) {
  if (loading) {
    return (
      <View testID="explorar-recentes-carregando" accessibilityLabel="Carregando espaços recentes">
        <SectionTitle />
        <View className="flex-row px-4" style={{ gap: RECENT.gap }}>
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className="rounded-lg"
              style={{ width: RECENT.width, height: CARD_HEIGHT }}
            />
          ))}
        </View>
      </View>
    );
  }
  if (spaces.length === 0) return null;
  return (
    <View testID="explorar-recentes">
      <SectionTitle />
      <FlatList
        data={spaces}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(space) => space.slug}
        contentContainerStyle={{ paddingHorizontal: 16, gap: RECENT.gap }}
        renderItem={({ item }) => <RecentSpaceCard space={item} />}
      />
    </View>
  );
}

import type { Sport } from '@space-sports/api-client';
import { exploreLayout, sportIconKey, sportIconSvg } from '@space-sports/ui-tokens';
import { useRef } from 'react';
import { ScrollView, type ScrollViewInstance, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { setFilters } from '@/features/discovery/filters-store';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

const SHORTCUT = exploreLayout.shortcut;
const SKELETON_WIDTHS = [132, 112, 140];

export function SportShortcutsSkeleton() {
  return (
    <View className="flex-row px-4" style={{ gap: SHORTCUT.gap }}>
      {SKELETON_WIDTHS.map((width) => (
        <Skeleton key={width} className="rounded-full" style={{ width, height: SHORTCUT.height }} />
      ))}
    </View>
  );
}

/**
 * Atalhos por esporte (RF-SPACE-13): chips do catálogo que aplicam o mesmo filtro de esporte dos
 * filtros e do Mapa; tocar no selecionado tira o filtro.
 */
export function SportShortcuts({ sports, selected }: { sports: Sport[]; selected: string | null }) {
  const name = useThemeName();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);

  return (
    <ScrollView
      ref={scrollRef}
      testID="explorar-atalhos"
      accessibilityLabel="Atalhos por esporte"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: SHORTCUT.gap }}
    >
      {sports.map((sport) => {
        const isSelected = selected === sport.slug;
        const key = sportIconKey(sport);
        return (
          <Chip
            key={sport.id}
            testID={`explorar-atalho-${sport.slug}`}
            role="button"
            aria-selected={isSelected}
            selected={isSelected}
            accessibilityLabel={sport.name}
            accessibilityHint={
              isSelected ? 'Toque de novo para ver todos' : 'Mostra só espaços com este esporte'
            }
            onLayout={(event) => {
              // Ao abrir com um esporte já selecionado fora da tela, rola até ele (uma vez).
              if (!isSelected || scrolled.current) return;
              scrolled.current = true;
              const x = event.nativeEvent.layout.x - 16;
              if (x > 0) scrollRef.current?.scrollTo({ x, animated: false });
            }}
            onPress={() => setFilters({ sport: isSelected ? null : sport.slug })}
          >
            {key ? (
              <SvgXml
                xml={sportIconSvg(key, {
                  color: color(name, isSelected ? 'chipSelectedForeground' : 'chipForeground'),
                })}
                width={SHORTCUT.iconSize}
                height={SHORTCUT.iconSize}
              />
            ) : null}
            <Text>{sport.name}</Text>
          </Chip>
        );
      })}
    </ScrollView>
  );
}

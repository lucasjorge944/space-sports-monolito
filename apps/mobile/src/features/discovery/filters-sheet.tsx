import { SearchSpacesService, useListAmenities, useListSports } from '@space-sports/api-client';
import { Star } from 'lucide-react-native';
import { View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { useLocation } from '@/features/location/location-provider';
import { isServiceVisible } from '@/lib/features';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  type FiltersContext,
  MIN_RATING_OPTION,
  RADIUS_OPTIONS,
  resetFilters,
  type SpaceFilters,
  setFilters,
  toggleAmenity,
} from './filters-store';
import { MIN_RATING_LABEL, sortOptions } from './labels';

const SERVICE_OPTIONS = [
  { value: SearchSpacesService.RENTAL, label: 'Aluguel' },
  { value: SearchSpacesService.CLASSES, label: 'Aulas' },
  { value: SearchSpacesService.TOURNAMENTS, label: 'Torneios' },
].filter((option) => isServiceVisible(option.value));

function Section({
  title,
  children,
  group = 'radiogroup',
}: {
  title: string;
  children: React.ReactNode;
  /** `group` para uma opção que liga e desliga sozinha (caixa de seleção). */
  group?: 'radiogroup' | 'group';
}) {
  return (
    <View className="gap-2">
      <Text variant="small">{title}</Text>
      <View className="flex-row flex-wrap gap-2" role={group} accessibilityLabel={title}>
        {children}
      </View>
    </View>
  );
}

/**
 * Filtros da vitrine (RF-SPACE-06, RF-REVIEW-10): ordem, distância, nota mínima, esporte, serviço e
 * infraestrutura. No mapa (`context: 'map'`) a ordem não aparece: lá só o "4+ estrelas" vale.
 */
export function FiltersSheet({
  visible,
  onClose,
  filters,
  context = 'list',
}: {
  visible: boolean;
  onClose: () => void;
  filters: SpaceFilters;
  context?: FiltersContext;
}) {
  const theme = useThemeName();
  const { coords } = useLocation();
  const minRatingOn = filters.minRating === MIN_RATING_OPTION;
  const starColor = color(theme, minRatingOn ? 'chipSelectedForeground' : 'chipForeground');
  const sports = useListSports({ query: { staleTime: 10 * 60_000 } });
  const amenities = useListAmenities({ query: { staleTime: 10 * 60_000 } });

  return (
    <BottomSheet visible={visible} title="Filtros" onClose={onClose}>
      {context === 'list' ? (
        <Section title="Ordenar por">
          {sortOptions(!!coords).map((option) => (
            <Chip
              key={option.value}
              testID={option.testID}
              selected={filters.sort === option.value}
              onPress={() => setFilters({ sort: option.value })}
            >
              <Text>{option.label}</Text>
            </Chip>
          ))}
        </Section>
      ) : null}
      {coords ? (
        <Section title="Distância">
          {RADIUS_OPTIONS.map((km) => (
            <Chip
              key={km}
              selected={filters.radiusKm === km}
              onPress={() => setFilters({ radiusKm: km })}
            >
              <Text>{km} km</Text>
            </Chip>
          ))}
        </Section>
      ) : null}
      <Section title="Nota" group="group">
        <Chip
          testID="filtros-nota-4"
          role="checkbox"
          aria-checked={minRatingOn}
          selected={minRatingOn}
          onPress={() => setFilters({ minRating: minRatingOn ? null : MIN_RATING_OPTION })}
        >
          {/* Na cor do texto do chip: a estrela de nota (Sol) sumiria no fundo Sol do selecionado. */}
          <Star size={16} strokeWidth={2} fill={starColor} color={starColor} aria-hidden />
          <Text>{MIN_RATING_LABEL}</Text>
        </Chip>
      </Section>
      <Section title="Esporte">
        {sports.data?.items.map((sport) => (
          <Chip
            key={sport.id}
            selected={filters.sport === sport.slug}
            onPress={() => setFilters({ sport: filters.sport === sport.slug ? null : sport.slug })}
          >
            <Text>{sport.name}</Text>
          </Chip>
        )) ?? (
          <Text variant="muted">
            {sports.isError ? 'Não foi possível carregar.' : 'Carregando…'}
          </Text>
        )}
      </Section>
      <Section title="Serviço">
        {SERVICE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            selected={filters.service === option.value}
            onPress={() =>
              setFilters({ service: filters.service === option.value ? null : option.value })
            }
          >
            <Text>{option.label}</Text>
          </Chip>
        ))}
      </Section>
      <Section title="Infraestrutura">
        {amenities.data?.items.map((amenity) => (
          <Chip
            key={amenity.id}
            selected={filters.amenities.includes(amenity.slug)}
            onPress={() =>
              setFilters({ amenities: toggleAmenity(filters.amenities, amenity.slug) })
            }
          >
            <Text>{amenity.name}</Text>
          </Chip>
        )) ?? (
          <Text variant="muted">
            {amenities.isError ? 'Não foi possível carregar.' : 'Carregando…'}
          </Text>
        )}
      </Section>
      <View className="flex-row gap-3">
        <Button
          testID="filtros-limpar"
          variant="outline"
          className="flex-1"
          onPress={() => resetFilters(context)}
        >
          <Text>Limpar</Text>
        </Button>
        <Button testID="filtros-ver-espacos" className="flex-1" onPress={onClose}>
          <Text>Ver espaços</Text>
        </Button>
      </View>
    </BottomSheet>
  );
}

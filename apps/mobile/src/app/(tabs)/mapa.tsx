import { formatCents } from '@space-sports/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { SpaceAvatar } from '@/components/space-avatar';
import { ErrorView } from '@/components/state-views';
import { Text } from '@/components/ui/text';
import { useFilters } from '@/features/discovery/filters-store';
import { mapEmptyMessage } from '@/features/discovery/labels';
import { SearchHeader } from '@/features/discovery/search-header';
import { buildSearchParams } from '@/features/discovery/search-params';
import { spaceLocationLabel } from '@/features/discovery/space-card';
import { useSpacesSearch } from '@/features/discovery/use-spaces-search';
import { LocationBanner } from '@/features/location/location-banner';
import { useLocation } from '@/features/location/location-provider';
import { ratingSpoken } from '@/features/reviews/format';
import { RatingLocationLine } from '@/features/reviews/rating-badge';
import { formatDistance } from '@/lib/datetime';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** Região inicial sem localização nem resultados: Belo Horizonte, cidade dos espaços piloto. */
const FALLBACK_REGION: Region = {
  latitude: -19.9208,
  longitude: -43.9378,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};
const MAP_LIMIT = 50;

/** Mapa com pins dos espaços (RF-SPACE-07), com os mesmos filtros e busca da vitrine. */
export default function MapaScreen() {
  const router = useRouter();
  const filters = useFilters();
  const { coords } = useLocation();
  const debouncedQ = useDebouncedValue(filters.q);
  const params = useMemo(
    // No mapa, a ordem não vale: só o "4+ estrelas" (decisão 109).
    () => buildSearchParams(filters, coords, debouncedQ, { limit: MAP_LIMIT, context: 'map' }),
    [filters, coords, debouncedQ],
  );
  const search = useSpacesSearch(params);
  const mapRef = useRef<MapView>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const located = useMemo(
    () => search.items.filter((space) => space.location !== null),
    [search.items],
  );
  const selected = located.find((space) => space.id === selectedId) ?? null;

  // Enquadra os pins quando o resultado muda; sem pins, centraliza em quem pediu.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (located.length > 0) {
      map.fitToCoordinates(
        located.map((space) => ({
          latitude: space.location?.lat ?? 0,
          longitude: space.location?.lng ?? 0,
        })),
        { edgePadding: { top: 120, right: 60, bottom: 160, left: 60 }, animated: true },
      );
    } else if (coords) {
      map.animateToRegion(
        { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.1, longitudeDelta: 0.1 },
        300,
      );
    }
  }, [located, coords]);

  return (
    <View className="flex-1 bg-background">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={FALLBACK_REGION}
        showsUserLocation={coords !== null}
        onPress={() => setSelectedId(null)}
      >
        {located.map((space) => (
          <Marker
            key={space.id}
            coordinate={{ latitude: space.location?.lat ?? 0, longitude: space.location?.lng ?? 0 }}
            title={space.name}
            description={`${formatCents(space.pricePerHourCents)}/h`}
            onPress={() => setSelectedId(space.id)}
          />
        ))}
      </MapView>
      <View className="absolute inset-x-0 top-0 gap-2 px-4 pt-2">
        <SearchHeader filters={filters} context="map" />
        <LocationBanner />
      </View>
      <View className="absolute inset-x-0 bottom-4 gap-2 px-4">
        {search.isError && located.length === 0 ? (
          <View className="rounded-lg border border-border bg-card">
            <ErrorView error={search.error} onRetry={() => void search.refetch()} />
          </View>
        ) : null}
        {!search.isPending && !search.isError && located.length === 0 ? (
          <View className="rounded-lg border border-border bg-card p-4">
            <Text testID="mapa-vazio" variant="muted" className="text-center">
              {mapEmptyMessage(filters.minRating !== null)}
            </Text>
          </View>
        ) : null}
        {selected ? (
          <Pressable
            role="link"
            testID="mapa-callout"
            accessibilityLabel={`${selected.name}, ${ratingSpoken(selected.rating).replace(/^N/, 'n')}, ${formatCents(selected.pricePerHourCents)} por hora. Abrir página do espaço`}
            className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 active:bg-accent"
            onPress={() =>
              router.push({ pathname: '/espaco/[slug]', params: { slug: selected.slug } })
            }
          >
            <SpaceAvatar name={selected.name} logoUrl={selected.logoUrl} size={48} />
            <View className="flex-1 gap-1">
              <Text variant="large" numberOfLines={1}>
                {selected.name}
              </Text>
              <RatingLocationLine
                rating={selected.rating}
                location={[
                  spaceLocationLabel(selected),
                  selected.distanceMeters === null ? null : formatDistance(selected.distanceMeters),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <Text variant="price">{formatCents(selected.pricePerHourCents)}/h</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

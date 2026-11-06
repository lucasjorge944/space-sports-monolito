import { type PlayerBookingDetail, useGetSpaceBySlug } from '@space-sports/api-client';
import { CalendarPlus, MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { mapsUrl, openLink } from '@/features/space/links';
import { formatAddress } from '@/features/space/space-format';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { addBookingToCalendar, canAddToCalendar } from './calendar';

/**
 * "Adicionar ao calendário" e "Como chegar" do detalhe da reserva (RF-BOOK-03). Endereço e
 * coordenadas vêm da página pública do espaço; sem coordenadas o botão de mapa some.
 */
export function BookingActions({ booking }: { booking: PlayerBookingDetail }) {
  const name = useThemeName();
  const [error, setError] = useState<string | null>(null);
  const space = useGetSpaceBySlug(booking.space.slug, { query: { staleTime: 5 * 60_000 } });
  const address = space.data ? formatAddress(space.data.address) : null;
  // Sem coordenadas cadastradas não há rota (nunca inventamos localização).
  const location = space.data?.location ?? null;
  const calendar = canAddToCalendar(booking);
  if (!calendar && !location) return null;

  const addToCalendar = async () => {
    setError(null);
    try {
      await addBookingToCalendar(booking, address || null);
    } catch {
      setError('Não foi possível abrir o calendário neste aparelho.');
    }
  };

  const openMaps = async () => {
    if (!location) return;
    setError(null);
    if (!(await openLink(mapsUrl(location, booking.space.name)))) {
      setError('Não foi possível abrir o mapa neste aparelho.');
    }
  };

  return (
    <View className="gap-2">
      {calendar ? (
        <Button variant="outline" onPress={() => void addToCalendar()}>
          <CalendarPlus size={18} color={color(name, 'foreground')} />
          <Text>Adicionar ao calendário</Text>
        </Button>
      ) : null}
      {location ? (
        <Button variant="outline" onPress={() => void openMaps()}>
          <MapPin size={18} color={color(name, 'foreground')} />
          <Text>Como chegar</Text>
        </Button>
      ) : null}
      <InlineError message={error} />
    </View>
  );
}

import type { PublicSpace } from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { CalendarRange, CalendarX, Hourglass, type LucideIcon, Wallet } from 'lucide-react-native';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { formatDuration } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { SpaceSection } from './space-section';

function RuleRow({
  icon: Icon,
  label,
  value,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  testID?: string;
}) {
  const name = useThemeName();
  return (
    <View className="flex-row items-center gap-3">
      <Icon size={18} color={color(name, 'mutedForeground')} aria-hidden />
      <Text variant="muted" className="flex-1">
        {label}
      </Text>
      <Text className="font-medium tabular-nums" testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/** Texto do prazo de cancelamento (RN-BOOK-05): 120 → "até 2h antes", 1440 → "até 24h antes". */
export function cancellationLabel(minutes: number): string {
  return minutes <= 0 ? 'até o início' : `até ${formatDuration(minutes)} antes`;
}

/** "Coberta · Futevôlei, Beach Tennis": descoberta não aparece, porque nem sempre foi informada. */
function courtDetail(court: PublicSpace['courts'][number]): string {
  return [court.covered ? 'Coberta' : null, court.sports.map((s) => s.name).join(', ')]
    .filter(Boolean)
    .join(' · ');
}

/** Aba "Alugar" (RF-SPACE-08): entrada para reservar ou virar mensalista, regras e quadras. */
export function RentTab({ space }: { space: PublicSpace }) {
  const router = useRouter();
  const { rental } = space;
  const bookable = space.courts.length > 0 && space.sports.length > 0;

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Button
          testID="espaco-reservar"
          size="lg"
          disabled={!bookable}
          onPress={() =>
            router.push({ pathname: '/espaco/[slug]/reservar', params: { slug: space.slug } })
          }
        >
          <Text>Reservar um horário</Text>
        </Button>
        <Button
          testID="espaco-mensalista"
          size="lg"
          variant="outline"
          disabled={!bookable}
          onPress={() =>
            router.push({ pathname: '/espaco/[slug]/mensalista', params: { slug: space.slug } })
          }
        >
          <Text>Quero ser mensalista</Text>
        </Button>
        {!bookable ? (
          <Text variant="muted">Este espaço ainda não tem quadras disponíveis para reserva.</Text>
        ) : null}
      </View>

      <SpaceSection title="Regras">
        <Card>
          <RuleRow
            icon={CalendarX}
            label="Cancelamento"
            value={cancellationLabel(rental.cancellationDeadlineMin)}
            testID="espaco-cancelamento-prazo"
          />
          {rental.windowDays > 0 ? (
            <RuleRow
              icon={CalendarRange}
              label="Reserve com até"
              value={`${rental.windowDays} dias`}
            />
          ) : null}
          {rental.minAdvanceMin > 0 ? (
            <RuleRow
              icon={Hourglass}
              label="Antecedência mínima"
              value={formatDuration(rental.minAdvanceMin)}
            />
          ) : null}
          <RuleRow icon={Wallet} label="Pagamento" value="no espaço" />
        </Card>
      </SpaceSection>

      {space.courts.length > 0 ? (
        <SpaceSection title="Quadras">
          <Card>
            {space.courts.map((court) => (
              <View key={court.id} className="gap-0.5">
                <Text className="font-medium">{court.name}</Text>
                {courtDetail(court) ? <Text variant="muted">{courtDetail(court)}</Text> : null}
              </View>
            ))}
          </Card>
        </SpaceSection>
      ) : null}
    </View>
  );
}

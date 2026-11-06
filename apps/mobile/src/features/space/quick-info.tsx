import type { PublicSpace } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { Banknote, Clock, LandPlot, type LucideIcon, Timer } from 'lucide-react-native';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { formatDuration } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { todayOpeningRange } from './space-format';

function QuickItem({
  icon: Icon,
  value,
  label,
  price,
  testID,
}: {
  icon: LucideIcon;
  value: string;
  label?: string;
  price?: boolean;
  testID?: string;
}) {
  const name = useThemeName();
  return (
    <View className="min-w-[45%] flex-1 flex-row items-center gap-3 rounded-lg border border-border bg-card p-3">
      <Icon size={20} color={color(name, 'primary')} aria-hidden />
      <View className="flex-1 gap-0.5">
        <Text
          variant={price ? 'price' : 'default'}
          className={price ? undefined : 'font-medium tabular-nums'}
          numberOfLines={1}
          testID={testID}
        >
          {value}
        </Text>
        {label ? (
          <Text variant="muted" numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "1h a 3h", ou "1h" quando a duração é fixa. */
export function durationRangeLabel(rental: PublicSpace['rental']): string {
  const min = formatDuration(rental.minDurationMin);
  return rental.minDurationMin === rental.maxDurationMin
    ? min
    : `${min} a ${formatDuration(rental.maxDurationMin)}`;
}

/** Grade de informações rápidas da página do espaço: só o que estiver preenchido (doc 08). */
export function QuickInfo({ space }: { space: PublicSpace }) {
  const { rental, courts, openingHours } = space;
  const rents = space.services.includes('RENTAL');
  const covered = courts.filter((court) => court.covered).length;
  return (
    <View className="flex-row flex-wrap gap-2">
      {rents && rental.pricePerHourCents > 0 ? (
        <QuickItem
          icon={Banknote}
          value={formatCents(rental.pricePerHourCents)}
          label="por hora"
          testID="espaco-preco-hora"
          price
        />
      ) : null}
      {courts.length > 0 ? (
        <QuickItem
          icon={LandPlot}
          value={plural(courts.length, 'quadra', 'quadras')}
          label={covered > 0 ? plural(covered, 'coberta', 'cobertas') : undefined}
        />
      ) : null}
      {openingHours.length > 0 ? (
        <QuickItem icon={Clock} value={todayOpeningRange(openingHours) ?? 'Fechado'} label="hoje" />
      ) : null}
      {rents && rental.minDurationMin > 0 ? (
        <QuickItem icon={Timer} value={durationRangeLabel(rental)} label="por reserva" />
      ) : null}
    </View>
  );
}

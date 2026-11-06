import type { OpeningHour } from '@space-sports/api-client';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { groupOpeningHours, todayOpeningRange } from './space-format';

/** Horários em bloco recolhível: fechado, mostra só o de hoje. */
export function OpeningHours({ hours }: { hours: OpeningHour[] }) {
  const name = useThemeName();
  const [open, setOpen] = useState(false);
  const groups = groupOpeningHours(hours);
  if (groups.length === 0) return null;
  const today = todayOpeningRange(hours);
  const summary = today ? `Hoje: ${today}` : 'Fechado hoje';
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-card">
      <Pressable
        testID="espaco-horarios"
        role="button"
        accessibilityLabel={`Horários. ${summary}`}
        accessibilityState={{ expanded: open }}
        className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent"
        onPress={() => setOpen(!open)}
      >
        <Clock size={20} color={color(name, 'primary')} aria-hidden />
        <View className="flex-1 gap-0.5">
          <Text className="font-medium">Horários</Text>
          <Text variant="muted" className="tabular-nums">
            {summary}
          </Text>
        </View>
        <Chevron size={20} color={color(name, 'mutedForeground')} aria-hidden />
      </Pressable>
      {open ? (
        <View className="gap-2 border-t border-border px-4 py-3" testID="espaco-horarios-lista">
          {groups.map((group) => (
            <View key={group.days} className="flex-row justify-between gap-3">
              <Text>{group.days}</Text>
              <Text className="tabular-nums">{group.range}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

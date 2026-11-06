import { ChevronRight, Users } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

/** Cartão de aula ou reserva da visão de equipe: horário em destaque e toque para ver tudo. */
export function StaffCard({
  testID,
  accessibilityLabel,
  startTime,
  endTime,
  title,
  lines,
  occupancy,
  status,
  onPress,
}: {
  testID: string;
  accessibilityLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  lines: string[];
  occupancy: string;
  status: { label: string; variant: BadgeVariant };
  onPress: () => void;
}) {
  const name = useThemeName();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityHint="Abre os detalhes"
      accessibilityLabel={accessibilityLabel}
      className="min-h-11 flex-row gap-3 rounded-lg border border-border bg-background p-3 active:bg-accent"
      onPress={onPress}
    >
      <View className="w-14 gap-0.5">
        <Text variant="large" className="tabular-nums">
          {startTime}
        </Text>
        <Text variant="muted" className="tabular-nums">
          {endTime}
        </Text>
      </View>
      <View className="flex-1 gap-1">
        <Text className="font-medium" numberOfLines={2}>
          {title}
        </Text>
        {lines.map((line) => (
          <Text key={line} variant="muted" numberOfLines={1}>
            {line}
          </Text>
        ))}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={status.variant}>
            <Text>{status.label}</Text>
          </Badge>
          <View className="flex-row items-center gap-1">
            <Users size={14} color={color(name, 'mutedForeground')} aria-hidden />
            <Text variant="muted" className="tabular-nums">
              {occupancy}
            </Text>
          </View>
        </View>
      </View>
      <View className="justify-center">
        <ChevronRight size={18} color={color(name, 'mutedForeground')} aria-hidden />
      </View>
    </Pressable>
  );
}

/** Linha rótulo e valor dos sheets da equipe. */
export function DetailRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View className="flex-row justify-between gap-4" testID={testID}>
      <Text variant="muted">{label}</Text>
      <Text className="flex-1 text-right">{value}</Text>
    </View>
  );
}

/** Rodapé dos sheets: decisão 21. */
export function ReadOnlyNote() {
  return (
    <Text variant="muted" className="text-center">
      Visualização somente leitura. Para alterar, use o painel no navegador.
    </Text>
  );
}

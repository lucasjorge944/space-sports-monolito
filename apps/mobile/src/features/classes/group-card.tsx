import { View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { formatDuration, WEEKDAY_NAMES } from '@/lib/datetime';
import { CLASS_LEVEL_LABELS, teachersSummary } from './labels';
import { spotsLabel } from './selection';

interface GroupInfo {
  name: string;
  level: keyof typeof CLASS_LEVEL_LABELS | null;
  weekday: number;
  startTime: string;
  durationMin: number;
  court: { name: string };
  teachers: { name: string }[];
}

/** Linhas de texto de uma turma: nome/nível, dia e horário, quadra e professores. */
export function GroupSummary({
  group,
  availableSpots,
}: {
  group: GroupInfo;
  availableSpots?: number;
}) {
  const teachers = teachersSummary(group.teachers);
  return (
    <View className="gap-0.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-medium" numberOfLines={2}>
          {group.name}
          {group.level ? ` · ${CLASS_LEVEL_LABELS[group.level]}` : ''}
        </Text>
        {availableSpots !== undefined ? (
          <Badge variant={availableSpots > 0 ? 'info' : 'destructive'}>
            <Text>{spotsLabel(availableSpots)}</Text>
          </Badge>
        ) : null}
      </View>
      <Text variant="muted">
        {WEEKDAY_NAMES[group.weekday]}, {group.startTime.slice(0, 5)} ·{' '}
        {formatDuration(group.durationMin)}
      </Text>
      <Text variant="muted">
        {group.court.name}
        {teachers ? ` · ${teachers}` : ''}
      </Text>
    </View>
  );
}

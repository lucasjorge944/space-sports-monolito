import {
  type MyClassSessionsResponseItemsItem,
  useListMyClassSessions,
} from '@space-sports/api-client';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { formatDate, formatDayLong, formatTime, todayIn } from '@/lib/datetime';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { SESSION_STATUS_LABELS, teachersSummary } from './labels';
import { groupSessionsByDay, myAttendanceLabel, occupancyLabel, weekRange } from './sessions';

/** A lista de aulas gera sessões com 4 semanas de antecedência; olha 1 semana para trás (histórico). */
const MIN_OFFSET = -1;
const MAX_OFFSET = 3;

function SessionRow({ session }: { session: MyClassSessionsResponseItemsItem }) {
  const router = useRouter();
  const zone = session.space.timeZone;
  const status = SESSION_STATUS_LABELS[session.status];
  const mine = myAttendanceLabel(session.myAttendance, session.status);
  return (
    <Pressable
      testID={`aula-item-${session.id}`}
      role="link"
      accessibilityLabel={`${session.classGroup.name}, ${formatTime(session.startsAt, zone)}, ${status.label}${mine ? `, ${mine}` : ''}`}
      className="gap-1 rounded-lg border border-border bg-card p-4 active:bg-accent"
      onPress={() => router.push({ pathname: '/aulas/[id]', params: { id: session.id } })}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="large" className="flex-1 tabular-nums">
          {formatTime(session.startsAt, zone)} – {formatTime(session.endsAt, zone)}
        </Text>
        <Badge variant={status.variant}>
          <Text>{status.label}</Text>
        </Badge>
      </View>
      <Text className="font-medium" numberOfLines={1}>
        {session.classGroup.name}
      </Text>
      <Text variant="muted" numberOfLines={1}>
        {[session.space.name, session.court.name, teachersSummary(session.teachers)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="muted">{occupancyLabel(session)}</Text>
        {mine ? (
          <Text
            className={
              session.status === 'CANCELLED'
                ? 'text-sm text-destructive'
                : session.myAttendance?.status === 'WAITLIST'
                  ? 'text-sm text-warning-subtle-foreground'
                  : 'text-sm text-success-subtle-foreground'
            }
            testID={`aula-minha-${session.id}`}
          >
            {mine}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Agenda → Aulas: as aulas das minhas turmas por semana (RF-CLASS-08). */
export function MyClassesSection() {
  const name = useThemeName();
  const [offset, setOffset] = useState(0);
  const range = weekRange(todayIn(), offset);
  const query = useListMyClassSessions(range);
  const days = groupSessionsByDay(query.data?.items ?? []);

  const arrow = (delta: -1 | 1, disabled: boolean, label: string, testID: string) => {
    const Icon = delta < 0 ? ChevronLeft : ChevronRight;
    return (
      <Pressable
        testID={testID}
        role="button"
        accessibilityLabel={label}
        disabled={disabled}
        hitSlop={4}
        className={`h-11 w-11 items-center justify-center rounded-full active:bg-accent ${disabled ? 'opacity-40' : ''}`}
        onPress={() => setOffset((current) => current + delta)}
      >
        <Icon size={22} color={color(name, 'foreground')} />
      </Pressable>
    );
  };

  return (
    <View className="flex-1 gap-3" testID="agenda-aulas">
      <View className="flex-row items-center justify-between">
        {arrow(-1, offset <= MIN_OFFSET, 'Semana anterior', 'aulas-semana-anterior')}
        <Text className="font-medium" testID="aulas-semana-titulo">
          {offset === 0 ? 'Esta semana' : `${formatDate(range.from)} a ${formatDate(range.to)}`}
        </Text>
        {arrow(1, offset >= MAX_OFFSET, 'Próxima semana', 'aulas-semana-proxima')}
      </View>

      {query.isPending ? (
        <LoadingView label="Carregando aulas…" />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : days.length === 0 ? (
        <EmptyView
          title="Nenhuma aula nesta semana"
          description="Suas aulas aparecem aqui quando você tem um plano aprovado. Veja a aba Aulas na página de um espaço."
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-4 pb-6"
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        >
          {days.map((day) => (
            <View key={day.date} className="gap-2" testID={`aulas-dia-${day.date}`}>
              <Text variant="small" role="heading">
                {formatDayLong(day.date)}
              </Text>
              {day.items.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

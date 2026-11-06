import type { StaffSpacesResponseItemsItem } from '@space-sports/api-client';
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  ATTENDEE_STATUS_LABELS,
  SESSION_STATUS_LABELS,
  teachersFull,
  teachersSummary,
} from '@/features/classes/labels';
import { formatTime } from '@/lib/datetime';
import { DetailRow, ReadOnlyNote, StaffCard } from './staff-card';

type TodaySession = StaffSpacesResponseItemsItem['today']['classSessions'][number];
type Attendee = TodaySession['attendees'][number];

/** Quem ocupa vaga primeiro (confirmados, presentes e faltas); a espera por posição; sem desistências. */
export function sortAttendees(attendees: Attendee[]): Attendee[] {
  return attendees
    .filter((a) => a.status !== 'CANCELLED')
    .sort((a, b) => {
      const aWait = a.status === 'WAITLIST';
      const bWait = b.status === 'WAITLIST';
      if (aWait !== bWait) return aWait ? 1 : -1;
      if (aWait && bWait) return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
      return a.name.localeCompare(b.name, 'pt-BR');
    });
}

function attendeeLabel(attendee: Attendee): string {
  const base = ATTENDEE_STATUS_LABELS[attendee.status].label;
  return attendee.status === 'WAITLIST' && attendee.waitlistPosition
    ? `${base} (${attendee.waitlistPosition}º)`
    : base;
}

function occupancyLabel(session: TodaySession): string {
  const waiting = session.waitlistCount > 0 ? ` · ${session.waitlistCount} na espera` : '';
  return `${session.confirmedCount}/${session.capacity} vagas${waiting}`;
}

function AttendeeList({
  title,
  testID,
  attendees,
  empty,
}: {
  title: string;
  testID: string;
  attendees: Attendee[];
  empty: string;
}) {
  return (
    <View className="gap-1" testID={testID}>
      <Text variant="small" role="heading">
        {title} ({attendees.length})
      </Text>
      {attendees.length === 0 ? (
        <Text variant="muted">{empty}</Text>
      ) : (
        attendees.map((attendee) => (
          <View key={attendee.userId} className="flex-row items-center justify-between gap-3 py-1">
            <Text className="flex-1" numberOfLines={1}>
              {attendee.name}
            </Text>
            <Badge variant={ATTENDEE_STATUS_LABELS[attendee.status].variant}>
              <Text>{attendeeLabel(attendee)}</Text>
            </Badge>
          </View>
        ))
      )}
    </View>
  );
}

function SessionSheet({
  session,
  timeZone,
  onClose,
}: {
  session: TodaySession | null;
  timeZone: string;
  onClose: () => void;
}) {
  const attendees = session ? sortAttendees(session.attendees) : [];
  return (
    <BottomSheet
      visible={session !== null}
      title={session?.classGroup.name ?? 'Aula'}
      onClose={onClose}
    >
      {session ? (
        <>
          <Badge variant={SESSION_STATUS_LABELS[session.status].variant}>
            <Text>{SESSION_STATUS_LABELS[session.status].label}</Text>
          </Badge>
          <View className="gap-1">
            <DetailRow
              label="Horário"
              value={`${formatTime(session.startsAt, timeZone)} – ${formatTime(session.endsAt, timeZone)}`}
            />
            <DetailRow label="Quadra" value={session.court.name} />
            <DetailRow label="Esporte" value={session.sportName} />
            <DetailRow
              label={session.teachers.length === 1 ? 'Professor' : 'Professores'}
              testID="equipe-aula-professores"
              value={teachersFull(session.teachers) || 'Sem professor definido'}
            />
            <DetailRow label="Ocupação" value={occupancyLabel(session)} />
          </View>
          <AttendeeList
            title="Confirmados"
            testID="equipe-aula-confirmados"
            attendees={attendees.filter((a) => a.status !== 'WAITLIST')}
            empty="Ninguém confirmou ainda."
          />
          <AttendeeList
            title="Lista de espera"
            testID="equipe-aula-espera"
            attendees={attendees.filter((a) => a.status === 'WAITLIST')}
            empty="Ninguém na espera."
          />
          <ReadOnlyNote />
        </>
      ) : null}
    </BottomSheet>
  );
}

/** Aulas de hoje do espaço, somente leitura (RN-AUTH-04): horários, listas e presenças, sem valores. */
export function StaffClassesCard({ item }: { item: StaffSpacesResponseItemsItem }) {
  const sessions = item.today.classSessions;
  const zone = item.space.timeZone;
  const [openId, setOpenId] = useState<string | null>(null);
  // Pelo id: a lista pode mudar por trás da folha.
  const open = sessions.find((session) => session.id === openId) ?? null;
  return (
    <Card testID="equipe-aulas">
      <Text variant="large">Aulas de hoje</Text>
      {sessions.length === 0 ? (
        <Text variant="muted">Nenhuma aula para hoje.</Text>
      ) : (
        <View className="gap-2">
          {sessions.map((session) => {
            const status = SESSION_STATUS_LABELS[session.status];
            const teachers = teachersSummary(session.teachers);
            const occupancy = occupancyLabel(session);
            return (
              <StaffCard
                key={session.id}
                testID={`equipe-aula-${session.id}`}
                accessibilityLabel={`${session.classGroup.name}, ${formatTime(session.startsAt, zone)}, ${session.court.name}, ${status.label}, ${occupancy}`}
                startTime={formatTime(session.startsAt, zone)}
                endTime={formatTime(session.endsAt, zone)}
                title={session.classGroup.name}
                lines={[
                  `${session.court.name} · ${session.sportName}`,
                  ...(teachers ? [teachers] : []),
                ]}
                occupancy={occupancy}
                status={status}
                onPress={() => setOpenId(session.id)}
              />
            );
          })}
        </View>
      )}
      <SessionSheet session={open} timeZone={zone} onClose={() => setOpenId(null)} />
    </Card>
  );
}

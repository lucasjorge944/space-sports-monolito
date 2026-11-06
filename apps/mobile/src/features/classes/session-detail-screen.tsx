import {
  getGetMyClassSessionQueryKey,
  type MyClassSessionDetail,
  useConfirmMyClassSession,
  useGetMyClassSession,
  useWithdrawMyClassSession,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useMe } from '@/features/auth/session';
import { endedWithinReviewWindow, ReviewPromptCard } from '@/features/reviews/review-prompt-card';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatBookingWhen, formatDateTime } from '@/lib/datetime';
import {
  blockedReasonText,
  CLASS_LEVEL_LABELS,
  SESSION_STATUS_LABELS,
  teachersFull,
} from './labels';
import { occupancyLabel } from './sessions';

/** O que dizer ao aluno sobre a vaga dele nesta aula. */
export function attendanceNotice(session: MyClassSessionDetail): string | null {
  const mine = session.myAttendance;
  if (!mine) return null;
  if (session.status === 'CANCELLED') return 'Aula cancelada.';
  switch (mine.status) {
    case 'CONFIRMED':
      return 'Sua presença está confirmada.';
    case 'WAITLIST':
      return mine.waitlistPosition
        ? `Você está na lista de espera: ${mine.waitlistPosition}º da fila. Se uma vaga abrir, você é confirmado automaticamente.`
        : 'Você está na lista de espera.';
    case 'PRESENT':
      return 'Você esteve presente nesta aula.';
    case 'ABSENT':
      return 'Você foi marcado como ausente nesta aula.';
    default:
      return null;
  }
}

/**
 * Detalhe da aula (RF-CLASS-08, RN-CLASS-03/05/06/08): professores, horário, quadra, status da lista,
 * confirmados e posição na espera; confirmar e desistir enquanto a lista estiver aberta. Os
 * bloqueios (fim do acesso, atraso, prazo) vêm do `blockedReason` e dos códigos de erro da API.
 */
export function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useGetMyClassSession(id);
  const [notice, setNotice] = useState<string | null>(null);
  const session = query.data;

  const onDone = (updated: MyClassSessionDetail) => {
    queryClient.setQueryData(getGetMyClassSessionQueryKey(id), updated);
    void queryClient.invalidateQueries({ queryKey: ['/v1/me/class-sessions'] });
    setNotice(null);
  };
  const onFailed = (error: unknown) => {
    setNotice(errorMessage(error));
    // Lista fechou, o acesso ao plano acabou ou o prazo passou: mostra o estado real.
    void queryClient.invalidateQueries({ queryKey: getGetMyClassSessionQueryKey(id) });
  };
  const confirm = useConfirmMyClassSession({ mutation: { onSuccess: onDone, onError: onFailed } });
  const withdraw = useWithdrawMyClassSession({
    mutation: { onSuccess: onDone, onError: onFailed },
  });
  const busy = confirm.isPending || withdraw.isPending;

  const confirmWithdraw = (item: MyClassSessionDetail) => {
    const waiting = item.myAttendance?.status === 'WAITLIST';
    Alert.alert(
      waiting ? 'Sair da lista de espera?' : 'Desistir da aula?',
      waiting
        ? 'Você perde a sua posição na fila.'
        : 'A sua vaga vai para o primeiro da lista de espera. Se voltar, entra no fim da fila.',
      [
        { text: 'Manter', style: 'cancel' },
        {
          text: waiting ? 'Sair da espera' : 'Desistir',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            withdraw.mutate({ sessionId: id });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title="Aula" testID="aula-titulo" />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError || !session ? (
        isNotFound(query.error) ? (
          <EmptyView title="Aula não encontrada" description="Ela pode ter sido removida." />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <ScrollView
          contentContainerClassName="gap-4 p-4 pb-10"
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        >
          <SessionBody
            session={session}
            userId={me.id}
            busy={busy}
            notice={notice}
            onConfirm={() => {
              setNotice(null);
              confirm.mutate({ sessionId: id });
            }}
            onWithdraw={() => confirmWithdraw(session)}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SessionBody({
  session,
  userId,
  busy,
  notice,
  onConfirm,
  onWithdraw,
}: {
  session: MyClassSessionDetail;
  userId: string;
  busy: boolean;
  notice: string | null;
  onConfirm: () => void;
  onWithdraw: () => void;
}) {
  const zone = session.space.timeZone;
  const status = SESSION_STATUS_LABELS[session.status];
  const mine = attendanceNotice(session);
  const confirmedAttendance = session.myAttendance?.status === 'CONFIRMED';

  return (
    <>
      <Card>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="large" className="flex-1" numberOfLines={2}>
            {session.classGroup.name}
            {session.level ? ` · ${CLASS_LEVEL_LABELS[session.level]}` : ''}
          </Text>
          <Badge variant={status.variant} testID="aula-status">
            <Text>{status.label}</Text>
          </Badge>
        </View>
        <Text testID="aula-quando">
          {formatBookingWhen(session.startsAt, session.endsAt, zone)}
        </Text>
        <Text variant="muted">
          {session.space.name} · {session.court.name}
        </Text>
        {session.teachers.length > 0 ? (
          <Text variant="muted" testID="aula-professor">
            {session.teachers.length === 1 ? 'Professor' : 'Professores'}:{' '}
            {teachersFull(session.teachers)}
          </Text>
        ) : null}
        <Text variant="muted">{status.hint}</Text>
        {session.status === 'CANCELLED' && session.cancelReason ? (
          <Text testID="aula-motivo">Motivo: {session.cancelReason}</Text>
        ) : null}
      </Card>

      {/* Avalie sua experiência (RF-REVIEW-02): aula não cancelada, com presença, terminada há até 6 meses. */}
      {session.status !== 'CANCELLED' &&
      (session.myAttendance?.status === 'CONFIRMED' ||
        session.myAttendance?.status === 'PRESENT') &&
      endedWithinReviewWindow(session.endsAt) ? (
        <ReviewPromptCard space={session.space} kind="class" testID="aula-avaliacao" />
      ) : null}

      <Card>
        <Text variant="large">Sua vaga</Text>
        {mine ? <Text testID="aula-minha-situacao">{mine}</Text> : null}
        {!mine && !session.canConfirm ? (
          <Text variant="muted" testID="aula-bloqueio">
            {blockedReasonText(session) ?? 'Você não está na lista desta aula.'}
          </Text>
        ) : null}
        {!mine && session.canConfirm ? (
          <Text variant="muted">Você ainda não confirmou presença nesta aula.</Text>
        ) : null}
        {confirmedAttendance && session.canWithdraw ? (
          <Text variant="muted" testID="aula-prazo">
            Você pode desistir até {formatDateTime(session.cancellableUntil, zone)}.
          </Text>
        ) : null}
        {confirmedAttendance && !session.canWithdraw && session.status === 'OPEN' ? (
          <Text variant="muted" testID="aula-prazo-encerrado">
            O prazo para desistir acabou ({formatDateTime(session.cancellableUntil, zone)}). Fale
            com o espaço.
          </Text>
        ) : null}
        <InlineError message={notice} />
        {session.canConfirm ? (
          <Button testID="aula-confirmar" size="lg" disabled={busy} onPress={onConfirm}>
            <Text>
              {busy
                ? 'Enviando…'
                : session.confirmedCount >= session.capacity
                  ? 'Entrar na lista de espera'
                  : 'Confirmar presença'}
            </Text>
          </Button>
        ) : null}
        {session.canWithdraw ? (
          <Button testID="aula-desistir" variant="outline" disabled={busy} onPress={onWithdraw}>
            <Text>
              {busy
                ? 'Enviando…'
                : session.myAttendance?.status === 'WAITLIST'
                  ? 'Sair da lista de espera'
                  : 'Desistir da aula'}
            </Text>
          </Button>
        ) : null}
      </Card>

      <Card>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="large">Lista confirmada</Text>
          <Text variant="muted" testID="aula-ocupacao">
            {occupancyLabel(session)}
          </Text>
        </View>
        {session.confirmed.length === 0 ? (
          <Text variant="muted" testID="aula-lista-vazia">
            Ninguém confirmou ainda.
          </Text>
        ) : (
          session.confirmed.map((person) => (
            <Text key={person.userId} testID={`aula-confirmado-${person.userId}`}>
              {person.name}
              {person.userId === userId ? ' (você)' : ''}
            </Text>
          ))
        )}
        {session.waitlistCount > 0 ? (
          <Text variant="muted" testID="aula-espera">
            Na lista de espera: {session.waitlistCount}
          </Text>
        ) : null}
      </Card>
    </>
  );
}

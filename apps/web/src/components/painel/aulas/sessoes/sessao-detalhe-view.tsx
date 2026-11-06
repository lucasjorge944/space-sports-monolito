'use client';

import {
  type ClassSessionDetail,
  useAddClassSessionAttendee,
  useCloseClassSession,
  useGetClassSession,
  useMarkClassSessionPresence,
  useOpenClassSession,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Check,
  DoorClosed,
  DoorOpen,
  Loader2,
  UserPlus,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNow } from '@/hooks/use-now';
import { useMe } from '@/lib/auth/use-me';
import { formatDateTime, formatDayLabel, formatTime } from '@/lib/format';
import { teacherNames, teachersLabel } from '@/lib/painel/aulas';
import { invalidateSpace } from '@/lib/painel/query';
import {
  ATTENDEE_STATUS,
  canManageSession,
  canOperateSession,
  canRemoveAttendee,
  isFull,
  occupancyLabel,
  occupying,
  SESSION_STATUS,
  sessionActions,
  sessionDate,
  studentsOutsideList,
  waitlist,
} from '@/lib/painel/sessions';
import {
  isStaleSessionError,
  sessionErrorCode,
  sessionErrorMessage,
} from '@/lib/painel/sessions-errors';
import { AddAttendeeDialog } from './add-attendee-dialog';
import { CancelSessionDialog } from './cancel-session-dialog';
import { RemoveAttendeeDialog } from './remove-attendee-dialog';
import { SessionTeachersDialog } from './session-teachers-dialog';

type Attendee = ClassSessionDetail['attendances'][number];

export function SessaoDetalheView({ sessionId }: { sessionId: string }) {
  return (
    <SpaceGate permission="classes.view" loadingRows={6}>
      {(scope) => <SessaoDetalhe scope={scope} sessionId={sessionId} />}
    </SpaceGate>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" className="self-start" asChild>
      <Link href="/painel/aulas/sessoes">
        <ArrowLeft /> Voltar às sessões
      </Link>
    </Button>
  );
}

function SessaoDetalhe({ scope, sessionId }: { scope: SpaceScope; sessionId: string }) {
  const me = useMe();
  const query = useGetClassSession(scope.spaceId, sessionId, {
    // O job de 1 minuto abre/fecha a lista e encerra a aula; alunos também confirmam pelo app.
    query: { refetchInterval: 30_000 },
  });

  if (query.isPending || me.isPending) return <LoadingBlock rows={6} label="Carregando a aula" />;
  if (query.error) {
    const notFound = sessionErrorCode(query.error) === 'CLASS_SESSION_NOT_FOUND';
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {notFound ? (
          <EmptyState
            title="Aula não encontrada"
            description="Ela pode ter sido removida ou não ser uma das suas aulas."
          />
        ) : (
          <ErrorState
            error={query.error}
            title="Não foi possível carregar a aula"
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    );
  }
  return <Conteudo scope={scope} session={query.data} userId={me.data?.id} />;
}

function Conteudo({
  scope,
  session,
  userId,
}: {
  scope: SpaceScope;
  session: ClassSessionDetail;
  userId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const refresh = () => invalidateSpace(queryClient, scope.spaceId);
  const onError = (e: unknown) => {
    toast.error(sessionErrorMessage(e));
    if (isStaleSessionError(e)) void refresh();
  };

  const operate =
    scope.canWrite('attendance.manage') && canOperateSession(scope.roles, userId, session);
  const manage = scope.canWrite('classes.manage') && canManageSession(scope.roles);
  // A aula pode começar/terminar com a tela aberta: `now` se atualiza ao cruzar os dois instantes.
  const now = useNow([session.startsAt, session.endsAt]);
  const actions = sessionActions(session, { operate, manage }, now);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Attendee | null>(null);

  const open = useOpenClassSession({
    mutation: {
      onSuccess: () => {
        toast.success(session.status === 'CLOSED' ? 'Lista reaberta.' : 'Lista aberta.');
        void refresh();
      },
      onError,
    },
  });
  const close = useCloseClassSession({
    mutation: {
      onSuccess: () => {
        toast.success('Lista fechada.');
        void refresh();
      },
      onError,
    },
  });
  const presence = useMarkClassSessionPresence({
    mutation: { onSuccess: () => void refresh(), onError },
  });
  const addRow = useAddClassSessionAttendee({
    mutation: {
      onSuccess: (detail, vars) => {
        const entry = detail.attendances.find((a) => a.userId === vars.data.userId);
        toast.success(
          entry?.status === 'WAITLIST'
            ? `${entry.name} entrou na lista de espera.`
            : `${entry?.name ?? 'Aluno'} adicionado à aula.`,
        );
        void refresh();
      },
      onError,
    },
  });

  const occupied = occupying(session.attendances);
  const queue = waitlist(session.attendances);
  const outside = studentsOutsideList(session.enrolledStudents, session.attendances);
  const confirmedToMark = session.attendances.filter((a) => a.status === 'CONFIRMED');
  const cancelled = session.status === 'CANCELLED';
  const markPresence = (userIdToMark: string, status: 'PRESENT' | 'ABSENT') =>
    presence.mutate({
      spaceId: scope.spaceId,
      sessionId: session.id,
      data: { items: [{ userId: userIdToMark, status }] },
    });
  const busy = open.isPending || close.isPending;

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <PageHeader
        title={session.classGroup.name}
        description={`${formatDayLabel(sessionDate(session.startsAt))} · ${formatTime(session.startsAt)}–${formatTime(session.endsAt)} · ${session.court.name} · ${session.sport.name}`}
        actions={
          <>
            {actions.open ? (
              <Button
                disabled={busy}
                onClick={() => open.mutate({ spaceId: scope.spaceId, sessionId: session.id })}
              >
                {open.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <DoorOpen />}
                {actions.open === 'reopen' ? 'Reabrir lista' : 'Abrir lista'}
              </Button>
            ) : null}
            {actions.close ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => close.mutate({ spaceId: scope.spaceId, sessionId: session.id })}
              >
                {close.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <DoorClosed />
                )}
                Fechar lista
              </Button>
            ) : null}
            {actions.changeTeachers ? (
              <Button variant="outline" onClick={() => setTeacherOpen(true)}>
                <Users /> Professores desta aula
              </Button>
            ) : null}
            {actions.cancel ? (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban /> Cancelar aula
              </Button>
            ) : null}
          </>
        }
      />
      <ReadOnlyNotice scope={scope} />

      <dl
        data-testid="session-summary"
        className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Situação</dt>
          <dd>
            <StatusBadge info={SESSION_STATUS[session.status]} />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">{teachersLabel(session.teachers)}</dt>
          <dd>{teacherNames(session.teachers)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Vagas ocupadas</dt>
          <dd data-testid="session-occupancy" className="font-medium">
            {occupancyLabel(session)}
            {isFull(session) ? ' · lotada' : ''}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-xs">Lista de espera</dt>
          <dd>
            {session.waitlistCount === 0
              ? 'Ninguém na espera'
              : `${session.waitlistCount} aluno(s)`}
          </dd>
        </div>
        {session.openedAt ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">Lista aberta em</dt>
            <dd>{formatDateTime(session.openedAt)}</dd>
          </div>
        ) : null}
        {session.closedAt ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">Lista fechada em</dt>
            <dd>{formatDateTime(session.closedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {cancelled ? (
        <Alert variant="destructive" role="status">
          <p className="font-medium">
            Aula cancelada{session.cancelledAt ? ` em ${formatDateTime(session.cancelledAt)}` : ''}.
          </p>
          {session.cancelReason ? <p>Motivo: {session.cancelReason}</p> : null}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="confirmados-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="confirmados-title" className="text-lg font-semibold">
            Lista de presença
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {actions.markPresence && confirmedToMark.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={presence.isPending}
                onClick={() =>
                  presence.mutate({
                    spaceId: scope.spaceId,
                    sessionId: session.id,
                    data: {
                      items: confirmedToMark.map((a) => ({
                        userId: a.userId,
                        status: 'PRESENT' as const,
                      })),
                    },
                  })
                }
              >
                <Check /> Marcar confirmados como presentes
              </Button>
            ) : null}
            {actions.addAttendee ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <UserPlus /> Adicionar aluno
              </Button>
            ) : null}
          </div>
        </div>

        {!cancelled && !actions.markPresence && session.status !== 'DONE' ? (
          <p className="text-muted-foreground text-xs">
            A presença real (presente/faltou) pode ser marcada a partir do início da aula.
          </p>
        ) : null}

        {occupied.length === 0 ? (
          <EmptyState
            title="Ninguém confirmado ainda"
            description={
              session.status === 'OPEN'
                ? 'A lista está aberta: os alunos confirmam pelo app.'
                : 'Os alunos confirmam pelo app quando a lista abrir.'
            }
          />
        ) : (
          <Table data-testid="attendance-table">
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {occupied.map((a) => (
                <TableRow key={a.userId} data-testid="attendee-row">
                  <TableCell className="font-medium">
                    {a.name}
                    {a.addedByStaff ? (
                      <span className="text-muted-foreground ml-2 text-xs">
                        adicionado pela equipe
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge info={ATTENDEE_STATUS[a.status]} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {actions.markPresence ? (
                        <>
                          <Button
                            size="sm"
                            variant={a.status === 'PRESENT' ? 'default' : 'outline'}
                            aria-pressed={a.status === 'PRESENT'}
                            aria-label={`Marcar ${a.name} como presente`}
                            disabled={presence.isPending}
                            onClick={() => markPresence(a.userId, 'PRESENT')}
                          >
                            <Check /> Presente
                          </Button>
                          <Button
                            size="sm"
                            variant={a.status === 'ABSENT' ? 'destructive' : 'outline'}
                            aria-pressed={a.status === 'ABSENT'}
                            aria-label={`Marcar ${a.name} como faltou`}
                            disabled={presence.isPending}
                            onClick={() => markPresence(a.userId, 'ABSENT')}
                          >
                            <X /> Faltou
                          </Button>
                        </>
                      ) : null}
                      {actions.addAttendee && canRemoveAttendee(a.status) ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover ${a.name} da aula`}
                          onClick={() => setRemoving(a)}
                        >
                          <UserRoundX />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {queue.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="espera-title">
          <h2 id="espera-title" className="text-lg font-semibold">
            Lista de espera
          </h2>
          <Table data-testid="waitlist-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Posição</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((a) => (
                <TableRow key={a.userId} data-testid="waitlist-row">
                  <TableCell>
                    <Badge variant="warning">{a.waitlistPosition}º</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {a.name}
                    {a.addedByStaff ? (
                      <span className="text-muted-foreground ml-2 text-xs">
                        adicionado pela equipe
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {actions.addAttendee ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remover ${a.name} da espera`}
                          onClick={() => setRemoving(a)}
                        >
                          <UserRoundX />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {(actions.markPresence || actions.addAttendee) && outside.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="matriculados-title">
          <div>
            <h2 id="matriculados-title" className="text-lg font-semibold">
              Matriculados fora da lista
            </h2>
            <p className="text-muted-foreground text-xs">
              Quem não confirmou pelo app.{' '}
              {actions.markPresence ? 'Marcar a presença já inclui o aluno na aula.' : ''}
            </p>
          </div>
          <Table data-testid="outside-table">
            <TableBody>
              {outside.map((s) => (
                <TableRow key={s.userId} data-testid="outside-row">
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {actions.markPresence ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Marcar ${s.name} como presente`}
                            disabled={presence.isPending}
                            onClick={() => markPresence(s.userId, 'PRESENT')}
                          >
                            <Check /> Presente
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Marcar ${s.name} como faltou`}
                            disabled={presence.isPending}
                            onClick={() => markPresence(s.userId, 'ABSENT')}
                          >
                            <X /> Faltou
                          </Button>
                        </>
                      ) : null}
                      {actions.addAttendee ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Adicionar ${s.name} à lista`}
                          disabled={addRow.isPending}
                          onClick={() =>
                            addRow.mutate({
                              spaceId: scope.spaceId,
                              sessionId: session.id,
                              data: { userId: s.userId },
                            })
                          }
                        >
                          <UserPlus /> Adicionar
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <AddAttendeeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        spaceId={scope.spaceId}
        session={session}
        canListStudents={scope.can('enrollment.manage')}
        onAdded={(detail, addedUserId) => {
          const entry = detail.attendances.find((a) => a.userId === addedUserId);
          toast.success(
            entry?.status === 'WAITLIST'
              ? `${entry.name} entrou na lista de espera.`
              : `${entry?.name ?? 'Aluno'} adicionado à aula.`,
          );
          setAddOpen(false);
          void refresh();
        }}
      />
      <RemoveAttendeeDialog
        target={removing}
        onClose={() => setRemoving(null)}
        spaceId={scope.spaceId}
        sessionId={session.id}
        onRemoved={(name) => {
          toast.success(`${name} removido da aula.`);
          setRemoving(null);
          void refresh();
        }}
        onStale={() => void refresh()}
      />
      <CancelSessionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        spaceId={scope.spaceId}
        session={session}
        onCancelled={() => {
          toast.success('Aula cancelada. Os alunos serão avisados.');
          setCancelOpen(false);
          void refresh();
        }}
      />
      <SessionTeachersDialog
        open={teacherOpen}
        onOpenChange={setTeacherOpen}
        spaceId={scope.spaceId}
        session={session}
        onChanged={() => {
          toast.success('Professores da aula atualizados.');
          setTeacherOpen(false);
          void refresh();
        }}
      />
    </div>
  );
}

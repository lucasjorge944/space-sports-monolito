'use client';

import {
  type RecurringBookingDetailDto,
  useApproveRecurringBooking,
  useEndRecurringBooking,
  useGetSpaceRecurringBooking,
  usePauseRecurringBooking,
  useRejectRecurringBooking,
  useResumeRecurringBooking,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pause, Play, Square, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ReasonDialog } from '@/components/painel/reason-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatDateTime, formatDuration, formatLocalDate, formatPhone } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { RECURRING_STATUS, WEEKDAY_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { overline } from '@/lib/utils';

export function RecurringDetailSheet({
  scope,
  recurringId,
  onClose,
}: {
  scope: SpaceScope;
  recurringId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={recurringId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Mensalista</SheetTitle>
          <SheetDescription>Horário fixo e conflitos de agenda.</SheetDescription>
        </SheetHeader>
        {recurringId ? <Body scope={scope} recurringId={recurringId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ scope, recurringId }: { scope: SpaceScope; recurringId: string }) {
  const query = useGetSpaceRecurringBooking(scope.spaceId, recurringId);
  if (query.isPending)
    return (
      <div className="px-4">
        <LoadingBlock rows={5} />
      </div>
    );
  if (query.isError)
    return (
      <div className="px-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  return <Detail scope={scope} item={query.data} />;
}

type Action = 'reject' | 'pause' | 'end';

const ACTION_COPY: Record<Action, { title: string; description: string; confirm: string }> = {
  reject: {
    title: 'Recusar solicitação',
    description: 'O jogador é avisado da recusa. Informe o motivo para ele entender.',
    confirm: 'Recusar',
  },
  pause: {
    title: 'Pausar mensalista',
    description:
      'As ocorrências futuras que ainda não começaram são canceladas e a quadra é liberada.',
    confirm: 'Pausar',
  },
  end: {
    title: 'Encerrar mensalista',
    description:
      'As ocorrências futuras são canceladas e a quadra é liberada. Não dá para desfazer; um novo horário exige novo cadastro.',
    confirm: 'Encerrar',
  },
};

function Detail({ scope, item }: { scope: SpaceScope; item: RecurringBookingDetailDto }) {
  const queryClient = useQueryClient();
  const canManage = scope.canWrite('booking.create');
  const [action, setAction] = useState<Action | null>(null);

  const done = (message: string) => {
    toast.success(message);
    void invalidateSpace(queryClient, scope.spaceId);
  };
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));

  const approve = useApproveRecurringBooking({
    mutation: { onSuccess: () => done('Mensalista aprovado.'), onError: fail },
  });
  const resume = useResumeRecurringBooking({
    mutation: { onSuccess: () => done('Mensalista retomado.'), onError: fail },
  });
  const reject = useRejectRecurringBooking();
  const pause = usePauseRecurringBooking();
  const end = useEndRecurringBooking();
  const active = { reject, pause, end }[action ?? 'end'];

  const ids = { spaceId: scope.spaceId, recurringBookingId: item.id };
  const busy = approve.isPending || resume.isPending;

  return (
    <div className="flex flex-col gap-5 px-4 pb-6" data-testid="recurring-detail">
      <div className="flex flex-col gap-2">
        <StatusBadge info={RECURRING_STATUS[item.status]} />
        <p className="text-lg font-semibold">{item.customer.name}</p>
        {item.customer.phone ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            {formatPhone(item.customer.phone)}
          </p>
        ) : null}
        <p className="text-sm">
          {WEEKDAY_LABEL[item.weekday]} às {item.startTime.slice(0, 5)} ·{' '}
          {formatDuration(item.durationMin)} · {item.court.name} · {item.sport.name}
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          Desde {formatLocalDate(item.startsOn)}
          {item.endsOn ? ` até ${formatLocalDate(item.endsOn)}` : ''} · {item.peopleCount} pessoas
        </p>
        {item.statusReason ? (
          <p className="text-muted-foreground text-sm">Motivo: {item.statusReason}</p>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {item.status === 'PENDING_APPROVAL' ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => approve.mutate(ids)}>
                {approve.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check />}
                Aprovar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAction('reject')}>
                <X /> Recusar
              </Button>
            </>
          ) : null}
          {item.status === 'ACTIVE' ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setAction('pause')}>
                <Pause /> Pausar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setAction('end')}>
                <Square /> Encerrar
              </Button>
            </>
          ) : null}
          {item.status === 'PAUSED' ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => resume.mutate(ids)}>
                {resume.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Play />}
                Retomar
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setAction('end')}>
                <Square /> Encerrar
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <FormError message={approve.error ? apiErrorMessage(approve.error) : undefined} />
      <FormError message={resume.error ? apiErrorMessage(resume.error) : undefined} />

      {item.conflicts.length > 0 ? (
        <section className="grid gap-2 text-sm">
          <h3 className={overline}>Conflitos de agenda</h3>
          <ul className="divide-y rounded-md border">
            {item.conflicts.map((c) => (
              <li key={c.id} className="px-3 py-2">
                <span className="tabular-nums">{formatDateTime(c.startsAt)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · coincide com{' '}
                  {
                    { BOOKING: 'reserva', CLASS: 'aula', TOURNAMENT: 'torneio', BLOCK: 'bloqueio' }[
                      c.conflictsWith
                    ]
                  }
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {action ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setAction(null)}
          title={ACTION_COPY[action].title}
          description={ACTION_COPY[action].description}
          confirmLabel={ACTION_COPY[action].confirm}
          pending={active.isPending}
          error={active.error}
          onConfirm={(reason) =>
            active.mutate(
              { ...ids, data: reason ? { reason } : {} },
              {
                onSuccess: () => {
                  setAction(null);
                  done(
                    action === 'reject'
                      ? 'Solicitação recusada.'
                      : action === 'pause'
                        ? 'Mensalista pausado.'
                        : 'Mensalista encerrado.',
                  );
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

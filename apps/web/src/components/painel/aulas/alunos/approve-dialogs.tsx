'use client';

import {
  useApproveSubscription,
  useListClassGroups,
  useRejectSubscription,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ReasonDialog } from '@/components/painel/reason-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { alertVariants } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { teacherNames } from '@/lib/painel/aulas';
import { apiErrorMessage } from '@/lib/painel/errors';
import { invalidateSpace } from '@/lib/painel/query';
import {
  classCountRule,
  classSlotShort,
  eligibleClassGroups,
  isClassSelectionValid,
  pendingEnrollments,
  sameSelection,
  unavailableRequested,
} from '@/lib/painel/subscriptions';
import { cn } from '@/lib/utils';

/** O que os diálogos leem da assinatura (serve para o item da lista e para o detalhe). */
export type ReviewableSubscription = {
  id: string;
  student: { name: string };
  plan: { name: string; weeklyFrequency: number | null; sport: { id: string } };
  enrollments: {
    id: string;
    status: 'PENDING' | 'ACTIVE' | 'ENDED';
    classGroup: { id: string; name: string };
  }[];
};

/**
 * Aprovar o pedido (RF-CLASS-05): confirma as turmas pedidas ou troca por outras antes de
 * aprovar. A vaga é conferida pela API sob trava (RN-CLASS-02); turma lotada volta como erro.
 */
export function ApproveDialog({
  scope,
  subscription,
  onClose,
}: {
  scope: SpaceScope;
  subscription: ReviewableSubscription | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={subscription !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {subscription ? (
          <ApproveForm
            key={subscription.id}
            scope={scope}
            subscription={subscription}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  scope,
  subscription,
  onClose,
}: {
  scope: SpaceScope;
  subscription: ReviewableSubscription;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const groups = useListClassGroups(scope.spaceId, { active: 'true' });
  const requestedGroups = pendingEnrollments(subscription).map((e) => e.classGroup);
  const requested = requestedGroups.map((g) => g.id);
  const [selected, setSelected] = useState<string[]>(requested);
  const approve = useApproveSubscription();
  const { weeklyFrequency } = subscription.plan;

  const options = eligibleClassGroups(groups.data?.items ?? [], subscription.plan.sport.id);
  // Turma pedida que foi desativada ou mudou de esporte: aparece marcada, e tem de ser desmarcada.
  const unavailable = groups.data ? unavailableRequested(requestedGroups, options) : [];
  const hasUnavailable = unavailable.some((g) => selected.includes(g.id));
  const valid = isClassSelectionValid(weeklyFrequency, selected.length) && !hasUnavailable;

  function toggle(id: string, checked: boolean) {
    approve.reset();
    setSelected((current) => (checked ? [...current, id] : current.filter((x) => x !== id)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    approve.mutate(
      {
        spaceId: scope.spaceId,
        subscriptionId: subscription.id,
        data: sameSelection(selected, requested) ? {} : { classGroupIds: selected },
      },
      {
        onSuccess: () => {
          toast.success('Assinatura aprovada. O aluno foi avisado.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Aprovar assinatura</DialogTitle>
        <DialogDescription>
          {subscription.student.name} · {subscription.plan.name}. Confirme as turmas: este plano
          pede {classCountRule(weeklyFrequency)}.
        </DialogDescription>
      </DialogHeader>
      <FormError message={approve.error ? apiErrorMessage(approve.error) : undefined} />

      {groups.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : groups.isError ? (
        <FormError message={apiErrorMessage(groups.error)} />
      ) : options.length === 0 && unavailable.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma turma ativa para este plano.</p>
      ) : (
        <fieldset className="grid gap-2" aria-label="Turmas do aluno">
          {unavailable.map((g) => (
            <div
              key={g.id}
              // Visual do Alert destrutivo, sem `role="alert"`: é uma opção do formulário, não um aviso.
              className={cn(
                alertVariants({ variant: 'destructive' }),
                'flex items-center gap-3 rounded-md px-3 py-2',
              )}
              data-testid="approve-class-unavailable"
            >
              <Checkbox
                id={`approve-${g.id}`}
                checked={selected.includes(g.id)}
                onCheckedChange={(v) => toggle(g.id, v === true)}
              />
              <Label htmlFor={`approve-${g.id}`} className="flex-1 flex-col items-start gap-0">
                <span>{g.name}</span>
                <span className="text-xs font-normal">
                  Indisponível: turma desativada ou de outro esporte. Desmarque para aprovar.
                </span>
              </Label>
            </div>
          ))}
          {options.map((g) => {
            const checked = selected.includes(g.id);
            const full = g.availableSpots === 0;
            return (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
                data-testid="approve-class-option"
              >
                <Checkbox
                  id={`approve-${g.id}`}
                  checked={checked}
                  disabled={full && !checked}
                  onCheckedChange={(v) => toggle(g.id, v === true)}
                />
                <Label htmlFor={`approve-${g.id}`} className="flex-1 flex-col items-start gap-0">
                  <span>{g.name}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {classSlotShort(g)} · {teacherNames(g.teachers)} ·{' '}
                    {full ? 'Lotada' : `${g.availableSpots} de ${g.capacity} vagas`}
                  </span>
                </Label>
              </div>
            );
          })}
        </fieldset>
      )}

      {!valid && !groups.isPending ? (
        <p className="text-muted-foreground text-xs" role="status">
          {hasUnavailable
            ? 'Desmarque a turma indisponível para aprovar.'
            : `Escolha ${classCountRule(weeklyFrequency)} (hoje: ${selected.length}).`}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={approve.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={!valid || approve.isPending}>
          {approve.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Aprovar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Recusar o pedido, com motivo opcional; o aluno é avisado. */
export function RejectDialog({
  scope,
  subscription,
  onClose,
}: {
  scope: SpaceScope;
  subscription: Pick<ReviewableSubscription, 'id' | 'student'> | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reject = useRejectSubscription();

  return (
    <ReasonDialog
      open={subscription !== null}
      onOpenChange={(open) => {
        if (!open) {
          reject.reset();
          onClose();
        }
      }}
      title="Recusar assinatura"
      description={`O pedido de ${subscription?.student.name ?? 'aluno'} é encerrado e o aluno é avisado. Informe o motivo para ele entender.`}
      confirmLabel="Recusar"
      pending={reject.isPending}
      error={reject.error}
      onConfirm={(reason) => {
        if (!subscription) return;
        reject.mutate(
          {
            spaceId: scope.spaceId,
            subscriptionId: subscription.id,
            data: reason ? { reason } : {},
          },
          {
            onSuccess: () => {
              toast.success('Pedido recusado. O aluno foi avisado.');
              void invalidateSpace(queryClient, scope.spaceId);
              onClose();
            },
          },
        );
      }}
    />
  );
}

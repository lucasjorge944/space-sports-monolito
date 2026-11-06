'use client';

import {
  type SubscriptionDetail,
  useCancelSpaceSubscription,
  useResumeSpaceSubscriptionCancel,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { ReasonDialog } from '@/components/painel/reason-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { formatLocalDate } from '@/lib/format';
import { invalidateSpace } from '@/lib/painel/query';
import { cancelEffect } from '@/lib/painel/subscriptions';

/** Cancela a assinatura (RN-CLASS-08, decisão 45): segue até o fim do mês pago ou termina agora. */
export function CancelSubscriptionDialog({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: Pick<
    SubscriptionDetail,
    'id' | 'student' | 'accessUntilIfCancelled' | 'charges' | 'overdueCents'
  > | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const cancel = useCancelSpaceSubscription();

  return (
    <ReasonDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          cancel.reset();
          onClose();
        }
      }}
      title="Cancelar assinatura"
      description={target ? cancelEffect(target.student.name, target) : ''}
      confirmLabel="Cancelar assinatura"
      pending={cancel.isPending}
      error={cancel.error}
      onConfirm={(reason) => {
        if (!target) return;
        cancel.mutate(
          {
            spaceId: scope.spaceId,
            subscriptionId: target.id,
            data: reason ? { reason } : {},
          },
          {
            onSuccess: () => {
              toast.success('Cancelamento registrado.');
              void invalidateSpace(queryClient, scope.spaceId);
              onClose();
            },
          },
        );
      }}
    />
  );
}

/** Desfaz o cancelamento enquanto o acesso vale; as aulas de que o aluno saiu não voltam sozinhas. */
export function ResumeCancelDialog({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: Pick<SubscriptionDetail, 'id' | 'student' | 'accessUntil'> | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const resume = useResumeSpaceSubscriptionCancel();
  const until = target?.accessUntil ? ` (acesso até ${formatLocalDate(target.accessUntil)})` : '';

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          resume.reset();
          onClose();
        }
      }}
      title="Desfazer o cancelamento"
      description={`A assinatura de ${target?.student.name ?? 'aluno'} volta ao normal${until} e as mensalidades voltam a ser geradas. As aulas de que o aluno saiu ao cancelar não voltam: ele confirma presença de novo.`}
      confirmLabel="Desfazer cancelamento"
      destructive={false}
      pending={resume.isPending}
      error={resume.error}
      onConfirm={() => {
        if (!target) return;
        resume.mutate(
          { spaceId: scope.spaceId, subscriptionId: target.id },
          {
            onSuccess: () => {
              toast.success('Cancelamento desfeito.');
              void invalidateSpace(queryClient, scope.spaceId);
              onClose();
            },
          },
        );
      }}
    />
  );
}

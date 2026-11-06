'use client';

import {
  type ClassGroup,
  useAddSubscriptionEnrollment,
  useEndSubscriptionEnrollment,
  useListClassGroups,
  useSwapSpaceSubscriptionClassGroup,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { apiErrorMessage } from '@/lib/painel/errors';
import { invalidateSpace } from '@/lib/painel/query';
import { classSlotShort, eligibleClassGroups } from '@/lib/painel/subscriptions';

export type EnrollmentTarget = {
  subscriptionId: string;
  studentName: string;
  sportId: string;
  /** Turmas em que o aluno já está (não entram como destino). */
  enrolledGroupIds: string[];
};

function groupOptionLabel(g: ClassGroup) {
  const spots = g.availableSpots === 0 ? 'lotada' : `${g.availableSpots} vagas`;
  return `${g.name} · ${classSlotShort(g)} · ${spots}`;
}

/** Escolha da turma de destino (só as ativas do esporte do plano, com vaga e ainda sem o aluno). */
function DestinationSelect({
  scope,
  target,
  value,
  onChange,
  id,
}: {
  scope: SpaceScope;
  target: EnrollmentTarget;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const groups = useListClassGroups(scope.spaceId, { active: 'true' });
  const options = eligibleClassGroups(groups.data?.items ?? [], target.sportId).filter(
    (g) => !target.enrolledGroupIds.includes(g.id),
  );
  return (
    <Field
      label="Turma"
      htmlFor={id}
      error={groups.isError ? apiErrorMessage(groups.error) : undefined}
      hint={
        !groups.isPending && !groups.isError && options.length === 0
          ? 'Nenhuma outra turma ativa deste esporte.'
          : undefined
      }
    >
      <Select value={value} onValueChange={onChange} disabled={groups.isPending}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={groups.isPending ? 'Carregando…' : 'Escolha a turma'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((g) => (
            <SelectItem key={g.id} value={g.id} disabled={g.availableSpots === 0}>
              {groupOptionLabel(g)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Trocar uma turma do aluno por outra (RF-CLASS-05, RN-CLASS-01/02). */
export function SwapDialog({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: (EnrollmentTarget & { fromGroup: { id: string; name: string } }) | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target ? (
          <SwapForm key={target.fromGroup.id} scope={scope} target={target} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SwapForm({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: EnrollmentTarget & { fromGroup: { id: string; name: string } };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const swap = useSwapSpaceSubscriptionClassGroup();
  const [to, setTo] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!to) return;
    swap.mutate(
      {
        spaceId: scope.spaceId,
        subscriptionId: target.subscriptionId,
        data: { fromClassGroupId: target.fromGroup.id, toClassGroupId: to },
      },
      {
        onSuccess: () => {
          toast.success('Turma trocada.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Trocar de turma</DialogTitle>
        <DialogDescription>
          {target.studentName} sai de {target.fromGroup.name}. A vaga na nova turma é conferida
          agora.
        </DialogDescription>
      </DialogHeader>
      <FormError message={swap.error ? apiErrorMessage(swap.error) : undefined} />
      <DestinationSelect scope={scope} target={target} value={to} onChange={setTo} id="swap-to" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={swap.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={!to || swap.isPending}>
          {swap.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Trocar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Matricular o aluno em mais uma turma (Nx: até N; ilimitado: sem limite). */
export function AddEnrollmentDialog({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: EnrollmentTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target ? (
          <AddForm key={target.subscriptionId} scope={scope} target={target} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddForm({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: EnrollmentTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const add = useAddSubscriptionEnrollment();
  const [classGroupId, setClassGroupId] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!classGroupId) return;
    add.mutate(
      { spaceId: scope.spaceId, subscriptionId: target.subscriptionId, data: { classGroupId } },
      {
        onSuccess: () => {
          toast.success('Aluno matriculado.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Matricular em outra turma</DialogTitle>
        <DialogDescription>{target.studentName}</DialogDescription>
      </DialogHeader>
      <FormError message={add.error ? apiErrorMessage(add.error) : undefined} />
      <DestinationSelect
        scope={scope}
        target={target}
        value={classGroupId}
        onChange={setClassGroupId}
        id="add-class-group"
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={!classGroupId || add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Matricular
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Desmatricular: encerra a matrícula hoje e libera a vaga; a assinatura continua. */
export function UnenrollDialog({
  scope,
  target,
  onClose,
}: {
  scope: SpaceScope;
  target: {
    subscriptionId: string;
    enrollmentId: string;
    studentName: string;
    groupName: string;
  } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const end = useEndSubscriptionEnrollment();

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          end.reset();
          onClose();
        }
      }}
      title="Desmatricular aluno"
      description={`${target?.studentName ?? 'O aluno'} deixa a turma ${target?.groupName ?? ''} a partir de hoje e a vaga é liberada. A assinatura e as mensalidades continuam.`}
      confirmLabel="Desmatricular"
      pending={end.isPending}
      error={end.error}
      onConfirm={() => {
        if (!target) return;
        end.mutate(
          {
            spaceId: scope.spaceId,
            subscriptionId: target.subscriptionId,
            enrollmentId: target.enrollmentId,
          },
          {
            onSuccess: () => {
              toast.success('Aluno desmatriculado.');
              void invalidateSpace(queryClient, scope.spaceId);
              onClose();
            },
          },
        );
      }}
    />
  );
}

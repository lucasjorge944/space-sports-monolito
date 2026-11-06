'use client';

import {
  type Court,
  type CourtStatus,
  useCreateCourt,
  useDeleteCourt,
  useListCourts,
  useListSports,
  useUpdateCourt,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipButton } from '@/components/ui/chip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiErrorMessage } from '@/lib/painel/errors';
import { COURT_STATUS } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { focusFirstInvalid } from '@/lib/utils';

export function QuadrasView() {
  return <SpaceGate permission="schedule.view">{(scope) => <Quadras scope={scope} />}</SpaceGate>;
}

type Editing = { court: Court | null } | null;

function Quadras({ scope }: { scope: SpaceScope }) {
  const queryClient = useQueryClient();
  const canEdit = scope.canWrite('settings.manage');
  const courts = useListCourts(scope.spaceId);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Court | null>(null);
  const remove = useDeleteCourt();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quadras"
        description="Cadastre as quadras e os esportes de cada uma."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing({ court: null })}>
              <Plus /> Nova quadra
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      {courts.isPending ? (
        <LoadingBlock rows={3} />
      ) : courts.isError ? (
        <ErrorState error={courts.error} onRetry={() => void courts.refetch()} />
      ) : courts.data.items.length === 0 ? (
        <EmptyState
          title="Nenhuma quadra cadastrada"
          description="Sem ao menos uma quadra ativa o espaço não aparece na vitrine nem na agenda."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quadra</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Esportes</TableHead>
                <TableHead>Situação</TableHead>
                {canEdit ? <TableHead className="w-28" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {courts.data.items.map((c) => (
                <TableRow key={c.id} data-testid="court-row">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.covered ? 'Coberta' : 'Descoberta'}</TableCell>
                  <TableCell>{c.sports.map((s) => s.name).join(', ')}</TableCell>
                  <TableCell>
                    <StatusBadge info={COURT_STATUS[c.status]} />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar ${c.name}`}
                        onClick={() => setEditing({ court: c })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Excluir ${c.name}`}
                        onClick={() => setRemoving(c)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CourtDialog scope={scope} editing={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Excluir ${removing?.name ?? 'quadra'}`}
        description="Quadras que já têm reservas não podem ser excluídas: marque como inativa. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { spaceId: scope.spaceId, courtId: removing.id },
            {
              onSuccess: () => {
                setRemoving(null);
                toast.success('Quadra excluída.');
                void invalidateSpace(queryClient, scope.spaceId);
              },
            },
          );
        }}
      />
    </div>
  );
}

function CourtDialog({
  scope,
  editing,
  onClose,
}: {
  scope: SpaceScope;
  editing: Editing;
  onClose: () => void;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {editing ? <CourtForm scope={scope} court={editing.court} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CourtForm({
  scope,
  court,
  onClose,
}: {
  scope: SpaceScope;
  court: Court | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sports = useListSports();
  const create = useCreateCourt();
  const update = useUpdateCourt();
  const mutation = court ? update : create;

  const [name, setName] = useState(court?.name ?? '');
  const [covered, setCovered] = useState(court?.covered ?? false);
  const [status, setStatus] = useState<CourtStatus>(court?.status ?? 'ACTIVE');
  const [sportIds, setSportIds] = useState<string[]>((court?.sports ?? []).map((s) => s.sportId));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggleSport(id: string) {
    setSportIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 1) next.name = 'Informe o nome da quadra';
    if (sportIds.length === 0) next.sports = 'Escolha ao menos um esporte';
    setErrors(next);
    if (Object.keys(next).length > 0)
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);

    const data = { name: name.trim(), covered, status, sportIds };
    const done = () => {
      toast.success(court ? 'Quadra atualizada.' : 'Quadra criada.');
      void invalidateSpace(queryClient, scope.spaceId);
      onClose();
    };
    if (court) {
      update.mutate({ spaceId: scope.spaceId, courtId: court.id, data }, { onSuccess: done });
    } else {
      create.mutate({ spaceId: scope.spaceId, data }, { onSuccess: done });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{court ? 'Editar quadra' : 'Nova quadra'}</DialogTitle>
        <DialogDescription>
          O número de pessoas na reserva segue o padrão de cada esporte.
        </DialogDescription>
      </DialogHeader>
      <FormError message={mutation.error ? apiErrorMessage(mutation.error) : undefined} />
      <Field label="Nome" htmlFor="court-name" error={errors.name}>
        <Input
          id="court-name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Situação" htmlFor="court-status">
          <Select value={status} onValueChange={(v) => setStatus(v as CourtStatus)}>
            <SelectTrigger id="court-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(COURT_STATUS) as CourtStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {COURT_STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end gap-2 pb-2">
          <Checkbox
            id="court-covered"
            checked={covered}
            onCheckedChange={(v) => setCovered(v === true)}
          />
          <Label htmlFor="court-covered">Quadra coberta</Label>
        </div>
      </div>

      <Field label="Esportes" error={errors.sports} group>
        {sports.isPending ? (
          <LoadingBlock rows={2} />
        ) : sports.isError ? (
          <ErrorState error={sports.error} onRetry={() => void sports.refetch()} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {sports.data.items.map((s) => (
              <ChipButton
                key={s.id}
                selected={sportIds.includes(s.id)}
                onClick={() => toggleSport(s.id)}
              >
                {s.name}
              </ChipButton>
            ))}
          </div>
        )}
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

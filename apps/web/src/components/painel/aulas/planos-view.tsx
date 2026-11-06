'use client';

import {
  type Plan,
  useCreatePlan,
  useDeletePlan,
  useListCourts,
  useListPlans,
  useUpdatePlan,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Badge } from '@/components/ui/badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaskedInput } from '@/components/ui/masked-input';
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
import { formatMoney } from '@/lib/format';
import {
  draftFromPlan,
  emptyPlanDraft,
  FREQUENCY_OPTIONS,
  frequencyLabel,
  type PlanDraft,
  planFromDraft,
} from '@/lib/painel/aulas';
import { apiErrorMessage } from '@/lib/painel/errors';
import { invalidateSpace } from '@/lib/painel/query';
import { focusFirstInvalid } from '@/lib/utils';

export function PlanosView() {
  return <SpaceGate permission="classes.view">{(scope) => <Planos scope={scope} />}</SpaceGate>;
}

type Editing = { plan: Plan | null } | null;

function Planos({ scope }: { scope: SpaceScope }) {
  const queryClient = useQueryClient();
  const canManage = scope.canWrite('classes.manage');
  // O Professor lê os planos, mas não os valores (quem não registra pagamento não vê preço).
  const showPrice = scope.can('payment.record');
  const plans = useListPlans(scope.spaceId);
  const [editing, setEditing] = useState<Editing>(null);
  const [deactivating, setDeactivating] = useState<Plan | null>(null);
  const [removing, setRemoving] = useState<Plan | null>(null);

  const refresh = () => invalidateSpace(queryClient, scope.spaceId);
  const toggle = useUpdatePlan();
  const remove = useDeletePlan();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Planos"
        description="Mensalidades das aulas. O pagamento é feito direto no espaço; a plataforma só registra. O preço novo vale só para novas assinaturas."
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ plan: null })}>
              <Plus /> Novo plano
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice scope={scope} />

      {plans.isPending ? (
        <LoadingBlock rows={3} label="Carregando os planos" />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : plans.data.items.length === 0 ? (
        <EmptyState
          title="Nenhum plano cadastrado"
          description="Cadastre os planos (ex.: Futevôlei 2x por semana) para os alunos assinarem."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead>Frequência</TableHead>
                {showPrice ? <TableHead>Mensalidade</TableHead> : null}
                <TableHead>Vencimento</TableHead>
                <TableHead>Situação</TableHead>
                {canManage ? <TableHead className="w-36" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.data.items.map((p) => (
                <TableRow key={p.id} data-testid="plan-row">
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground text-xs">{p.sport.name}</div>
                  </TableCell>
                  <TableCell>{frequencyLabel(p.weeklyFrequency)}</TableCell>
                  {showPrice ? (
                    <TableCell className="tabular-nums">{formatMoney(p.priceCents)}</TableCell>
                  ) : null}
                  <TableCell>Todo dia {p.billingDay}</TableCell>
                  <TableCell>
                    <Badge variant={p.active ? 'success' : 'muted'}>
                      {p.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar ${p.name}`}
                        onClick={() => setEditing({ plan: p })}
                      >
                        <Pencil />
                      </Button>
                      {p.active ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Desativar ${p.name}`}
                          onClick={() => setDeactivating(p)}
                        >
                          <PowerOff />
                        </Button>
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Reativar ${p.name}`}
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate(
                              { spaceId: scope.spaceId, planId: p.id, data: { active: true } },
                              {
                                onSuccess: () => {
                                  toast.success('Plano reativado.');
                                  void refresh();
                                },
                                onError: (e) => toast.error(apiErrorMessage(e)),
                              },
                            )
                          }
                        >
                          <Power />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Excluir ${p.name}`}
                        onClick={() => setRemoving(p)}
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

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          {editing ? (
            <PlanForm
              key={editing.plan?.id ?? 'new'}
              scope={scope}
              plan={editing.plan}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivating(null);
            toggle.reset();
          }
        }}
        title={`Desativar ${deactivating?.name ?? 'plano'}`}
        description="O plano deixa de aparecer para novas assinaturas. Quem já assina continua com o plano."
        confirmLabel="Desativar"
        pending={toggle.isPending}
        error={toggle.error}
        onConfirm={() => {
          if (!deactivating) return;
          toggle.mutate(
            { spaceId: scope.spaceId, planId: deactivating.id, data: { active: false } },
            {
              onSuccess: () => {
                setDeactivating(null);
                toast.success('Plano desativado.');
                void refresh();
              },
            },
          );
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title={`Excluir ${removing?.name ?? 'plano'}`}
        description="Planos que já tiveram assinaturas não podem ser excluídos: desative. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { spaceId: scope.spaceId, planId: removing.id },
            {
              onSuccess: () => {
                setRemoving(null);
                toast.success('Plano excluído.');
                void refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}

function PlanForm({
  scope,
  plan,
  onClose,
}: {
  scope: SpaceScope;
  plan: Plan | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const courts = useListCourts(scope.spaceId);
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const mutation = plan ? update : create;
  const [draft, setDraft] = useState<PlanDraft>(() =>
    plan ? draftFromPlan(plan) : emptyPlanDraft(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Esportes que o espaço oferece (união dos esportes das quadras); o do plano atual sempre entra.
  const sports = new Map<string, string>();
  for (const court of courts.data?.items ?? [])
    for (const s of court.sports) sports.set(s.sportId, s.name);
  if (plan) sports.set(plan.sport.id, plan.sport.name);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = planFromDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);
    }
    setErrors({});
    const done = () => {
      toast.success(plan ? 'Plano atualizado.' : 'Plano criado.');
      void invalidateSpace(queryClient, scope.spaceId);
      onClose();
    };
    if (plan) {
      update.mutate(
        { spaceId: scope.spaceId, planId: plan.id, data: result.data },
        { onSuccess: done },
      );
    } else {
      create.mutate({ spaceId: scope.spaceId, data: result.data }, { onSuccess: done });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{plan ? 'Editar plano' : 'Novo plano'}</DialogTitle>
        <DialogDescription>
          Mensalidade com vencimento em dia fixo do mês, sem proporcional no primeiro mês.
        </DialogDescription>
      </DialogHeader>
      <FormError message={mutation.error ? apiErrorMessage(mutation.error) : undefined} />

      <Field label="Nome" htmlFor="plan-name" error={errors.name}>
        <Input
          id="plan-name"
          maxLength={80}
          placeholder="Ex.: Futevôlei 2x por semana"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Esporte"
          htmlFor="plan-sport"
          error={errors.sportId}
          hint={courts.isError ? 'Não foi possível carregar os esportes das quadras.' : undefined}
        >
          <Select value={draft.sportId} onValueChange={(v) => set('sportId', v)}>
            <SelectTrigger id="plan-sport" className="w-full">
              <SelectValue placeholder={courts.isPending ? 'Carregando' : 'Escolha'} />
            </SelectTrigger>
            <SelectContent>
              {[...sports].map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Frequência" htmlFor="plan-frequency" error={errors.frequency}>
          <Select value={draft.frequency} onValueChange={(v) => set('frequency', v)}>
            <SelectTrigger id="plan-frequency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Mensalidade" htmlFor="plan-price" error={errors.price}>
          <MaskedInput
            mask="money"
            id="plan-price"
            placeholder="180,00"
            value={draft.price}
            onValueChange={(v) => set('price', v)}
          />
        </Field>
        <Field
          label="Dia do vencimento"
          htmlFor="plan-billing-day"
          error={errors.billingDay}
          hint="Do dia 1 ao 28, todo mês."
        >
          <MaskedInput
            mask="integer"
            id="plan-billing-day"
            maxLength={2}
            value={draft.billingDay}
            onValueChange={(v) => set('billingDay', v)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="plan-active"
          checked={draft.active}
          onCheckedChange={(v) => set('active', v === true)}
        />
        <Label htmlFor="plan-active">Plano ativo (disponível para novas assinaturas)</Label>
      </div>

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

'use client';

import {
  getSuperGetPaymentFeesQueryKey,
  type PlatformFees,
  type PlatformFeesSpacesItem,
  useSuperGetPaymentFees,
  useSuperListSpaces,
  useSuperRemoveSpacePaymentFees,
  useSuperUpdateDefaultPaymentFees,
  useSuperUpdateSpacePaymentFees,
} from '@space-sports/api-client';
import { formatBpsPercent } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaskedInput } from '@/components/ui/masked-input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMoney, formatShortDate } from '@/lib/format';
import {
  type FeeForm,
  type FeeFormErrors,
  feeLiveExample,
  feeToForm,
  parseDefaultFees,
  parseSpaceFees,
} from '@/lib/super/online-payments';
import { describeError, EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

/** Taxas padrão e por espaço (RF-ONPAY-10): pontos-base exibidos como %, centavos como R$. */
export function FeesTab() {
  const fees = useSuperGetPaymentFees();
  if (fees.isPending) return <LoadingBlock rows={4} />;
  if (fees.isError) return <ErrorBlock error={fees.error} onRetry={() => void fees.refetch()} />;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <DefaultFeesCard data={fees.data} />
      <OverridesCard data={fees.data} />
    </div>
  );
}

function useSetFees() {
  const queryClient = useQueryClient();
  return (data: PlatformFees) => queryClient.setQueryData(getSuperGetPaymentFeesQueryKey(), data);
}

function FeeFields({
  form,
  errors,
  onChange,
  optional,
  idPrefix,
}: {
  form: FeeForm;
  errors: FeeFormErrors;
  onChange: (form: FeeForm) => void;
  optional?: boolean;
  idPrefix: string;
}) {
  const hint = optional ? 'Vazio = taxa padrão' : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Pix (%)" htmlFor={`${idPrefix}-pix`} error={errors.pix} hint={hint}>
        <MaskedInput
          mask="percent"
          id={`${idPrefix}-pix`}
          value={form.pix}
          onValueChange={(pix) => onChange({ ...form, pix })}
        />
      </Field>
      <Field
        label="Cartão de crédito (%)"
        htmlFor={`${idPrefix}-card`}
        error={errors.card}
        hint={hint}
      >
        <MaskedInput
          mask="percent"
          id={`${idPrefix}-card`}
          value={form.card}
          onValueChange={(card) => onChange({ ...form, card })}
        />
      </Field>
      <Field label="Mínimo" htmlFor={`${idPrefix}-min`} error={errors.min} hint={hint}>
        <MaskedInput
          mask="money"
          id={`${idPrefix}-min`}
          value={form.min}
          onValueChange={(min) => onChange({ ...form, min })}
        />
      </Field>
    </div>
  );
}

function DefaultFeesCard({ data }: { data: PlatformFees }) {
  const setFees = useSetFees();
  const update = useSuperUpdateDefaultPaymentFees();
  const initial = feeToForm(data.defaults);
  const [form, setForm] = useState<FeeForm>(initial);
  const [errors, setErrors] = useState<FeeFormErrors>({});
  const [confirming, setConfirming] = useState(false);
  const parsed = parseDefaultFees(form);
  const changed =
    form.pix !== initial.pix || form.card !== initial.card || form.min !== initial.min;

  return (
    <Card data-testid="default-fees">
      <CardHeader>
        <CardTitle>Taxa padrão</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 text-sm"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setErrors(parsed.errors);
            if (parsed.values) setConfirming(true);
          }}
        >
          <FeeFields form={form} errors={errors} onChange={setForm} idPrefix="default" />
          <p>
            Quem paga: <strong>Espaço</strong>{' '}
            <span className="text-muted-foreground">
              (pagamento da taxa pelo jogador depende de decisão futura, decisão 82)
            </span>
          </p>
          {parsed.values ? (
            <p className="text-muted-foreground" data-testid="fee-live-example">
              {feeLiveExample(parsed.values)}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Última alteração: {formatDate(data.defaults.updatedAt)}
            {data.defaults.updatedByName ? ` por ${data.defaults.updatedByName}` : ''}
          </p>
          <Button type="submit" className="w-fit justify-self-end" disabled={!changed}>
            Salvar taxa padrão
          </Button>
        </form>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Salvar a taxa padrão?"
        description="A nova taxa vale para cobranças criadas a partir de agora. As já criadas mantêm a taxa da época."
        confirmLabel="Salvar"
        destructive={false}
        pending={update.isPending}
        error={update.error}
        formatError={describeError}
        onConfirm={() => {
          if (!parsed.values) return;
          update.mutate(
            { data: { ...parsed.values, feePayer: 'SPACE' } },
            {
              onSuccess: (next) => {
                setFees(next);
                setForm(feeToForm(next.defaults));
                setConfirming(false);
                toast.success('Taxa padrão salva.');
              },
            },
          );
        }}
      />
    </Card>
  );
}

function OverridesCard({ data }: { data: PlatformFees }) {
  const setFees = useSetFees();
  const [editing, setEditing] = useState<PlatformFeesSpacesItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<PlatformFeesSpacesItem | null>(null);
  const remove = useSuperRemoveSpacePaymentFees();
  const value = (custom: number | null, text: string) =>
    custom === null ? <span className="text-muted-foreground">padrão</span> : text;

  return (
    <Card data-testid="space-fees">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Condições especiais por espaço</CardTitle>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          Adicionar condição
        </Button>
      </CardHeader>
      <CardContent>
        {data.spaces.length === 0 ? (
          <EmptyBlock>Todos os espaços usam a taxa padrão.</EmptyBlock>
        ) : (
          <div className="rounded-lg border">
            <Table aria-label="Condições especiais por espaço">
              <TableHeader>
                <TableRow>
                  <TableHead>Espaço</TableHead>
                  <TableHead className="text-right">Pix</TableHead>
                  <TableHead className="text-right">Cartão</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead>Atualizado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.spaces.map((s) => (
                  <TableRow key={s.spaceId} data-testid="space-fee-row">
                    <TableCell>{s.spaceName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {value(s.pixFeeBps, formatBpsPercent(s.pixFeeBps ?? 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {value(s.cardFeeBps, formatBpsPercent(s.cardFeeBps ?? 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {value(s.minFeeCents, formatMoney(s.minFeeCents ?? 0))}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatShortDate(s.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(s)}>
                        Remover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <SpaceFeeDialog
        target={editing}
        taken={data.spaces.map((s) => s.spaceId)}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          setFees(next);
          setEditing(null);
          toast.success('Condição do espaço salva.');
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remover a condição de ${removing?.spaceName ?? ''}?`}
        description="O espaço volta à taxa padrão nas próximas cobranças."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        formatError={describeError}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { spaceId: removing.spaceId },
            {
              onSuccess: (next) => {
                setFees(next);
                setRemoving(null);
                toast.success('O espaço voltou à taxa padrão.');
              },
            },
          );
        }}
      />
    </Card>
  );
}

function SpaceFeeDialog({
  target,
  taken,
  onClose,
  onSaved,
}: {
  target: PlatformFeesSpacesItem | 'new' | null;
  taken: string[];
  onClose: () => void;
  onSaved: (data: PlatformFees) => void;
}) {
  const isNew = target === 'new';
  const existing = target && target !== 'new' ? target : null;
  const spaces = useSuperListSpaces(
    { pageSize: 100, status: 'ACTIVE' },
    { query: { enabled: isNew } },
  );
  const update = useSuperUpdateSpacePaymentFees();
  const [spaceId, setSpaceId] = useState('');
  const [form, setForm] = useState<FeeForm>({ pix: '', card: '', min: '' });
  const [errors, setErrors] = useState<FeeFormErrors & { space?: string }>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia ao abrir
  useEffect(() => {
    if (!target) return;
    update.reset();
    setErrors({});
    setSpaceId(existing?.spaceId ?? '');
    setForm(existing ? feeToForm(existing) : { pix: '', card: '', min: '' });
  }, [target]);

  const options = (spaces.data?.items ?? []).filter((s) => !taken.includes(s.id));

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseSpaceFees(form);
            const next = { ...parsed.errors, ...(spaceId ? {} : { space: 'Escolha o espaço' }) };
            setErrors(next);
            if (!parsed.values || !spaceId) return;
            update.mutate(
              { spaceId, data: { ...parsed.values, feePayer: null } },
              { onSuccess: onSaved },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {isNew ? 'Adicionar condição' : `Condição de ${existing?.spaceName}`}
            </DialogTitle>
            <DialogDescription>
              Campo vazio usa a taxa padrão. Vale para as cobranças criadas a partir de agora.
            </DialogDescription>
          </DialogHeader>
          <FormError message={update.error ? describeError(update.error) : undefined} />
          {isNew ? (
            <Field label="Espaço" htmlFor="fee-space" error={errors.space}>
              <Select id="fee-space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                <option value="">Escolha o espaço</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <FeeFields form={form} errors={errors} onChange={setForm} optional idPrefix="space" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { isApiError, type OnlineCharge, useRefundOnlineCharge } from '@space-sports/api-client';
import { ONLINE_CHARGE_PAID_STATUSES, parseMoneyToCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent,
  Copy,
  CreditCard,
  Loader2,
  type LucideIcon,
  QrCode,
  RotateCcw,
  Scissors,
  Undo2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { OptionCards } from '@/components/painel/option-cards';
import type { SpaceScope } from '@/components/painel/space-scope';
import { StatusBadge } from '@/components/painel/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaskedInput } from '@/components/ui/masked-input';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney, formatShortDate, formatSignedMoney } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { ONLINE_CHARGE_STATUS, ONLINE_METHOD_LABEL } from '@/lib/painel/labels';
import {
  canRefund,
  chargeHeadline,
  chargeNetCents,
  feeLineLabel,
  openChargeLabel,
  refundAmountError,
  refundEffect,
  refundEstimate,
  refundPayload,
  refundReasonError,
  refundTitle,
} from '@/lib/painel/online-payments';
import { invalidateSpace } from '@/lib/painel/query';
import { cn, overline } from '@/lib/utils';

const METHOD_ICON: Record<OnlineCharge['method'], LucideIcon> = { PIX: QrCode, CARD: CreditCard };

const PAID = new Set<string>(ONLINE_CHARGE_PAID_STATUSES);

export type OnlineItem = 'reserva' | 'mensalidade';

type OpenCharge = { id: string; method: OnlineCharge['method']; expiresAt: string | null };

/**
 * Seção "Pagamento online" do detalhe da reserva e da mensalidade (RF-ONPAY-08): um bloco por
 * cobrança paga (meio, valor, taxa gravada, estornos, líquido) e um para a cobrança aberta.
 * Dono e Admin; o Professor nunca recebe cobranças da API (decisão 53).
 */
export function OnlineChargesSection({
  scope,
  charges,
  openCharge,
  item,
}: {
  scope: SpaceScope;
  charges: OnlineCharge[];
  openCharge: OpenCharge | null;
  item: OnlineItem;
}) {
  // Guarda só o id: o diálogo lê a cobrança atualizada (depois de um 422, ela é recarregada).
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const refunding = charges.find((c) => c.id === refundingId) ?? null;
  const paid = charges.filter((c) => PAID.has(c.status));
  // A cobrança aberta vem do item; sem ela, a cobrança `PENDING` da lista.
  const open = openCharge ?? charges.find((c) => c.status === 'PENDING') ?? null;
  if (paid.length === 0 && !open) return null;

  return (
    <section
      className="grid gap-2 text-sm"
      aria-label="Pagamento online"
      data-testid="online-payment"
    >
      <h3 className={cn(overline, 'flex items-center gap-1.5')}>
        <CreditCard className="size-3.5 shrink-0" aria-hidden />
        Pagamento online
      </h3>
      {paid.map((charge) => (
        <PaidChargeBlock
          key={charge.id}
          scope={scope}
          charge={charge}
          item={item}
          onRefund={() => setRefundingId(charge.id)}
        />
      ))}
      {open ? <OpenChargeBlock charge={open} /> : null}
      <RefundDialog
        scope={scope}
        charge={refunding}
        item={item}
        onClose={() => setRefundingId(null)}
      />
    </section>
  );
}

function OpenChargeBlock({ charge }: { charge: OpenCharge }) {
  const Icon = METHOD_ICON[charge.method];
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
      data-testid="online-open-charge"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <Icon className="size-4 shrink-0" aria-hidden />
        {openChargeLabel(charge)}
      </span>
      <StatusBadge info={ONLINE_CHARGE_STATUS.PENDING} />
    </div>
  );
}

function Line({
  label,
  value,
  positive,
  strong,
}: {
  label: string;
  value: string;
  positive?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-3 tabular-nums', strong && 'font-medium')}>
      <span>{label}</span>
      <span className={positive ? 'text-amount-positive' : undefined}>{value}</span>
    </div>
  );
}

function PaidChargeBlock({
  scope,
  charge,
  item,
  onRefund,
}: {
  scope: SpaceScope;
  charge: OnlineCharge;
  item: OnlineItem;
  onRefund: () => void;
}) {
  const Icon = METHOD_ICON[charge.method];
  // Contestação no cartão ainda valendo (a ganha já devolveu o valor e saiu do `refundedCents`).
  const chargebackCents = charge.refunds
    .filter((r) => r.kind === 'CHARGEBACK' && r.status !== 'FAILED' && r.dispute?.status !== 'WON')
    .reduce((sum, r) => sum + r.amountCents, 0);
  const refundedToClient = Math.max(charge.refundedCents - chargebackCents, 0);
  const enabled = charge.paymentEnvironment.enabled;
  const showRefund = scope.can('payments.online.manage') && canRefund(charge);
  const releaseText = charge.availableAt
    ? new Date(charge.availableAt).getTime() > Date.now()
      ? `Libera em ${formatShortDate(charge.availableAt)}`
      : 'Liberado'
    : null;

  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid="online-charge">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="size-4 shrink-0" aria-hidden />
          {chargeHeadline(charge)}
        </span>
        <StatusBadge info={ONLINE_CHARGE_STATUS[charge.status]} />
      </div>
      <div className="grid gap-1">
        <Line label="Valor pago" value={formatMoney(charge.amountCents)} />
        <Line label={feeLineLabel(charge)} value={formatSignedMoney(-charge.platformFeeCents)} />
        {refundedToClient > 0 ? (
          <Line label="Estornado ao cliente" value={formatSignedMoney(-refundedToClient)} />
        ) : null}
        {chargebackCents > 0 ? (
          <Line label="Contestação no cartão" value={formatSignedMoney(-chargebackCents)} />
        ) : null}
        {charge.feeRefundedCents > 0 ? (
          <Line
            label="Taxa devolvida"
            value={formatSignedMoney(charge.feeRefundedCents)}
            positive
          />
        ) : null}
        <div className="border-t" />
        <Line label="O espaço recebe" value={formatMoney(chargeNetCents(charge))} strong />
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        {releaseText ? <span>{releaseText}</span> : null}
        {charge.transactionId ? <TransactionId id={charge.transactionId} /> : null}
      </div>
      {charge.refunds.length > 0 ? (
        <ul className="grid gap-1.5 text-xs" aria-label="Estornos">
          {charge.refunds.map((refund) => {
            const effect = refundEffect(refund, item);
            return (
              <li key={refund.id} data-testid="online-refund">
                <p className="tabular-nums">
                  {refundTitle(refund)}: {formatSignedMoney(-refund.amountCents)}
                </p>
                {refund.reason && refund.reasonCode === 'MANUAL' ? (
                  <p className="text-muted-foreground">“{refund.reason}”</p>
                ) : null}
                {effect ? <p className="text-muted-foreground">{effect}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {showRefund ? (
        <div className="flex justify-end">
          {enabled && scope.canWrite('payments.online.manage') ? (
            <Button size="sm" variant="outline" onClick={onRefund}>
              <Undo2 />
              Estornar
            </Button>
          ) : (
            <span className="grid justify-items-end gap-1">
              <Button size="sm" variant="outline" disabled>
                <Undo2 />
                Estornar
              </Button>
              <span className="text-muted-foreground text-xs">
                {enabled
                  ? 'Espaço somente para consulta'
                  : 'Indisponível com o pagamento online desligado'}
              </span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TransactionId({ id }: { id: string }) {
  const short = id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
  return (
    <span className="inline-flex items-center gap-1">
      Transação {short}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Copiar código da transação"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(id)
            .then(() => toast.success('Código da transação copiado.'));
        }}
      >
        <Copy className="size-3.5" aria-hidden />
      </Button>
    </span>
  );
}

const ICON_ALL: LucideIcon = Undo2;
const ICON_PART: LucideIcon = Scissors;

/** Estorno manual, total ou parcial (RN-ONPAY-05; decisões 93 e 94). */
export function RefundDialog({
  scope,
  charge,
  item,
  onClose,
}: {
  scope: SpaceScope;
  charge: OnlineCharge | null;
  item: OnlineItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const refund = useRefundOnlineCharge();
  const [mode, setMode] = useState<'ALL' | 'PART'>('ALL');
  const [amount, setAmount] = useState('');
  const [chargeAgain, setChargeAgain] = useState<'NO' | 'YES'>('NO');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia o formulário ao abrir
  useEffect(() => {
    if (charge) {
      setMode('ALL');
      setAmount('');
      setChargeAgain('NO');
      setReason('');
      setErrors({});
      refund.reset();
    }
  }, [charge?.id]);

  if (!charge) return <Dialog open={false} />;

  const refundable = charge.refundableCents;
  const cents = mode === 'ALL' ? refundable : parseMoneyToCents(amount);
  const estimate = cents !== null ? refundEstimate(charge, cents, chargeAgain === 'YES') : null;
  const itemName = item === 'reserva' ? 'reserva' : 'mensalidade';
  const methodName = ONLINE_METHOD_LABEL[charge.method];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!charge) return;
    const next = {
      amount: mode === 'PART' ? refundAmountError(cents, refundable) : undefined,
      reason: refundReasonError(reason),
    };
    setErrors(next);
    if (next.amount || next.reason || cents === null || cents <= 0) return;
    refund.mutate(
      {
        spaceId: scope.spaceId,
        chargeId: charge.id,
        // Sempre com o valor confirmado na tela, também em "Tudo o que falta".
        data: refundPayload({ cents, reason, chargeAgain: chargeAgain === 'YES' }),
      },
      {
        onSuccess: (created) => {
          toast.success(`Estorno de ${formatMoney(created.amountCents)} enviado ao cliente.`);
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
        // O reembolsável mudou (outro estorno ou contestação): recarrega a cobrança no diálogo.
        onError: (error) => {
          if (isApiError(error) && error.code === 'REFUND_EXCEEDS_BALANCE') {
            void invalidateSpace(queryClient, scope.spaceId);
          }
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Estornar pagamento online</DialogTitle>
            <DialogDescription>
              {methodName} de {formatMoney(charge.amountCents)} · {charge.payer.name}
              {charge.paidAt ? ` · pago em ${formatShortDate(charge.paidAt)}` : ''}
              {charge.refundedCents > 0 ? (
                <>
                  <br />
                  Já estornado: {formatMoney(charge.refundedCents)}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <FormError message={refund.error ? apiErrorMessage(refund.error) : undefined} />

          <Field label="Quanto devolver" group>
            <OptionCards
              label="Quanto devolver"
              name="refund-mode"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'ALL',
                  label: 'Tudo o que falta',
                  description: formatMoney(refundable),
                  icon: ICON_ALL,
                },
                {
                  value: 'PART',
                  label: 'Parte do valor',
                  description: 'Escolha quanto devolver.',
                  icon: ICON_PART,
                },
              ]}
            />
          </Field>
          {mode === 'PART' ? (
            <Field
              label="Valor a devolver"
              htmlFor="refund-amount"
              hint={`Até ${formatMoney(refundable)}`}
              error={errors.amount}
            >
              <MaskedInput
                mask="money"
                id="refund-amount"
                value={amount}
                onValueChange={setAmount}
              />
            </Field>
          ) : null}

          <Field label="O valor devolvido volta a ser cobrado?" group>
            <OptionCards
              label="O valor devolvido volta a ser cobrado?"
              name="refund-charge-again"
              value={chargeAgain}
              onChange={setChargeAgain}
              options={[
                {
                  value: 'NO',
                  label: 'Não, é um abatimento',
                  description: `A ${itemName} continua paga; o valor devolvido vira desconto.`,
                  icon: BadgePercent,
                },
                {
                  value: 'YES',
                  label: 'Sim, cobrar de novo',
                  description: 'O valor devolvido volta a ficar em aberto para receber no local.',
                  icon: RotateCcw,
                },
              ]}
            />
          </Field>

          <Field
            label="Motivo"
            htmlFor="refund-reason"
            hint="O cliente vê este motivo no app."
            error={errors.reason}
          >
            <Textarea
              id="refund-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div
            className="bg-muted grid gap-1 rounded-md p-3 text-sm"
            aria-live="polite"
            data-testid="refund-estimate"
          >
            {estimate ? (
              <>
                <Line
                  label="O cliente recebe"
                  value={`${formatMoney(estimate.refundCents)} no ${methodName === 'Pix' ? 'Pix' : 'cartão'}`}
                />
                <Line
                  label="Taxa devolvida ao espaço"
                  value={formatSignedMoney(estimate.feeRefundCents)}
                  positive
                />
                <Line
                  label="O espaço deixa de receber"
                  value={formatSignedMoney(-estimate.spaceLosesCents)}
                />
                <Line
                  label={`Fica em aberto na ${itemName}`}
                  value={formatMoney(estimate.openAfterCents)}
                />
              </>
            ) : (
              <p className="text-muted-foreground">Informe o valor para ver o efeito do estorno.</p>
            )}
            <p className="text-muted-foreground text-xs">
              Estimativa; o valor final aparece nos lançamentos.
            </p>
          </div>

          {item === 'reserva' ? (
            <p className="text-muted-foreground text-xs">
              Para cancelar a reserva e devolver tudo, use <strong>Cancelar reserva</strong>: o
              estorno é automático.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={refund.isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={refund.isPending || refundable <= 0}
            >
              {refund.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {refund.isPending
                ? 'Estornando…'
                : cents && cents > 0
                  ? `Estornar ${formatMoney(cents)}`
                  : 'Estornar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Etiqueta neutra "Online" do registro de pagamento feito pelo app. */
export function OnlineTag() {
  return <Badge variant="muted">Online</Badge>;
}

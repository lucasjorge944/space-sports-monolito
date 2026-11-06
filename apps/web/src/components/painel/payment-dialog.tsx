'use client';

import {
  isApiError,
  type PaymentMethod,
  type RecordablePayableType,
  useGetSpaceSettings,
  useRecordPayment,
} from '@space-sports/api-client';
import { centsToInput, parseMoneyToCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { formatMoney, formatTime, todayLocal } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { isFutureDate, paidAtFromDate } from '@/lib/painel/subscriptions';
import { Field } from './field';

export type Payable = {
  type: RecordablePayableType;
  id: string;
  /** Valor em aberto (centavos): é o máximo que a API aceita. */
  dueCents: number;
  /** Quem/o que está sendo pago, para o título (ex.: "Reserva de Ana"). */
  label: string;
  /** Mostra o campo "Data do pagamento" (para lançar recebimento de dias atrás). */
  askDate?: boolean;
  /** Cobrança online aberta do item: registrar no local a cancela (decisão 96). */
  openOnlineCharge?: { method: 'PIX' | 'CARD'; expiresAt: string | null } | null;
};

/** O cliente pagou pelo app enquanto o diálogo estava aberto (decisão 96). */
function alreadyPaidOnline(error: unknown): boolean {
  return isApiError(error) && error.code === 'ONLINE_CHARGE_ALREADY_PAID';
}

function recordErrorMessage(error: unknown, type: RecordablePayableType | undefined): string {
  if (alreadyPaidOnline(error)) {
    return type === 'BOOKING'
      ? 'O cliente acabou de pagar pelo app. A reserva foi atualizada.'
      : 'O aluno acabou de pagar pelo app. A mensalidade foi atualizada.';
  }
  return apiErrorMessage(error);
}

const ALL_METHODS: PaymentMethod[] = ['PIX', 'CARD', 'CASH', 'OTHER'];

/** Registrar pagamento recebido no espaço (RF-BOOK-08, RF-PAY-01, RN-PAY-01). */
export function PaymentDialog({
  spaceId,
  payable,
  onClose,
}: {
  spaceId: string;
  payable: Payable | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const settings = useGetSpaceSettings(spaceId);
  const accepted = settings.data?.acceptedPaymentMethods;
  const methods: PaymentMethod[] = accepted?.length ? [...accepted, 'OTHER'] : ALL_METHODS;
  const uniqueMethods = [...new Set(methods)];

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [fieldError, setFieldError] = useState<string>();
  const [dateError, setDateError] = useState<string>();
  const record = useRecordPayment();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia o formulário só quando o diálogo abre
  useEffect(() => {
    if (payable) {
      setAmount(centsToInput(payable.dueCents));
      setNote('');
      setPaidOn(todayLocal());
      setFieldError(undefined);
      setDateError(undefined);
      record.reset();
    }
  }, [payable?.id, payable?.type]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!payable) return;
    const cents = parseMoneyToCents(amount);
    if (!cents || cents <= 0) return setFieldError('Informe um valor acima de R$ 0,00');
    if (cents > payable.dueCents) {
      return setFieldError(
        `O valor passa do que está em aberto (${formatMoney(payable.dueCents)})`,
      );
    }
    setFieldError(undefined);
    if (payable.askDate && !paidOn) return setDateError('Informe a data do pagamento');
    if (payable.askDate && isFutureDate(paidOn)) {
      return setDateError('A data do pagamento não pode ser futura');
    }
    setDateError(undefined);
    const paidAt = payable.askDate ? paidAtFromDate(paidOn) : undefined;
    record.mutate(
      {
        spaceId,
        data: {
          payableType: payable.type,
          payableId: payable.id,
          amountCents: cents,
          method,
          ...(paidAt ? { paidAt } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Pagamento registrado.');
          void invalidateSpace(queryClient, spaceId);
          onClose();
        },
        // Já pago pelo app: recarrega o item para a tela mostrar o pagamento online.
        onError: (error) => {
          if (alreadyPaidOnline(error)) void invalidateSpace(queryClient, spaceId);
        },
      },
    );
  }

  return (
    <Dialog open={payable !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {payable?.label} · em aberto {payable ? formatMoney(payable.dueCents) : ''}
            </DialogDescription>
          </DialogHeader>
          {payable?.openOnlineCharge ? (
            <Alert variant="warning" role="status" data-testid="open-online-charge-warning">
              {openChargeWarning(payable.openOnlineCharge, payable.type)}
            </Alert>
          ) : null}
          <FormError
            message={record.error ? recordErrorMessage(record.error, payable?.type) : undefined}
          />
          <Field label="Valor recebido" htmlFor="pay-amount" error={fieldError}>
            <MaskedInput mask="money" id="pay-amount" value={amount} onValueChange={setAmount} />
          </Field>
          <Field label="Forma de pagamento" htmlFor="pay-method">
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {uniqueMethods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {payable?.askDate ? (
            <Field label="Data do pagamento" htmlFor="pay-date" error={dateError}>
              <DatePicker id="pay-date" value={paidOn} onValueChange={setPaidOn} />
            </Field>
          ) : null}
          <Field label="Observação" optional htmlFor="pay-note">
            <Input
              id="pay-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={record.isPending}>
              Voltar
            </Button>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function openChargeWarning(
  charge: NonNullable<Payable['openOnlineCharge']>,
  type: RecordablePayableType,
): string {
  const who = type === 'BOOKING' ? 'O cliente' : 'O aluno';
  const what =
    charge.method === 'PIX'
      ? `um Pix aberto pelo app${charge.expiresAt ? ` até ${formatTime(charge.expiresAt)}` : ''}`
      : 'um pagamento com cartão em processamento pelo app';
  return `${who} tem ${what}. Registrar o pagamento no local cancela essa cobrança.`;
}

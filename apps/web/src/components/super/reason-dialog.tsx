'use client';

import { type ReactNode, useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { describeError } from './query-states';

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Rótulo do campo de texto (motivo, nota…). */
  reasonLabel?: string;
  /** `false` esconde o campo (ação sem corpo na API); `onConfirm` recebe `undefined`. */
  withReason?: boolean;
  /** Sem texto o envio é bloqueado (ex.: motivo do modo suporte). */
  required?: boolean;
  /** Erro do campo vazio quando `required` (padrão: "Informe o <rótulo>"). */
  requiredMessage?: string;
  /** Texto do erro da API (padrão: `describeError`). */
  formatError?: (error: unknown) => string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  /** Executa a ação; rejeitar mostra o erro no diálogo e o mantém aberto. */
  onConfirm: (reason: string | undefined) => Promise<unknown>;
};

const MAX_REASON = 500;

/** Confirmação de ação sensível com motivo (suspender, encerrar, bloquear, modo suporte…). */
export function ReasonDialog(props: ReasonDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        {/* Remonta o conteúdo a cada abertura para zerar o texto e o erro. */}
        {props.open ? <ReasonForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  onOpenChange,
  title,
  description,
  withReason = true,
  reasonLabel = 'Motivo',
  required = false,
  requiredMessage,
  formatError = describeError,
  confirmLabel,
  pendingLabel,
  destructive = false,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (required && !text) {
      setError(requiredMessage ?? `Informe o ${reasonLabel.toLowerCase()}`);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await onConfirm(text || undefined);
      onOpenChange(false);
    } catch (thrown) {
      setError(formatError(thrown));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {withReason ? (
        <Field htmlFor="reason" label={reasonLabel} optional={!required}>
          <Textarea
            id="reason"
            name="reason"
            value={reason}
            maxLength={MAX_REASON}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={error && required && !reason.trim() ? true : undefined}
          />
        </Field>
      ) : null}
      <FormError message={error} />
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <SubmitButton
          pending={pending}
          pendingLabel={pendingLabel}
          variant={destructive ? 'destructive' : 'default'}
        >
          {confirmLabel}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

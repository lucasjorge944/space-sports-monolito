'use client';

import { type ClassSessionDetail, useCancelClassSession } from '@space-sports/api-client';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
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
import { formatDateTime } from '@/lib/format';
import { sessionErrorMessage } from '@/lib/painel/sessions-errors';

const MAX_REASON = 200;

/** Cancela a aula (RF-CLASS-09): o motivo é obrigatório e os alunos são avisados por notificação. */
export function CancelSessionDialog({
  open,
  onOpenChange,
  spaceId,
  session,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  session: ClassSessionDetail;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const cancel = useCancelClassSession({
    mutation: { onSuccess: onCancelled },
  });
  const { reset } = cancel;
  useEffect(() => {
    if (open) {
      setReason('');
      reset();
    }
  }, [open, reset]);

  const trimmed = reason.trim();
  const notified = session.attendances.filter((a) => a.status !== 'CANCELLED').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar a aula</DialogTitle>
          <DialogDescription>
            {session.classGroup.name} · {formatDateTime(session.startsAt)}. Os alunos matriculados e
            quem está na lista ou na espera serão avisados por notificação
            {notified > 0 ? ` (${notified} na lista agora)` : ''}. A quadra é liberada e a lista
            fica guardada no histórico.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Motivo do cancelamento"
          htmlFor="cancel-session-reason"
          hint={`O motivo aparece no aviso aos alunos (${trimmed.length}/${MAX_REASON}).`}
        >
          <Textarea
            id="cancel-session-reason"
            value={reason}
            maxLength={MAX_REASON}
            placeholder="Ex.: feriado, chuva forte, quadra em manutenção"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <FormError message={cancel.error ? sessionErrorMessage(cancel.error) : undefined} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending || trimmed.length === 0}
            onClick={() =>
              cancel.mutate({ spaceId, sessionId: session.id, data: { reason: trimmed } })
            }
          >
            {cancel.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Cancelar aula
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

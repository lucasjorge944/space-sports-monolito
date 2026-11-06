'use client';

import { type ClassSessionDetail, useRemoveClassSessionAttendee } from '@space-sports/api-client';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { FormError } from '@/components/auth/form-alert';
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
  isStaleSessionError,
  sessionErrorCode,
  sessionErrorMessage,
} from '@/lib/painel/sessions-errors';

type Target = ClassSessionDetail['attendances'][number];

/**
 * Remove o aluno da lista (a espera é promovida antes do início da aula). Quem já tem presença
 * marcada não sai: o 409 `PRESENCE_ALREADY_MARKED` aparece no diálogo e a tela é recarregada.
 */
export function RemoveAttendeeDialog({
  target,
  onClose,
  spaceId,
  sessionId,
  onRemoved,
  onStale,
}: {
  target: Target | null;
  onClose: () => void;
  spaceId: string;
  sessionId: string;
  onRemoved: (name: string) => void;
  onStale: () => void;
}) {
  const remove = useRemoveClassSessionAttendee({
    mutation: {
      onSuccess: () => onRemoved(target?.name ?? 'Aluno'),
      onError: (e) => {
        if (isStaleSessionError(e)) onStale();
      },
    },
  });
  const { reset } = remove;
  // Repetir não adianta: a presença já foi marcada por outra pessoa.
  const alreadyMarked = sessionErrorCode(remove.error) === 'PRESENCE_ALREADY_MARKED';
  useEffect(() => {
    if (target) reset();
  }, [target, reset]);

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover {target?.name} da aula?</DialogTitle>
          <DialogDescription>
            {target?.status === 'WAITLIST'
              ? 'O aluno sai da fila de espera e as posições seguintes sobem.'
              : 'A vaga é liberada e o primeiro da espera é promovido automaticamente, se a aula ainda não começou.'}
          </DialogDescription>
        </DialogHeader>
        <FormError message={remove.error ? sessionErrorMessage(remove.error) : undefined} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending || alreadyMarked || !target}
            onClick={() => target && remove.mutate({ spaceId, sessionId, userId: target.userId })}
          >
            {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Remover da aula
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

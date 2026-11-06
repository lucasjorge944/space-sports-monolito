'use client';

import {
  type Court,
  type CourtBlockDto,
  useCreateCourtBlock,
  useDeleteCourtBlock,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatTime } from '@/lib/format';
import { localToIso } from '@/lib/painel/agenda';
import { apiErrorMessage } from '@/lib/painel/errors';
import { invalidateSpace } from '@/lib/painel/query';
import { timeOptions } from './time-options';

export type BlockDraft = { courtId?: string; date: string; startMin?: number };

const START_OPTIONS = timeOptions(0, 24 * 60);
const END_OPTIONS = timeOptions(30, 24 * 60, true);

/** Bloquear horário da quadra: manutenção, evento (RF-BOOK-06). */
export function BlockDialog({
  scope,
  courts,
  draft,
  onClose,
}: {
  scope: SpaceScope;
  courts: Court[];
  draft: BlockDraft | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const usable = courts.filter((c) => c.status !== 'INACTIVE');
  const [courtId, setCourtId] = useState('');
  const [date, setDate] = useState('');
  const [startMin, setStartMin] = useState('480');
  const [endMin, setEndMin] = useState('600');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const create = useCreateCourtBlock();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia o formulário só quando o diálogo abre
  useEffect(() => {
    if (!draft) return;
    const start = draft.startMin ?? 480;
    setCourtId(draft.courtId ?? usable[0]?.id ?? '');
    setDate(draft.date);
    setStartMin(String(start));
    setEndMin(String(Math.min(start + 60, 24 * 60)));
    setReason('');
    setFieldError(undefined);
    create.reset();
  }, [draft]);

  // As quadras podem chegar depois de o diálogo abrir.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só reage à chegada das quadras
  useEffect(() => {
    if (draft && !courtId && usable[0]) setCourtId(usable[0].id);
  }, [draft, courtId, usable.length]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!courtId || !date) return setFieldError('Escolha a quadra e a data');
    if (Number(endMin) <= Number(startMin))
      return setFieldError('O fim precisa ser depois do início');
    setFieldError(undefined);
    create.mutate(
      {
        spaceId: scope.spaceId,
        data: {
          courtId,
          startsAt: localToIso(date, Number(startMin)),
          endsAt: localToIso(date, Number(endMin)),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Horário bloqueado.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Bloquear horário</DialogTitle>
            <DialogDescription>
              A quadra fica indisponível no período, sem reservas pelo app. Dá erro se já houver
              reserva no horário.
            </DialogDescription>
          </DialogHeader>
          <FormError message={create.error ? apiErrorMessage(create.error) : undefined} />
          <Field label="Quadra" htmlFor="block-court">
            <Select value={courtId} onValueChange={setCourtId}>
              <SelectTrigger id="block-court" className="w-full">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {usable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Data" htmlFor="block-date">
              <DatePicker id="block-date" value={date} onValueChange={setDate} />
            </Field>
            <Field label="Início" htmlFor="block-start">
              <Select value={startMin} onValueChange={setStartMin}>
                <SelectTrigger id="block-start" className="w-full tabular-nums">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {START_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fim" htmlFor="block-end">
              <Select value={endMin} onValueChange={setEndMin}>
                <SelectTrigger id="block-end" className="w-full tabular-nums">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {END_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Motivo" optional htmlFor="block-reason" error={fieldError}>
            <Textarea
              id="block-reason"
              maxLength={500}
              placeholder="Manutenção, evento, aula particular…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Voltar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Bloquear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Detalhe do bloqueio com a opção de removê-lo. */
export function BlockInfoDialog({
  scope,
  block,
  courtName,
  onClose,
}: {
  scope: SpaceScope;
  block: CourtBlockDto | null;
  courtName?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useDeleteCourtBlock();
  return (
    <Dialog open={block !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Horário bloqueado</DialogTitle>
          <DialogDescription>
            {courtName} ·{' '}
            {block ? `${formatDateTime(block.startsAt)} – ${formatTime(block.endsAt)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{block?.reason ?? 'Sem motivo informado.'}</p>
        <FormError message={remove.error ? apiErrorMessage(remove.error) : undefined} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {scope.canWrite('booking.create') && block ? (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { spaceId: scope.spaceId, blockId: block.id },
                  {
                    onSuccess: () => {
                      toast.success('Bloqueio removido.');
                      void invalidateSpace(queryClient, scope.spaceId);
                      onClose();
                    },
                  },
                )
              }
            >
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Remover bloqueio
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

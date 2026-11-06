'use client';

import {
  type Chargeback,
  useDisputeChargeback,
  useListChargebacks,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/painel/states';
import { StatusBadge } from '@/components/painel/status-badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney, formatShortDate, formatShortDateTime, formatTime } from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import { DISPUTE_STATUS } from '@/lib/painel/labels';
import {
  disputeDeadline,
  disputeTextError,
  parseAttachmentUrls,
} from '@/lib/painel/online-payments';
import { invalidateSpace } from '@/lib/painel/query';
import { chargeMonth } from '@/lib/painel/subscriptions';
import { cn } from '@/lib/utils';

/** "Reserva · 08/11 18:00" ou "Mensalidade · nov 2026". */
function itemLabel(cb: Chargeback): string {
  if (cb.charge.payableType === 'BOOKING') {
    return cb.itemStartsAt ? `Reserva · ${formatShortDateTime(cb.itemStartsAt)}` : 'Reserva';
  }
  return cb.itemPeriodStart ? `Mensalidade · ${chargeMonth(cb.itemPeriodStart)}` : 'Mensalidade';
}

/** Aba "Contestações" (RF-ONPAY-09): contestações no cartão, prazo e resposta. */
export function ChargebacksView({ scope, enabled }: { scope: SpaceScope; enabled: boolean }) {
  const query = useListChargebacks(scope.spaceId);
  const [answering, setAnswering] = useState<Chargeback | null>(null);
  const [viewing, setViewing] = useState<Chargeback | null>(null);

  if (query.isPending) return <LoadingBlock rows={3} label="Carregando contestações" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhuma contestação"
        description="Quando um cliente contestar um pagamento com o banco do cartão, ela aparece aqui."
      />
    );
  }
  const canAnswer = enabled && scope.canWrite('payments.online.manage');

  return (
    <>
      <div className="rounded-lg border">
        <Table aria-label="Contestações">
          <TableHeader>
            <TableRow>
              <TableHead>Aberta em</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Valor contestado</TableHead>
              <TableHead>Responder até</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((cb) => {
              const deadline = disputeDeadline(cb.dispute.respondBy);
              const awaiting = cb.dispute.status === 'AWAITING_RESPONSE' && !deadline.closed;
              return (
                <TableRow key={cb.id} data-testid="chargeback-row">
                  <TableCell className="tabular-nums">{formatShortDate(cb.createdAt)}</TableCell>
                  <TableCell>{cb.charge.payer.name}</TableCell>
                  <TableCell>{itemLabel(cb)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(cb.amountCents)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'tabular-nums',
                      deadline.urgent && 'text-warning-subtle-foreground',
                      deadline.closed && 'text-muted-foreground',
                    )}
                  >
                    {cb.dispute.status === 'AWAITING_RESPONSE' ? deadline.text : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge info={DISPUTE_STATUS[cb.dispute.status]} />
                  </TableCell>
                  <TableCell className="text-right">
                    {awaiting ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canAnswer}
                        title={
                          enabled ? undefined : 'Indisponível com o pagamento online desligado'
                        }
                        onClick={() => setAnswering(cb)}
                      >
                        Responder
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setViewing(cb)}>
                        Ver
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <DisputeDialog scope={scope} chargeback={answering} onClose={() => setAnswering(null)} />
      <DisputeView chargeback={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function summary(cb: Chargeback): string {
  const item =
    cb.charge.payableType === 'BOOKING'
      ? cb.itemStartsAt
        ? `reserva de ${formatShortDate(cb.itemStartsAt)}, ${formatTime(cb.itemStartsAt)}`
        : 'reserva'
      : cb.itemPeriodStart
        ? `mensalidade de ${chargeMonth(cb.itemPeriodStart)}`
        : 'mensalidade';
  return `${cb.charge.payer.name} contestou ${formatMoney(cb.amountCents)} com o banco do cartão (${item}). Quem decide é o banco.`;
}

function DisputeDialog({
  scope,
  chargeback,
  onClose,
}: {
  scope: SpaceScope;
  chargeback: Chargeback | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dispute = useDisputeChargeback();
  const [text, setText] = useState('');
  const [links, setLinks] = useState('');
  const [errors, setErrors] = useState<{ text?: string; links?: string }>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia ao abrir
  useEffect(() => {
    if (chargeback) {
      setText('');
      setLinks('');
      setErrors({});
      dispute.reset();
    }
  }, [chargeback?.id]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chargeback) return;
    const attachments = parseAttachmentUrls(links);
    const next = { text: disputeTextError(text), links: attachments.error };
    setErrors(next);
    if (next.text || next.links) return;
    dispute.mutate(
      {
        spaceId: scope.spaceId,
        chargebackId: chargeback.id,
        data: { text: text.trim(), attachmentUrls: attachments.urls },
      },
      {
        onSuccess: () => {
          toast.success('Resposta enviada');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={chargeback !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Responder contestação</DialogTitle>
            <DialogDescription>
              {chargeback ? summary(chargeback) : ''} O valor já saiu do saldo, e a taxa de serviço
              dele foi devolvida. Se o banco der razão ao espaço, o valor volta.
            </DialogDescription>
          </DialogHeader>
          <FormError message={dispute.error ? apiErrorMessage(dispute.error) : undefined} />
          <Field
            label="Sua resposta"
            htmlFor="dispute-text"
            error={errors.text}
            hint={`Conte o que comprova o serviço: reserva usada, conversa com o cliente, horário de chegada. ${text.trim().length}/2000`}
          >
            <Textarea
              id="dispute-text"
              rows={5}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Field
            label="Links de anexos"
            optional
            htmlFor="dispute-links"
            error={errors.links}
            hint="Até 3 links (https://), um por linha: fotos, PDFs ou prints da conversa."
          >
            <Textarea
              id="dispute-links"
              rows={2}
              value={links}
              onChange={(e) => setLinks(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={dispute.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={dispute.isPending}>
              {dispute.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {dispute.isPending ? 'Enviando…' : 'Enviar resposta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DisputeView({
  chargeback,
  onClose,
}: {
  chargeback: Chargeback | null;
  onClose: () => void;
}) {
  const d = chargeback?.dispute;
  return (
    <Dialog open={chargeback !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Contestação</DialogTitle>
          <DialogDescription>{chargeback ? summary(chargeback) : ''}</DialogDescription>
        </DialogHeader>
        {d ? (
          <div className="grid gap-3 text-sm">
            <StatusBadge info={DISPUTE_STATUS[d.status]} />
            {d.responseText ? (
              <div className="grid gap-1">
                <p className="font-medium">
                  Resposta enviada{d.respondedAt ? ` em ${formatShortDate(d.respondedAt)}` : ''}
                </p>
                <p className="text-muted-foreground whitespace-pre-line">{d.responseText}</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhuma resposta enviada.</p>
            )}
            {d.attachmentUrls.length > 0 ? (
              <ul className="grid gap-1">
                {d.attachmentUrls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer" className="text-link underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {d.resolvedAt ? (
              <p className="text-muted-foreground">
                Resultado informado em {formatShortDate(d.resolvedAt)}.
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

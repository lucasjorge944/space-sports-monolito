'use client';

import {
  type SpaceBookingDetailDto,
  type SpaceBookingParticipantDto,
  useCancelSpaceBooking,
  useCompleteSpaceBooking,
  useConfirmDeskCustomerLink,
  useGetSpaceBooking,
  useMarkSpaceBookingNoShow,
  useReversePayment,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Link2,
  Loader2,
  type LucideIcon,
  Repeat,
  Smartphone,
  Store,
  UserRound,
  Users,
  UserX,
  Wallet,
  Zap,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPhone,
  formatSignedMoney,
  formatTime,
} from '@/lib/format';
import { apiErrorMessage } from '@/lib/painel/errors';
import {
  BOOKING_PAYMENT_STATUS,
  BOOKING_SOURCE_LABEL,
  BOOKING_STATUS,
  PAYMENT_METHOD_LABEL,
} from '@/lib/painel/labels';
import { cancelReasonText } from '@/lib/painel/online-payments';
import { bookingDue } from '@/lib/painel/payments';
import { invalidateSpace } from '@/lib/painel/query';
import { cn, overline } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import { OnlineChargesSection, OnlineTag } from './online/online-charges';
import { type Payable, PaymentDialog } from './payment-dialog';
import { ReasonDialog } from './reason-dialog';
import type { SpaceScope } from './space-scope';
import { ErrorState, LoadingBlock } from './states';
import { StatusBadge } from './status-badge';

const PARTICIPANT_STATUS_LABEL: Record<SpaceBookingParticipantDto['status'], string> = {
  INVITED: 'convite enviado',
  ACCEPTED: 'aceitou',
  DECLINED: 'recusou',
};

const SOURCE_ICON: Record<SpaceBookingDetailDto['source'], LucideIcon> = {
  APP: Smartphone,
  DESK: Store,
  RECURRING: Repeat,
};

type Props = {
  scope: SpaceScope;
  bookingId: string | null;
  onClose: () => void;
};

/** Detalhe da reserva com participantes e pagamentos (RF-BOOK-04, RF-BOOK-08, RF-PAY-01). */
export function BookingDetailSheet({ scope, bookingId, onClose }: Props) {
  return (
    <Sheet open={bookingId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Reserva</SheetTitle>
          <SheetDescription>
            {scope.can('payment.record')
              ? 'Situação, horário, cliente, valores e participantes.'
              : 'Situação, horário, cliente e participantes.'}
          </SheetDescription>
        </SheetHeader>
        {bookingId ? <Body scope={scope} bookingId={bookingId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ scope, bookingId }: { scope: SpaceScope; bookingId: string }) {
  const query = useGetSpaceBooking(scope.spaceId, bookingId);
  if (query.isPending)
    return (
      <div className="px-4">
        <LoadingBlock rows={5} />
      </div>
    );
  if (query.isError) {
    return (
      <div className="px-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  return <Detail scope={scope} booking={query.data} />;
}

function Detail({ scope, booking }: { scope: SpaceScope; booking: SpaceBookingDetailDto }) {
  const queryClient = useQueryClient();
  const canManage = scope.canWrite('booking.create');
  const canPay = scope.canWrite('payment.record');
  const [payable, setPayable] = useState<Payable | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const done = (message: string) => {
    toast.success(message);
    void invalidateSpace(queryClient, scope.spaceId);
  };
  const cancel = useCancelSpaceBooking();
  const complete = useCompleteSpaceBooking({
    mutation: {
      onSuccess: () => done('Reserva concluída.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    },
  });
  const noShow = useMarkSpaceBookingNoShow({
    mutation: {
      onSuccess: () => done('Marcada como não compareceu.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    },
  });
  const reverse = useReversePayment();
  const link = useConfirmDeskCustomerLink();

  const active = booking.status === 'CONFIRMED';
  const pendingPayment = booking.status === 'PENDING_PAYMENT';
  const due = bookingDue(booking);
  const busy = complete.isPending || noShow.isPending;
  // Decisão 96: em PENDING_PAYMENT o cliente está pagando pelo app; não há registro no local.
  const canReceive = canPay && booking.status !== 'CANCELLED' && !pendingPayment && due > 0;
  const canCancel = canManage && (active || pendingPayment);
  // Cancelamento pelo espaço estorna sozinho o que foi pago online (decisão 86).
  const paidOnlineCents = booking.onlineCharges.reduce(
    (sum, c) => sum + Math.max(c.refundableCents, 0),
    0,
  );
  const suggested = canManage ? booking.suggestedUser : null;
  const fromPlan = booking.source === 'RECURRING';

  return (
    <div className="flex flex-col gap-5 px-4 pb-6" data-testid="booking-detail">
      <dl className="flex flex-wrap gap-x-4 gap-y-2 text-sm" data-testid="booking-status">
        <StatusItem icon={CalendarCheck} label="Reserva">
          <StatusBadge info={BOOKING_STATUS[booking.status]} />
        </StatusItem>
        {booking.paymentStatus ? (
          <StatusItem icon={Wallet} label="Pagamento">
            <StatusBadge info={BOOKING_PAYMENT_STATUS[booking.paymentStatus]} />
          </StatusItem>
        ) : null}
        <StatusItem icon={SOURCE_ICON[booking.source]} label="Origem">
          <span className="font-medium">{BOOKING_SOURCE_LABEL[booking.source]}</span>
        </StatusItem>
      </dl>

      <Section icon={CalendarClock} title="Quando e onde">
        <p className="text-lg font-semibold">
          {booking.court.name} · {booking.sport.name}
        </p>
        <p className="text-muted-foreground tabular-nums">
          {formatDateTime(booking.startsAt)} – {formatTime(booking.endsAt)} ·{' '}
          {formatDuration(booking.durationMin)} · {booking.peopleCount} pessoas
        </p>
        {pendingPayment && booking.paymentDueAt ? (
          <p className="text-warning-subtle-foreground" data-testid="payment-hold">
            Horário guardado até {formatTime(booking.paymentDueAt)} · o cliente está pagando pelo
            app.
          </p>
        ) : null}
        {booking.status === 'CANCELLED' && booking.cancelReason ? (
          <p className="text-muted-foreground">
            Motivo do cancelamento: {cancelReasonText(booking.cancelReason)}
          </p>
        ) : null}
      </Section>

      <Section icon={UserRound} title="Cliente">
        <p>{booking.organizer.name}</p>
        {booking.organizer.phone ? (
          <p className="text-muted-foreground tabular-nums">
            {formatPhone(booking.organizer.phone)}
          </p>
        ) : null}
        {!booking.organizer.userId ? (
          <p className="text-muted-foreground text-xs">Cliente de balcão, sem o app.</p>
        ) : null}
        {suggested ? (
          <div className="grid gap-2 rounded-md border p-3" data-testid="suggested-user">
            <p>
              Este telefone é de uma conta: <strong>{suggested.firstName}</strong>. Confira com o
              cliente antes de vincular.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                link.reset();
                setLinkOpen(true);
              }}
            >
              <Link2 />
              Vincular a esta conta
            </Button>
          </div>
        ) : null}
      </Section>

      {booking.priceCents !== null && booking.paidCents !== null ? (
        <Section icon={Wallet} title="Valores">
          <div className="grid gap-1 tabular-nums">
            <div className="flex justify-between">
              <span>Total</span>
              <span>{formatMoney(booking.priceCents)}</span>
            </div>
            {booking.discountCents ? (
              <div className="flex justify-between">
                <span>Abatimento por estorno</span>
                <span>{formatSignedMoney(-booking.discountCents)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>Recebido</span>
              <span>{formatMoney(booking.paidCents)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Em aberto</span>
              <span>{formatMoney(due)}</span>
            </div>
          </div>
          {booking.payments.length === 0 ? (
            <p className="text-muted-foreground">Nenhum pagamento registrado.</p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label="Pagamentos registrados">
              {booking.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className={p.reversedAt ? 'text-muted-foreground line-through' : ''}>
                    <p className="flex items-center gap-2 font-medium tabular-nums">
                      {formatMoney(p.amountCents)} · {PAYMENT_METHOD_LABEL[p.method]}
                      {p.channel === 'ONLINE' ? <OnlineTag /> : null}
                    </p>
                    <p className="text-xs tabular-nums">
                      {formatDateTime(p.paidAt)}
                      {/* Registro antigo (decisão 50): não se recebe mais por pessoa, mas o histórico fica. */}
                      {p.payableType === 'BOOKING_PARTICIPANT' ? ' · parte de participante' : ''}
                      {p.note ? ` · ${p.note}` : ''}
                    </p>
                  </div>
                  {p.reversedAt ? (
                    <span className="text-muted-foreground text-xs">Estornado</span>
                  ) : canPay && p.channel !== 'ONLINE' ? (
                    // O pagamento online só sai pelo estorno da cobrança (bloco abaixo).
                    <Button size="sm" variant="ghost" onClick={() => setReversing(p.id)}>
                      Estornar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canPay || scope.can('payments.online.manage') ? (
        <OnlineChargesSection
          scope={scope}
          charges={booking.onlineCharges}
          openCharge={booking.openOnlineCharge}
          item="reserva"
        />
      ) : null}

      <Section icon={Users} title="Participantes">
        {booking.participants.length === 0 ? (
          <p className="text-muted-foreground">Ninguém além do cliente.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border">
              {booking.participants.map((p) => (
                <li key={p.id} className="px-3 py-2">
                  <p className="truncate font-medium">
                    {p.name ?? 'Convite pendente'}
                    {p.isOrganizer ? ' (organizador)' : ''}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {p.shareCents !== null ? `Parte ${formatMoney(p.shareCents)} · ` : ''}
                    {PARTICIPANT_STATUS_LABEL[p.status]}
                  </p>
                </li>
              ))}
            </ul>
            {booking.participants.length > 1 && booking.priceCents !== null ? (
              <p className="text-muted-foreground text-xs">
                A divisão é só informação para os jogadores: o recebimento é da reserva inteira.
              </p>
            ) : null}
          </>
        )}
      </Section>

      {canReceive || canCancel ? (
        <Section icon={Zap} title="Ações" className="border-t pt-4">
          <div className="flex flex-wrap gap-2">
            {canReceive ? (
              <Button
                size="sm"
                onClick={() =>
                  setPayable({
                    type: 'BOOKING',
                    id: booking.id,
                    dueCents: due,
                    label: `Reserva de ${booking.organizer.name}`,
                    openOnlineCharge: booking.openOnlineCharge,
                  })
                }
              >
                <HandCoins />
                Registrar pagamento
              </Button>
            ) : null}
            {canManage && active ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => complete.mutate({ spaceId: scope.spaceId, bookingId: booking.id })}
                >
                  {complete.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 />
                  )}
                  Concluir
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => noShow.mutate({ spaceId: scope.spaceId, bookingId: booking.id })}
                >
                  {noShow.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <UserX />}
                  Não compareceu
                </Button>
              </>
            ) : null}
            {canCancel ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setCancelOpen(true)}
              >
                <Ban />
                Cancelar reserva
              </Button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <PaymentDialog spaceId={scope.spaceId} payable={payable} onClose={() => setPayable(null)} />

      <ConfirmDialog
        open={linkOpen && suggested !== null}
        onOpenChange={setLinkOpen}
        title="Vincular a esta conta"
        description={
          fromPlan
            ? `O mensalista e as próximas reservas dele passam para a conta de ${suggested?.firstName}.`
            : `A reserva passa para a conta de ${suggested?.firstName} e aparece em Minhas reservas.`
        }
        confirmLabel="Vincular"
        destructive={false}
        pending={link.isPending}
        error={link.error}
        onConfirm={() => {
          if (!suggested) return;
          link.mutate(
            { spaceId: scope.spaceId, bookingId: booking.id, data: { userId: suggested.id } },
            {
              onSuccess: () => {
                setLinkOpen(false);
                done(fromPlan ? 'Mensalista vinculado à conta.' : 'Reserva vinculada à conta.');
              },
              // A sugestão pode ter mudado: recarrega para o sheet mostrar a situação atual.
              onError: () => void invalidateSpace(queryClient, scope.spaceId),
            },
          );
        }}
      />

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar reserva"
        description={
          paidOnlineCents > 0
            ? `A quadra é liberada na hora. O cliente recebe ${formatMoney(paidOnlineCents)} de volta automaticamente, e a taxa de serviço volta para o espaço.`
            : 'A quadra é liberada na hora. O cliente é avisado pelo app, se tiver.'
        }
        confirmLabel="Cancelar reserva"
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) =>
          cancel.mutate(
            { spaceId: scope.spaceId, bookingId: booking.id, data: reason ? { reason } : {} },
            {
              onSuccess: () => {
                setCancelOpen(false);
                done('Reserva cancelada.');
              },
            },
          )
        }
      />

      <ReasonDialog
        open={reversing !== null}
        onOpenChange={(open) => !open && setReversing(null)}
        title="Estornar pagamento"
        description="O valor deixa de contar como recebido. A ação fica registrada na auditoria."
        confirmLabel="Estornar"
        pending={reverse.isPending}
        error={reverse.error}
        onConfirm={(reason) => {
          if (!reversing) return;
          reverse.mutate(
            { spaceId: scope.spaceId, paymentId: reversing, data: reason ? { reason } : {} },
            {
              onSuccess: () => {
                setReversing(null);
                done('Pagamento estornado.');
              },
            },
          );
        }}
      />
    </div>
  );
}

function StatusItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <dt className="text-muted-foreground">{label}: </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('grid gap-2 text-sm', className)}>
      <h3 className={cn(overline, 'flex items-center gap-1.5')}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

import type { BookingPaymentStatus, BookingStatus, InviteStatus } from '@space-sports/api-client';

type Variant = 'default' | 'secondary' | 'muted' | 'success' | 'warning' | 'destructive';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, { label: string; variant: Variant }> = {
  // RN-ONPAY-02: modo obrigatório, horário guardado até `paymentDueAt`.
  PENDING_PAYMENT: { label: 'Aguardando pagamento', variant: 'warning' },
  CONFIRMED: { label: 'Confirmada', variant: 'success' },
  COMPLETED: { label: 'Concluída', variant: 'muted' },
  CANCELLED: { label: 'Cancelada', variant: 'destructive' },
  NO_SHOW: { label: 'Não compareceu', variant: 'warning' },
};

export const PAYMENT_STATUS_LABELS: Record<
  BookingPaymentStatus,
  { label: string; variant: Variant }
> = {
  PENDING: { label: 'Pagamento pendente', variant: 'warning' },
  PARTIALLY_PAID: { label: 'Pago em parte', variant: 'warning' },
  PAID: { label: 'Pago', variant: 'success' },
};

export const INVITE_STATUS_LABELS: Record<InviteStatus, { label: string; variant: Variant }> = {
  INVITED: { label: 'Convidado', variant: 'warning' },
  ACCEPTED: { label: 'Confirmado', variant: 'success' },
  DECLINED: { label: 'Recusou', variant: 'muted' },
};

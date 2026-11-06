import type {
  AttendanceMode,
  BookingPaymentStatus,
  BookingSource,
  BookingStatus,
  ClassAttendancesResponseItemsItemSessionStatus,
  ClassAttendancesResponseItemsItemStatus,
  ClassGroupLevel,
  CourtStatus,
  PaymentMethod,
  RecurringStatus,
  SpaceRole,
  SubscriptionChargeStatus,
  SubscriptionDetailEnrollmentsItemStatus,
  SubscriptionDetailStatus,
} from '@space-sports/api-client';
import type {
  BookingPaymentMode,
  ChargebackDisputeStatus,
  ClassPaymentMode,
  LedgerEntryKind,
  MerchantAccountStatus,
  OnlineChargeStatus,
  OnlinePaymentMethod,
  PaymentChannel,
  PayoutStatus,
} from '@space-sports/shared';

export type BadgeTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'
  | 'muted';
type Label = { label: string; tone: BadgeTone };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
  OTHER: 'Outro',
};

export const BOOKING_STATUS: Record<BookingStatus, Label> = {
  PENDING_PAYMENT: { label: 'Aguardando pagamento', tone: 'warning' },
  CONFIRMED: { label: 'Confirmada', tone: 'success' },
  COMPLETED: { label: 'Concluída', tone: 'info' },
  CANCELLED: { label: 'Cancelada', tone: 'destructive' },
  NO_SHOW: { label: 'Não compareceu', tone: 'destructive' },
};

export const BOOKING_PAYMENT_STATUS: Record<BookingPaymentStatus, Label> = {
  PENDING: { label: 'Pendente', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Parcial', tone: 'info' },
  PAID: { label: 'Pago', tone: 'success' },
};

export const BOOKING_SOURCE_LABEL: Record<BookingSource, string> = {
  APP: 'App',
  DESK: 'Balcão',
  RECURRING: 'Mensalista',
};

export const RECURRING_STATUS: Record<RecurringStatus, Label> = {
  PENDING_APPROVAL: { label: 'Aguardando aprovação', tone: 'warning' },
  ACTIVE: { label: 'Ativo', tone: 'success' },
  PAUSED: { label: 'Pausado', tone: 'info' },
  ENDED: { label: 'Encerrado', tone: 'muted' },
  REJECTED: { label: 'Recusado', tone: 'destructive' },
};

export const COURT_STATUS: Record<CourtStatus, Label> = {
  ACTIVE: { label: 'Ativa', tone: 'success' },
  MAINTENANCE: { label: 'Manutenção', tone: 'warning' },
  INACTIVE: { label: 'Inativa', tone: 'muted' },
};

export const ROLE_LABEL: Record<SpaceRole, string> = {
  OWNER: 'Dono',
  ADMIN: 'Admin',
  TEACHER: 'Professor',
};

export const WEEKDAY_LABEL = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export const CLASS_LEVEL_LABEL: Record<NonNullable<ClassGroupLevel>, string> = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
  PRO: 'Profissional',
};

export const ATTENDANCE_MODE_LABEL: Record<AttendanceMode, string> = {
  AUTOMATIC: 'Automática',
  MANUAL: 'Manual',
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionDetailStatus, Label> = {
  PENDING_APPROVAL: { label: 'Aguardando aprovação', tone: 'warning' },
  ACTIVE: { label: 'Ativa', tone: 'success' },
  PAST_DUE: { label: 'Inadimplente', tone: 'destructive' },
  CANCELLED: { label: 'Cancelada', tone: 'destructive' },
};

export const ENROLLMENT_STATUS: Record<SubscriptionDetailEnrollmentsItemStatus, Label> = {
  PENDING: { label: 'Pedida', tone: 'warning' },
  ACTIVE: { label: 'Matriculado', tone: 'success' },
  ENDED: { label: 'Encerrada', tone: 'muted' },
};

export const CHARGE_STATUS: Record<SubscriptionChargeStatus, Label> = {
  PENDING: { label: 'A vencer', tone: 'warning' },
  OVERDUE: { label: 'Vencida', tone: 'destructive' },
  PAID: { label: 'Paga', tone: 'success' },
  WAIVED: { label: 'Dispensada', tone: 'muted' },
};

/** Presença no histórico: confirmado numa aula já dada sem marcação aparece como "Sem marcação". */
export function attendanceInfo(
  status: ClassAttendancesResponseItemsItemStatus,
  sessionStatus: ClassAttendancesResponseItemsItemSessionStatus,
): Label {
  switch (status) {
    case 'PRESENT':
      return { label: 'Presente', tone: 'success' };
    case 'ABSENT':
      return { label: 'Faltou', tone: 'destructive' };
    case 'WAITLIST':
      return { label: 'Na espera', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Desistiu', tone: 'muted' };
    case 'CONFIRMED':
      return sessionStatus === 'DONE'
        ? { label: 'Sem marcação', tone: 'warning' }
        : { label: 'Confirmado', tone: 'success' };
  }
}

// Pagamento online (docs/05-design-system.md, "Pagamento online": um rótulo por status, o mesmo no
// app e no painel).

export const ONLINE_CHARGE_STATUS: Record<OnlineChargeStatus, Label> = {
  PENDING: { label: 'Aguardando pagamento', tone: 'warning' },
  PAID: { label: 'Pago', tone: 'success' },
  EXPIRED: { label: 'Vencido', tone: 'muted' },
  FAILED: { label: 'Recusado', tone: 'destructive' },
  CANCELLED: { label: 'Cancelado', tone: 'muted' },
  PARTIALLY_REFUNDED: { label: 'Estorno parcial', tone: 'info' },
  REFUNDED: { label: 'Estornado', tone: 'info' },
  CHARGEBACK: { label: 'Contestado no cartão', tone: 'destructive' },
};

export const MERCHANT_STATUS: Record<MerchantAccountStatus, Label> = {
  NOT_STARTED: { label: 'Não iniciado', tone: 'muted' },
  PENDING: { label: 'Em análise', tone: 'warning' },
  APPROVED: { label: 'Aprovado', tone: 'success' },
  REJECTED: { label: 'Recusado', tone: 'destructive' },
};

export const PAYOUT_STATUS: Record<PayoutStatus, Label> = {
  SCHEDULED: { label: 'Agendado', tone: 'info' },
  PAID: { label: 'Repassado', tone: 'success' },
  FAILED: { label: 'Falhou', tone: 'destructive' },
};

export const DISPUTE_STATUS: Record<ChargebackDisputeStatus, Label> = {
  AWAITING_RESPONSE: { label: 'Aguardando resposta', tone: 'warning' },
  RESPONDED: { label: 'Resposta enviada', tone: 'info' },
  WON: { label: 'Ganha', tone: 'success' },
  LOST: { label: 'Perdida', tone: 'destructive' },
};

/** Lançamentos da carteira (sem badge: o sinal vai no valor). */
export const LEDGER_KIND_LABEL: Record<LedgerEntryKind, string> = {
  SALE: 'Venda',
  PLATFORM_FEE: 'Taxa de serviço',
  REFUND: 'Estorno ao cliente',
  FEE_REFUND: 'Taxa devolvida',
  CHARGEBACK: 'Contestação no cartão',
  PAYOUT: 'Repasse',
  ADJUSTMENT: 'Ajuste',
};

/** Meio do pagamento online, curto ("Cartão") e longo ("Cartão de crédito"). */
export const ONLINE_METHOD_LABEL: Record<OnlinePaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
};
export const ONLINE_METHOD_LONG_LABEL: Record<OnlinePaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão de crédito',
};

export const PAYMENT_CHANNEL_LABEL: Record<PaymentChannel, string> = {
  ON_SITE: 'No local',
  ONLINE: 'Online',
};

export const BOOKING_MODE_LABEL: Record<BookingPaymentMode, string> = {
  ON_SITE: 'Só no local',
  ONLINE_OPTIONAL: 'No local ou online',
  ONLINE_REQUIRED: 'Online obrigatório',
};

export const CLASS_MODE_LABEL: Record<ClassPaymentMode, string> = {
  ON_SITE: 'Só no local',
  ONLINE_OPTIONAL: 'No local ou online',
};

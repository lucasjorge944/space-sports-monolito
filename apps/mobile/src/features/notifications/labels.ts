import type { NotificationPreferencesItemsItemType } from '@space-sports/api-client';

/** Rótulos das preferências por tipo (RF-NOTIF-01/04). */
export const PREFERENCE_LABELS: Record<
  NotificationPreferencesItemsItemType,
  { title: string; description: string }
> = {
  BOOKING_CONFIRMED: {
    title: 'Reserva confirmada',
    description: 'Quando sua reserva é confirmada.',
  },
  BOOKING_CANCELLED: {
    title: 'Reserva cancelada',
    description: 'Quando uma reserva sua é cancelada.',
  },
  BOOKING_UPDATED: {
    title: 'Reserva alterada',
    description: 'Quando muda algo em uma reserva em que você joga.',
  },
  BOOKING_REMINDER: { title: 'Lembrete de reserva', description: 'Um aviso pouco antes do jogo.' },
  BOOKING_INVITE: {
    title: 'Convite para dividir a conta',
    description: 'Quando alguém convida você para um jogo.',
  },
  BOOKING_INVITE_ANSWERED: {
    title: 'Resposta a um convite',
    description: 'Quando um convidado confirma ou recusa pela página do convite.',
  },
  BOOKING_LINKED: {
    title: 'Reserva na sua conta',
    description: 'Quando uma reserva em que você confirmou presença passa para a sua conta.',
  },
  RECURRING_APPROVED: {
    title: 'Mensalista aprovado',
    description: 'Quando o espaço aprova seu horário fixo.',
  },
  RECURRING_REJECTED: {
    title: 'Mensalista recusado',
    description: 'Quando o espaço recusa seu horário fixo.',
  },
  SUBSCRIPTION_APPROVED: {
    title: 'Assinatura aprovada',
    description: 'Quando o espaço aprova sua assinatura de aula.',
  },
  SUBSCRIPTION_REJECTED: {
    title: 'Assinatura recusada',
    description: 'Quando o espaço recusa sua assinatura de aula.',
  },
  SUBSCRIPTION_CANCELLED: {
    title: 'Plano cancelado',
    description: 'Quando sua assinatura de aula é cancelada, com a data em que o acesso termina.',
  },
  SUBSCRIPTION_CANCEL_RESUMED: {
    title: 'Cancelamento desfeito',
    description: 'Quando o cancelamento da sua assinatura de aula é desfeito.',
  },
  SUBSCRIPTION_CHARGE_DUE_SOON: {
    title: 'Mensalidade perto de vencer',
    description: 'Um aviso antes do vencimento da mensalidade da aula.',
  },
  SUBSCRIPTION_CHARGE_OVERDUE: {
    title: 'Mensalidade em atraso',
    description: 'Quando a mensalidade da aula passa do vencimento.',
  },
  CLASS_LIST_OPEN: {
    title: 'Lista de presença aberta',
    description: 'Quando a lista de uma aula sua é aberta.',
  },
  CLASS_WAITLIST_PROMOTED: {
    title: 'Vaga confirmada na aula',
    description: 'Quando você sai da lista de espera de uma aula.',
  },
  CLASS_SESSION_CANCELLED: {
    title: 'Aula cancelada',
    description: 'Quando uma aula sua é cancelada.',
  },
  SPACE_BOOKING_UPDATED: {
    title: 'Reservas alteradas no espaço',
    description: 'Quando um jogador altera uma reserva do espaço que você gerencia.',
  },
  // Pagamento online (docs/05, "App — notificações"; docs/13 §13).
  PAYMENT_CONFIRMED: {
    title: 'Pagamento confirmado',
    description: 'Quando um pagamento seu pelo app (Pix ou cartão) é confirmado.',
  },
  PAYMENT_EXPIRED: {
    title: 'Pix vencido ou reserva cancelada',
    description:
      'Quando um Pix vence sem pagamento ou a reserva é cancelada por falta de pagamento.',
  },
  PAYMENT_REFUNDED: {
    title: 'Estorno',
    description: 'Quando um valor pago pelo app volta para você.',
  },
  PAYMENT_CHARGEBACK: {
    title: 'Contestação no cartão',
    description: 'Quando um cliente contesta um pagamento do espaço que você gerencia.',
  },
  MERCHANT_ACCOUNT_APPROVED: {
    title: 'Conta de recebimento aprovada',
    description: 'Quando a conta de recebimento do espaço é aprovada.',
  },
  MERCHANT_ACCOUNT_REJECTED: {
    title: 'Conta de recebimento recusada',
    description: 'Quando o cadastro da conta de recebimento do espaço é recusado.',
  },
  MERCHANT_PAYOUT_ACCOUNT_CHANGED: {
    title: 'Conta bancária trocada',
    description: 'Quando a conta que recebe os repasses do espaço é trocada.',
  },
  MERCHANT_PAYOUT_CHANGE_REJECTED: {
    title: 'Troca de conta recusada',
    description: 'Quando a troca da conta de recebimento do espaço é recusada.',
  },
  PAYOUT_FAILED: {
    title: 'Repasse não enviado',
    description: 'Quando um repasse para a conta do espaço falha.',
  },
  REVIEW_REQUEST: {
    title: 'Pedido de avaliação',
    description: 'Um convite para avaliar o espaço depois do jogo ou da aula.',
  },
  REVIEW_CREATED: {
    title: 'Avaliação nova',
    description: 'Quando o espaço que você gerencia recebe uma avaliação.',
  },
  REVIEW_REPLIED: {
    title: 'Resposta à sua avaliação',
    description: 'Quando o espaço responde a sua avaliação.',
  },
};

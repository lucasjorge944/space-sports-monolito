import type { RecurringStatus } from '@space-sports/api-client';

type Variant = 'default' | 'secondary' | 'muted' | 'success' | 'warning' | 'destructive';

export const RECURRING_STATUS_LABELS: Record<
  RecurringStatus,
  { label: string; variant: Variant; hint: string }
> = {
  PENDING_APPROVAL: {
    label: 'Aguardando aprovação',
    variant: 'warning',
    hint: 'O espaço vai analisar o seu pedido. Avisamos quando houver resposta.',
  },
  ACTIVE: {
    label: 'Ativo',
    variant: 'success',
    hint: 'O horário é seu toda semana. As reservas são criadas com 4 semanas de antecedência.',
  },
  PAUSED: {
    label: 'Pausado',
    variant: 'muted',
    hint: 'O espaço pausou o seu horário. Fale com o espaço para retomar.',
  },
  ENDED: { label: 'Encerrado', variant: 'muted', hint: 'Este horário fixo foi encerrado.' },
  REJECTED: {
    label: 'Recusado',
    variant: 'destructive',
    hint: 'O espaço não aprovou este horário. Você pode pedir outro.',
  },
};

/** Pedido ainda em aberto (aguardando, ativo ou pausado): pode ser retirado/encerrado pelo jogador. */
export function canEndRecurring(status: RecurringStatus): boolean {
  return status === 'PENDING_APPROVAL' || status === 'ACTIVE' || status === 'PAUSED';
}

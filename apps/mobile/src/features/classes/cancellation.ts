import type { SubscriptionDetail } from '@space-sports/api-client';
import { formatCents, monthStart } from '@space-sports/shared';
import { formatDate } from '@/lib/datetime';

type Cancellable = Pick<SubscriptionDetail, 'accessUntilIfCancelled' | 'charges' | 'overdueCents'>;

/**
 * O que acontece ao confirmar o cancelamento (RN-CLASS-08, decisão 45). Com mês pago, o plano segue
 * até `accessUntilIfCancelled`. Sem ele (nulo), o acesso termina no ato: a mensalidade do mês ainda
 * sem pagamento é dispensada, a parcial fica em aberto e a vencida continua devida.
 */
export function cancellationMessage(subscription: Cancellable, today: string): string {
  const { accessUntilIfCancelled: accessUntil, charges, overdueCents } = subscription;
  if (accessUntil) {
    return `Seu plano fica ativo até ${formatDate(accessUntil)}. Depois disso ele termina e nenhuma mensalidade nova é gerada.`;
  }
  const current = charges.find(
    (charge) => charge.status === 'PENDING' && charge.periodStart === monthStart(today),
  );
  const parts = ['O acesso termina agora.'];
  if (current) {
    parts.push(
      current.paidCents > 0
        ? 'A mensalidade deste mês já tem pagamento parcial e fica em aberto com o espaço.'
        : 'A mensalidade deste mês é dispensada.',
    );
  }
  if (overdueCents > 0) {
    parts.push(`A mensalidade em atraso (${formatCents(overdueCents)}) continua devida.`);
  }
  return parts.join(' ');
}

/** Dá para desistir do cancelamento enquanto o último dia de acesso não passou. */
export function canResumeCancellation(
  subscription: Pick<SubscriptionDetail, 'status' | 'cancelAtPeriodEnd' | 'accessUntil'>,
  today: string,
): boolean {
  const { status, cancelAtPeriodEnd, accessUntil } = subscription;
  return (
    status !== 'CANCELLED' && cancelAtPeriodEnd && accessUntil !== null && accessUntil >= today
  );
}

'use client';

import { getSuperGetPaymentFeesQueryKey, superGetPaymentFees } from '@space-sports/api-client';
import { useQuery } from '@tanstack/react-query';
import { isSandbox, SandboxBadge } from '@/components/painel/online/sandbox';

/**
 * Selo "Ambiente de teste" na barra do /super quando o gateway é o simulado (docs/05). Chave
 * própria: a barra hidrata antes da página, e dividir o cache com a aba Taxas faria a página
 * hidratar já com dados (diferente do HTML do servidor).
 */
export function SuperSandboxBadge() {
  const fees = useQuery({
    queryKey: [...getSuperGetPaymentFeesQueryKey(), 'topbar'],
    queryFn: ({ signal }) => superGetPaymentFees({ signal }),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return isSandbox(fees.data?.paymentEnvironment) ? <SandboxBadge /> : null;
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AvaliacoesView } from '@/components/painel/avaliacoes/avaliacoes-view';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Avaliações' };

/** Os filtros (nota, sem resposta) vêm da URL, lidos no cliente (`useSearchParams`). */
export default function AvaliacoesPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AvaliacoesView />
    </Suspense>
  );
}

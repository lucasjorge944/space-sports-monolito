import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SessoesView } from '@/components/painel/aulas/sessoes/sessoes-view';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Sessões' };

export default function SessoesPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <SessoesView />
    </Suspense>
  );
}

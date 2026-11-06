import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PresencasView } from '@/components/painel/aulas/sessoes/presencas-view';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Presença e frequência' };

export default function PresencasPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <PresencasView />
    </Suspense>
  );
}

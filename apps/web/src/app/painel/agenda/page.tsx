import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AgendaView } from '@/components/painel/agenda/agenda-view';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Agenda' };

export default function AgendaPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AgendaView />
    </Suspense>
  );
}

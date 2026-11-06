import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnlineView } from '@/components/painel/online/online-view';
import { RouteLoading } from '@/components/shell/route-states';

export const metadata: Metadata = { title: 'Recebimentos online' };

export default function RecebimentosOnlinePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <OnlineView />
    </Suspense>
  );
}

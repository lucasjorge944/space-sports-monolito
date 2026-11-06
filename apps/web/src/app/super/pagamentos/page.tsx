import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteLoading } from '@/components/shell/route-states';
import { OnlinePaymentsView } from '@/components/super/online/payments-view';

export const metadata: Metadata = { title: 'Pagamento online' };

export default function SuperPagamentosPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <OnlinePaymentsView />
    </Suspense>
  );
}

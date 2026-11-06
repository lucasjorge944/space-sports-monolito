import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteLoading } from '@/components/shell/route-states';
import { ReportsQueue } from '@/components/super/reviews/reports-queue';

export const metadata: Metadata = { title: 'Avaliações' };

/** A aba de status vem da URL, lida no cliente (`useSearchParams`). */
export default function SuperReviewsPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ReportsQueue />
    </Suspense>
  );
}

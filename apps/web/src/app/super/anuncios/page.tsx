import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteLoading } from '@/components/shell/route-states';
import { AdsView } from '@/components/super/ads/ads-view';

export const metadata: Metadata = { title: 'Anúncios' };

/** A aba e o filtro de anunciante vêm da URL, lidos no cliente (`useSearchParams`). */
export default function AdsPage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <AdsView />
    </Suspense>
  );
}

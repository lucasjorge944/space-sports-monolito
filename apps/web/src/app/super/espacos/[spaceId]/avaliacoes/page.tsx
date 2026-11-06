import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteLoading } from '@/components/shell/route-states';
import { SuperSpaceReviews } from '@/components/super/reviews/space-reviews';

export const metadata: Metadata = { title: 'Avaliações do espaço' };

/** Os filtros vêm da URL, lidos no cliente (`useSearchParams`). */
export default async function SuperSpaceReviewsPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  return (
    <Suspense fallback={<RouteLoading />}>
      <SuperSpaceReviews spaceId={spaceId} />
    </Suspense>
  );
}

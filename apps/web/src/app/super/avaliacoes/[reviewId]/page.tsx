import type { Metadata } from 'next';
import { SuperReviewDetailView } from '@/components/super/reviews/review-detail';

export const metadata: Metadata = { title: 'Avaliação' };

export default async function SuperReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return <SuperReviewDetailView reviewId={reviewId} />;
}

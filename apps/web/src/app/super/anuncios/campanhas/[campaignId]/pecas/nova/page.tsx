import type { Metadata } from 'next';
import { CreativeEditor } from '@/components/super/ads/creative-editor';

export const metadata: Metadata = { title: 'Nova peça' };

export default async function NewCreativePage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <CreativeEditor campaignId={campaignId} />;
}

import type { Metadata } from 'next';
import { CreativeEditor } from '@/components/super/ads/creative-editor';

export const metadata: Metadata = { title: 'Editar peça' };

export default async function EditCreativePage({
  params,
}: {
  params: Promise<{ campaignId: string; creativeId: string }>;
}) {
  const { campaignId, creativeId } = await params;
  return <CreativeEditor campaignId={campaignId} creativeId={creativeId} />;
}

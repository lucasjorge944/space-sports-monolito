import type { Metadata } from 'next';
import { CampaignFormPage } from '@/components/super/ads/campaign-form';

export const metadata: Metadata = { title: 'Editar campanha' };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <CampaignFormPage campaignId={campaignId} />;
}

import type { Metadata } from 'next';
import { CampaignDetail, type CampaignTab } from '@/components/super/ads/campaign-detail';

export const metadata: Metadata = { title: 'Campanha' };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const { campaignId } = await params;
  const { aba } = await searchParams;
  const tab: CampaignTab = aba === 'relatorio' ? 'relatorio' : 'pecas';
  return <CampaignDetail campaignId={campaignId} initialTab={tab} />;
}

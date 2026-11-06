import type { Metadata } from 'next';
import { CampaignFormPage } from '@/components/super/ads/campaign-form';
import { isUuid } from '@/lib/super/ads';

export const metadata: Metadata = { title: 'Nova campanha' };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ anunciante?: string }>;
}) {
  const { anunciante } = await searchParams;
  // `?anunciante=` inválido é ignorado: o formulário começa sem anunciante, sem ir à API.
  return <CampaignFormPage advertiserId={isUuid(anunciante) ? anunciante : undefined} />;
}

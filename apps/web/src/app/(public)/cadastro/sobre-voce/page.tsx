import type { Metadata } from 'next';
import { AboutYouStep } from '@/components/account/about-you-step';
import { safeNextPath } from '@/lib/auth/navigation';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Sobre você' };

export default async function SobreVocePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <AboutYouStep next={safeNextPath(firstParam(params.next))} />;
}

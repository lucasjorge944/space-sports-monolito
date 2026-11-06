import type { Metadata } from 'next';
import { CompleteProfile } from '@/components/account/complete-profile';
import { safeNextPath } from '@/lib/auth/navigation';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Complete seu cadastro' };

export default async function CompletarCadastroPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <CompleteProfile next={safeNextPath(firstParam(params.next))} />;
}

import type { Metadata } from 'next';
import { PublicInvite } from '@/components/convite/public-invite';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = {
  title: 'Convite para jogar',
  // O link carrega um token: fora de buscadores.
  robots: { index: false, follow: false },
};

export default async function PublicInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  return <PublicInvite token={token} autoAccept={firstParam(query.aceitar) === '1'} />;
}

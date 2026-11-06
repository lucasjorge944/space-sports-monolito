import type { Metadata } from 'next';
import { AcceptInvite } from '@/components/convite/accept-invite';

export const metadata: Metadata = {
  title: 'Convite para a equipe',
  // O link carrega um token: fora de buscadores.
  robots: { index: false, follow: false },
};

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}

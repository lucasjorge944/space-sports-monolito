import type { Metadata } from 'next';
import { Unsubscribe } from '@/components/contatos/unsubscribe';

export const metadata: Metadata = {
  title: 'Descadastro',
  // O link carrega um token assinado: fora de buscadores.
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Unsubscribe token={token} />;
}

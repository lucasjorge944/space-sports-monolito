import type { Metadata } from 'next';
import { ContatosView } from '@/components/painel/contatos/contatos-view';

export const metadata: Metadata = { title: 'Contatos' };

export default function ContatosPage() {
  return <ContatosView />;
}

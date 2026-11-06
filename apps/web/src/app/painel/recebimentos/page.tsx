import type { Metadata } from 'next';
import { RecebimentosView } from '@/components/painel/recebimentos/recebimentos-view';

export const metadata: Metadata = { title: 'Recebimentos' };

export default function RecebimentosPage() {
  return <RecebimentosView />;
}

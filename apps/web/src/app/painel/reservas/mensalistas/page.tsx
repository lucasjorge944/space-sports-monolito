import type { Metadata } from 'next';
import { MensalistasView } from '@/components/painel/mensalistas/mensalistas-view';

export const metadata: Metadata = { title: 'Mensalistas' };

export default function MensalistasPage() {
  return <MensalistasView />;
}

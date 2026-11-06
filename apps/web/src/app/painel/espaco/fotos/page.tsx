import type { Metadata } from 'next';
import { FotosView } from '@/components/painel/espaco/fotos-view';

export const metadata: Metadata = { title: 'Fotos do espaço' };

export default function FotosPage() {
  return <FotosView />;
}

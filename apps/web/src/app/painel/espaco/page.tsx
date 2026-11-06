import type { Metadata } from 'next';
import { DadosView } from '@/components/painel/espaco/dados-view';

export const metadata: Metadata = { title: 'Espaço' };

export default function EspacoPage() {
  return <DadosView />;
}

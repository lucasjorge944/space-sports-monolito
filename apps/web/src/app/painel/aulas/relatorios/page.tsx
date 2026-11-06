import type { Metadata } from 'next';
import { RelatoriosView } from '@/components/painel/aulas/relatorios/relatorios-view';

export const metadata: Metadata = { title: 'Relatórios das aulas' };

export default function RelatoriosPage() {
  return <RelatoriosView />;
}

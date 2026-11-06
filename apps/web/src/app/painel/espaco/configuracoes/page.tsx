import type { Metadata } from 'next';
import { ConfiguracoesView } from '@/components/painel/espaco/configuracoes-view';

export const metadata: Metadata = { title: 'Configurações do espaço' };

export default function ConfiguracoesPage() {
  return <ConfiguracoesView />;
}

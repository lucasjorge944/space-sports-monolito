import type { Metadata } from 'next';
import { SessaoDetalheView } from '@/components/painel/aulas/sessoes/sessao-detalhe-view';

export const metadata: Metadata = { title: 'Aula' };

export default async function SessaoPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessaoDetalheView sessionId={sessionId} />;
}

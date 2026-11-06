import type { Metadata } from 'next';
import { TurmasView } from '@/components/painel/aulas/turmas-view';

export const metadata: Metadata = { title: 'Turmas' };

export default function TurmasPage() {
  return <TurmasView />;
}

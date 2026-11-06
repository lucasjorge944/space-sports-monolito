import type { Metadata } from 'next';
import { AlunosView } from '@/components/painel/aulas/alunos/alunos-view';

export const metadata: Metadata = { title: 'Alunos' };

export default function AlunosPage() {
  return <AlunosView />;
}

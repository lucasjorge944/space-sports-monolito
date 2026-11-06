import type { Metadata } from 'next';
import { ProfessoresView } from '@/components/painel/aulas/professores-view';

export const metadata: Metadata = { title: 'Professores' };

export default function ProfessoresPage() {
  return <ProfessoresView />;
}

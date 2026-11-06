import type { Metadata } from 'next';
import { EquipeView } from '@/components/painel/equipe/equipe-view';

export const metadata: Metadata = { title: 'Equipe' };

export default function EquipePage() {
  return <EquipeView />;
}

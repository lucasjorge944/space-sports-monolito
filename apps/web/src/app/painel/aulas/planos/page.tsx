import type { Metadata } from 'next';
import { PlanosView } from '@/components/painel/aulas/planos-view';

export const metadata: Metadata = { title: 'Planos' };

export default function PlanosPage() {
  return <PlanosView />;
}

import type { Metadata } from 'next';
import { HojeView } from '@/components/painel/hoje/hoje-view';

export const metadata: Metadata = { title: 'Hoje' };

export default function PainelHojePage() {
  return <HojeView />;
}

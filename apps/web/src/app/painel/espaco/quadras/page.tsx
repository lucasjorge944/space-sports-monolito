import type { Metadata } from 'next';
import { QuadrasView } from '@/components/painel/espaco/quadras-view';

export const metadata: Metadata = { title: 'Quadras' };

export default function QuadrasPage() {
  return <QuadrasView />;
}

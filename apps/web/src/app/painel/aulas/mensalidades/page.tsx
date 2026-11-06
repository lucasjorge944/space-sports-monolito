import type { Metadata } from 'next';
import { MensalidadesView } from '@/components/painel/aulas/mensalidades/mensalidades-view';

export const metadata: Metadata = { title: 'Mensalidades' };

export default function MensalidadesPage() {
  return <MensalidadesView />;
}

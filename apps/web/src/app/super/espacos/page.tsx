import type { Metadata } from 'next';
import { SpacesList } from '@/components/super/spaces/spaces-list';

export const metadata: Metadata = { title: 'Espaços' };

export default function SuperSpacesPage() {
  return <SpacesList />;
}

import type { Metadata } from 'next';
import { EditSpace } from '@/components/super/spaces/edit-space';

export const metadata: Metadata = { title: 'Editar espaço' };

export default async function EditSpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  return <EditSpace spaceId={spaceId} />;
}

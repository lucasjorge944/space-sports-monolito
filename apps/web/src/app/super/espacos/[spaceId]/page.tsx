import type { Metadata } from 'next';
import { SpaceDetail } from '@/components/super/spaces/space-detail';
import { ownerInviteMessage } from '@/lib/super/labels';

export const metadata: Metadata = { title: 'Espaço' };

export default async function SuperSpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ convite?: string }>;
}) {
  const { spaceId } = await params;
  const { convite } = await searchParams;
  const inviteStatus =
    convite && convite in ownerInviteMessage
      ? (convite as keyof typeof ownerInviteMessage)
      : undefined;
  return <SpaceDetail spaceId={spaceId} inviteStatus={inviteStatus} />;
}

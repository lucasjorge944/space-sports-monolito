import type { Metadata } from 'next';
import { UserDetail } from '@/components/super/users/user-detail';

export const metadata: Metadata = { title: 'Usuário' };

export default async function UserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <UserDetail userId={userId} />;
}

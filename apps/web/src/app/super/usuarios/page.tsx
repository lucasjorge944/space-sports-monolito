import type { Metadata } from 'next';
import { type UsersTab, UsersView } from '@/components/super/users/users-view';

export const metadata: Metadata = { title: 'Usuários' };

const TABS: Record<string, UsersTab> = { lgpd: 'lgpd', super: 'super' };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  return <UsersView initialTab={(aba && TABS[aba]) || 'usuarios'} />;
}

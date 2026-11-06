import type { Metadata } from 'next';
import { Dashboard } from '@/components/super/dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

export default function SuperDashboardPage() {
  return <Dashboard />;
}

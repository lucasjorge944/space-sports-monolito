import type { Metadata } from 'next';
import { FinanceView } from '@/components/super/finance/finance-view';

export const metadata: Metadata = { title: 'Financeiro' };

export default function FinancePage() {
  return <FinanceView />;
}

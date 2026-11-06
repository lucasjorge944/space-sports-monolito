import type { Metadata } from 'next';
import { AuditLog } from '@/components/super/audit/audit-log';

export const metadata: Metadata = { title: 'Auditoria' };

export default function AuditPage() {
  return <AuditLog />;
}

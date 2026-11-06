import type { Metadata } from 'next';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';
import { messageForCode } from '@/lib/auth/errors';
import { safeNextPath } from '@/lib/auth/navigation';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Confirmar e-mail' };

export default async function VerificarEmailPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorCode = firstParam(params.error);
  const state = errorCode
    ? 'erro'
    : firstParam(params.status) === 'confirmado'
      ? 'confirmado'
      : 'pendente';
  return (
    <VerifyEmailPanel
      state={state}
      email={firstParam(params.email)}
      next={safeNextPath(firstParam(params.next))}
      linkError={errorCode ? (messageForCode(errorCode) ?? undefined) : undefined}
    />
  );
}

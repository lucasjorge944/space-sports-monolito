import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { messageForCode } from '@/lib/auth/errors';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Redefinir senha' };

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorCode = firstParam(params.error);
  return (
    <ResetPasswordForm
      token={firstParam(params.token)}
      linkError={
        errorCode
          ? (messageForCode(errorCode) ?? 'O link é inválido ou expirou. Peça um novo.')
          : undefined
      }
    />
  );
}

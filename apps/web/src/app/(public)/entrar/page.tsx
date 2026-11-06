import type { Metadata } from 'next';
import { SignInForm } from '@/components/auth/sign-in-form';
import { messageForCode } from '@/lib/auth/errors';
import { safeNextPath } from '@/lib/auth/navigation';
import { parseSocialProviders } from '@/lib/auth/providers';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Entrar' };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorCode = firstParam(params.error);
  const initialError = errorCode
    ? (messageForCode(errorCode) ?? 'Não foi possível entrar. Tente novamente.')
    : undefined;
  const notice =
    firstParam(params.senha) === 'redefinida'
      ? 'Senha redefinida. Entre com a nova senha.'
      : undefined;

  return (
    <SignInForm
      // Lido a cada requisição (a página é dinâmica por causa dos searchParams).
      providers={parseSocialProviders(process.env.AUTH_PROVIDERS)}
      next={safeNextPath(firstParam(params.next))}
      initialError={initialError}
      notice={notice}
    />
  );
}

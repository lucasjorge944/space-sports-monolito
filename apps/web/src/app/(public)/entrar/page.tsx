import type { Metadata } from 'next';
import { OAuthEntry } from '@/components/auth/oauth-entry';
import { SignInForm } from '@/components/auth/sign-in-form';
import { messageForCode } from '@/lib/auth/errors';
import { safeNextPath } from '@/lib/auth/navigation';
import { isOAuthFlow, queryStringOf } from '@/lib/auth/oauth';
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

  // Veio do authorize do MCP: a query assinada segue intacta (docs/14-mcp.md 3.5).
  const query = queryStringOf(params);
  // Provedores lidos a cada requisição (a página é dinâmica por causa dos searchParams).
  const providers = parseSocialProviders(process.env.AUTH_PROVIDERS);
  if (isOAuthFlow(new URLSearchParams(query))) {
    return <OAuthEntry providers={providers} oauthQuery={query} initialError={initialError} />;
  }

  return (
    <SignInForm
      providers={providers}
      next={safeNextPath(firstParam(params.next))}
      initialError={initialError}
      notice={notice}
    />
  );
}

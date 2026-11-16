import type { Metadata } from 'next';
import { ConsentView } from '@/components/oauth/consent-view';
import { queryStringOf } from '@/lib/auth/oauth';
import type { SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Permitir acesso', robots: { index: false } };

/**
 * Consentimento do MCP. A query assinada pelo Better Auth chega intacta e segue para a API; o
 * `proxy.ts` leva ao `/entrar` (com a mesma query) quem não tem sessão.
 */
export default async function AutorizarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return <ConsentView oauthQuery={queryStringOf(params)} />;
}

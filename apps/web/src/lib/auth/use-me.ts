'use client';

import { isApiError, useGetMe } from '@space-sports/api-client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { loginPathWithNext } from './navigation';

/**
 * `GET /v1/me` da sessão atual. Se a sessão expirar com a página aberta (401), manda para o login
 * voltando para a página atual; o `proxy.ts` cobre as navegações e carregamentos.
 */
export function useMe() {
  const query = useGetMe();
  const pathname = usePathname();
  const expired = isApiError(query.error) && query.error.status === 401;

  useEffect(() => {
    if (expired) window.location.assign(loginPathWithNext(pathname));
  }, [expired, pathname]);

  return query;
}

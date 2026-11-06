'use client';

import { configureApiClient, isApiError } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { getSupportSession, supportHeadersFor } from '@/lib/support/session';

// O web fala com a API pela mesma origem (rewrite de `/v1` no Next), com o cookie de sessão.
// No modo suporte (RF-SUPER-04), as rotas de gestão do espaço da sessão levam `X-Support-Session`.
configureApiClient({
  baseUrl: '',
  credentials: 'include',
  headers: ({ url }) => supportHeadersFor(url, getSupportSession()),
});

const MAX_RETRIES = 3;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Erro 4xx (ex.: sessão expirada) não melhora repetindo.
        retry: (failureCount, error) =>
          !(isApiError(error) && error.status < 500) && failureCount < MAX_RETRIES,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

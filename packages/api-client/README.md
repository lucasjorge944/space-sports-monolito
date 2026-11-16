# @space-sports/api-client

Cliente tipado da API do Space Sports, gerado pelo [orval](https://orval.dev) a partir do OpenAPI da API (o mesmo de `/docs-json`). Para cada operação há uma função `fetch` tipada e um hook do TanStack Query v5: `getMe()` e `useGetMe()`, `signInEmail()` e `useSignInEmail()`, `phoneNumberSendOtp()` e `usePhoneNumberSendOtp()` etc.

## Geração

- `openapi.json` e `src/generated/` (`endpoints` com os hooks, `fetch` só com as funções e `model`) são **gerados e versionados**. Não edite à mão.
- `pnpm generate:api-client` (na raiz) faz o build da API, exporta o OpenAPI sem subir servidor (`apps/api/dist/openapi/export.js`, com env fixo e `SMS_PROVIDER=console`) e roda o orval.
- `pnpm generate:api-client:check` (e o passo "API client up to date" da CI) falha se o versionado diferir do que a API gera agora. Mudou um controller, DTO ou as rotas de auth? Rode o `generate` e faça commit junto.
- O nome das funções vem do `operationId`. Nas rotas do Nest, defina um explícito em `@ApiOperation({ operationId })` (ex.: `getMe`).

## O que o pacote exporta

- Funções e hooks gerados (`src/generated/endpoints`) e os tipos do OpenAPI (`src/generated/model`, ex.: `MeResponseDto`, `PlatformRole`, `SpaceRole`).
- `configureApiClient(config)`: configuração global do mutator `customFetch`, por onde passa toda requisição.
- `ApiError` e `isApiError`: toda resposta >= 400 vira um `ApiError` com `status`, `code`, `message`, `details` e `requestId` (formato padrão `{ error: { code, message, details? }, requestId }`). Corpo fora do padrão (ex.: 502 de proxy) vira `code: 'HTTP_ERROR'`. Erro de rede continua sendo o erro do `fetch` (não é `ApiError`).
- Reexportados de `@space-sports/shared`: `meResponseSchema`, `membershipSchema`, os schemas de enum, `SPACE_PERMISSIONS` e `canInSpace` (para esconder ações que o papel não pode fazer). Um teste garante que `MeResponseDto` e `MeResponse` têm o mesmo formato.

## Sem React (servidores Node)

As funções geradas em `src/generated/endpoints` importam o TanStack Query (e o React) junto com os hooks. Para um processo Node sem React, como o `apps/mcp`, o `generate` produz também `src/generated/fetch` (orval com `client: 'fetch'`, o mesmo mutator e o mesmo `model`), exposto em `dist/fetch.js`:

```ts
import { configureApiClient, getMyBooking, isApiError } from '@space-sports/api-client/dist/fetch.js';

configureApiClient({ baseUrl: process.env.API_URL! });
// Headers por chamada (ex.: o Bearer de cada usuário) têm prioridade sobre os da configuração.
const booking = await getMyBooking(id, { headers: { Authorization: `Bearer ${token}` } });
```

## Configuração

```ts
configureApiClient({
  baseUrl: 'http://localhost:3333', // origem da API, sem /v1 (os caminhos gerados já trazem /v1)
  credentials: 'include',            // opcional: manda o cookie de sessão
  headers: async ({ url, init }) => ({ Authorization: `Bearer ${await getToken()}` }), // opcional
  fetch: customFetchImpl,            // opcional (testes, SSR)
});
```

`headers` roda a cada requisição (pode ser assíncrono). Headers passados na chamada (`getMe({ headers })` ou `useGetMe({ request: { headers } })`) têm prioridade. `configureApiClient` substitui a configuração inteira.

## Web (Next.js, sessão por cookie)

Com o proxy de `/v1` pelo Next (rewrites), o browser chama a mesma origem e o cookie vai junto:

```tsx
'use client';
import { configureApiClient } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

configureApiClient({ baseUrl: '', credentials: 'include' });
const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

No servidor (Server Components, `proxy.ts`), o processo do Node tem a própria configuração: use a URL absoluta da API e repasse o cookie da requisição, ex.: `configureApiClient({ baseUrl: process.env.API_URL, headers: async () => ({ cookie: (await cookies()).toString() }) })` num módulo só do servidor.

## Mobile (Expo, sessão por bearer)

```tsx
import { configureApiClient } from '@space-sports/api-client';
import * as SecureStore from 'expo-secure-store';

configureApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  headers: async () => {
    const token = await SecureStore.getItemAsync('session_token');
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  },
});
```

## Uso

```tsx
import { isApiError, useGetMe, useSignInEmail } from '@space-sports/api-client';

const { data: me, error } = useGetMe();
if (isApiError(error) && error.code === 'UNAUTHENTICATED') redirectToLogin();
if (me?.access.super) showSuperLink();

const signIn = useSignInEmail();
signIn.mutate({ data: { email, password } }, { onError: (err) => showMessage(err.code) });
```

Os hooks tipam `error` como `ApiError`. Para não repetir requisição em erro do cliente: `new QueryClient({ defaultOptions: { queries: { retry: (n, err) => !(isApiError(err) && err.status < 500) && n < 3 } } })`.

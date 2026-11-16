// Entrada sem React Query (`@space-sports/api-client/dist/fetch.js`): as mesmas funções fetch
// tipadas de `index.ts`, geradas pelo orval com `client: 'fetch'`, para servidores Node (ex.: o
// apps/mcp) que não têm React. Os hooks ficam só em `index.ts`.
export * from './errors';
export * from './generated/fetch';
export * from './generated/model';
export {
  type ApiClientConfig,
  type ApiClientRequest,
  configureApiClient,
  customFetch,
  getApiClientConfig,
} from './mutator';

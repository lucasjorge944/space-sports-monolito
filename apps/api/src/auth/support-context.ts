import { AsyncLocalStorage } from 'node:async_hooks';

/** Sessão de suporte da requisição em curso; preenchida pelo SupportModeInterceptor. */
export const supportContext = new AsyncLocalStorage<{ sessionId: string }>();

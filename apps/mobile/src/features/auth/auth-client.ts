import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/** Prefixos do Better Auth no app: o cookie da sessão é `space-sports.session_token`. */
export const AUTH_COOKIE_PREFIX = 'space-sports';
export const AUTH_STORAGE_PREFIX = 'space-sports';

/**
 * Cliente do Better Auth, usado só no login social (Google/Apple): o plugin Expo abre o
 * navegador do sistema, recebe o cookie da sessão pelo deep link e o guarda no SecureStore.
 * Todo o resto passa pelo `@space-sports/api-client` com `Authorization: Bearer`; a sessão do
 * login social é copiada para o mesmo token (veja `social-sign-in.ts`).
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/v1/auth',
  plugins: [
    expoClient({
      scheme: 'spacesports',
      storagePrefix: AUTH_STORAGE_PREFIX,
      cookiePrefix: AUTH_COOKIE_PREFIX,
      storage: SecureStore,
    }),
  ],
});

/** Chaves que o plugin grava no SecureStore (`:` vira `_`). */
export const EXPO_COOKIE_KEY = `${AUTH_STORAGE_PREFIX}_cookie`;
export const EXPO_SESSION_CACHE_KEY = `${AUTH_STORAGE_PREFIX}_session_data`;

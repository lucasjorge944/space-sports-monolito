import * as SecureStore from 'expo-secure-store';
import {
  AUTH_COOKIE_PREFIX,
  authClient,
  EXPO_COOKIE_KEY,
  EXPO_SESSION_CACHE_KEY,
} from './auth-client';
import type { SocialProvider } from './config';
import { setSessionToken } from './token-storage';

/**
 * Token da sessão dentro do JSON de cookies que o plugin Expo guarda (`{ nome: { value } }`).
 * O `value` é o mesmo que a API devolve em `set-auth-token`, aceito como Bearer.
 */
export function extractSessionToken(cookieJson: string | null | undefined): string | null {
  if (!cookieJson) return null;
  let cookies: unknown;
  try {
    cookies = JSON.parse(cookieJson);
  } catch {
    return null;
  }
  if (!cookies || typeof cookies !== 'object') return null;
  const jar = cookies as Record<string, { value?: unknown; expires?: string | null } | undefined>;
  for (const name of [
    `__Secure-${AUTH_COOKIE_PREFIX}.session_token`,
    `${AUTH_COOKIE_PREFIX}.session_token`,
  ]) {
    const cookie = jar[name];
    if (!cookie || typeof cookie.value !== 'string' || !cookie.value) continue;
    if (cookie.expires && new Date(cookie.expires).getTime() <= Date.now()) continue;
    return cookie.value;
  }
  return null;
}

/** Remove o que o plugin Expo guardou: a fonte da sessão no app é só o token do SecureStore. */
async function clearExpoStorage(): Promise<void> {
  await Promise.all(
    [EXPO_COOKIE_KEY, EXPO_SESSION_CACHE_KEY].map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => undefined),
    ),
  );
}

export type SocialSignInResult = 'signed-in' | 'cancelled';

/** Login com Google/Apple pelo navegador do sistema. Lança o erro do Better Auth se falhar. */
export async function signInWithSocial(provider: SocialProvider): Promise<SocialSignInResult> {
  await clearExpoStorage();
  const { error } = await authClient.signIn.social({ provider, callbackURL: '/' });
  if (error) throw error;
  const token = extractSessionToken(await SecureStore.getItemAsync(EXPO_COOKIE_KEY));
  await clearExpoStorage();
  if (!token) return 'cancelled';
  await setSessionToken(token);
  return 'signed-in';
}

export async function clearSocialSession(): Promise<void> {
  await clearExpoStorage();
}

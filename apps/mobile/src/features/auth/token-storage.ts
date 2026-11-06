import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Chave do SecureStore (só aceita letras, números, `.`, `-` e `_`). */
export const SESSION_TOKEN_KEY = 'space-sports.session_token';

// `undefined` = ainda não lido do armazenamento.
let cached: string | null | undefined;

// O SecureStore não existe no web (`expo start --web`); lá cai no localStorage, só para desenvolvimento.
async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(SESSION_TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

async function writeRaw(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(SESSION_TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

/** Token da sessão (valor de `set-auth-token`), enviado como `Authorization: Bearer`. */
export async function getSessionToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await readRaw();
  } catch {
    // Keystore indisponível/corrompido: tratado como sem sessão.
    cached = null;
  }
  return cached;
}

export async function setSessionToken(token: string): Promise<void> {
  cached = token;
  await writeRaw(token);
}

export async function clearSessionToken(): Promise<void> {
  cached = null;
  try {
    await writeRaw(null);
  } catch {
    // O cache já foi limpo; uma falha ao apagar não pode manter a pessoa logada.
  }
}

/** Só para testes: esquece o cache em memória. */
export function resetSessionTokenCache(): void {
  cached = undefined;
}

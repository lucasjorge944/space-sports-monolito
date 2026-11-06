import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Chaves do SecureStore (só aceitam letras, números, `.`, `-` e `_`). */
export const STORAGE_KEYS = {
  locationOnboardingDone: 'space-sports.location_onboarding_done',
  pendingInviteToken: 'space-sports.pending_invite_token',
  pendingSpaceSlug: 'space-sports.pending_space_slug',
  pushDeviceId: 'space-sports.push_device_id',
} as const;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Valor guardado no aparelho; falha de armazenamento vira "sem valor" (nunca derruba a tela). */
export async function getStored(key: StorageKey): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setStored(key: StorageKey, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Sem armazenamento: o valor só vale nesta execução do app.
  }
}

export async function removeStored(key: StorageKey): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Já não estava lá.
  }
}

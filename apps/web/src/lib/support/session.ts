import { useSyncExternalStore } from 'react';
import { setSupportCookie } from './cookie';

/** Sessão de suporte ativa neste navegador (RF-SUPER-04). A API é quem valida e audita (RN-SUPER-01). */
export type StoredSupportSession = {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  spaceStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  /** ISO UTC; a sessão vale 2 h. */
  expiresAt: string;
};

export const SUPPORT_SESSION_HEADER = 'X-Support-Session';
const STORAGE_KEY = 'space-sports:support-session';

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedValue: StoredSupportSession | null = null;

function isStored(value: unknown): value is StoredSupportSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.spaceId === 'string' &&
    typeof v.spaceName === 'string' &&
    typeof v.spaceSlug === 'string' &&
    typeof v.spaceStatus === 'string' &&
    typeof v.expiresAt === 'string'
  );
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Lê a sessão salva; devolve a mesma referência enquanto o conteúdo não muda (exigência do useSyncExternalStore). */
export function getSupportSession(): StoredSupportSession | null {
  if (typeof window === 'undefined') return null;
  const raw = readRaw();
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cachedValue = isStored(parsed) ? parsed : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

function emit() {
  for (const listener of listeners) listener();
}

export function saveSupportSession(session: StoredSupportSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Sem armazenamento: sem como manter o modo suporte entre páginas.
  }
  setSupportCookie(true, session.expiresAt);
  emit();
}

export function clearSupportSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada a limpar.
  }
  setSupportCookie(false);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Sessão de suporte atual (`null` no servidor e quando não há). */
export function useSupportSession(): StoredSupportSession | null {
  return useSyncExternalStore(subscribe, getSupportSession, () => null);
}

const MANAGE_PATH = /\/v1\/manage\/spaces\/([^/?#]+)/;

/**
 * Header do modo suporte para uma requisição: só nas rotas `/v1/manage/spaces/:spaceId/...` do
 * espaço da sessão (a sessão vale como Dono só naquele espaço).
 */
export function supportHeadersFor(
  url: string,
  session: StoredSupportSession | null,
): Record<string, string> | undefined {
  if (!session) return undefined;
  const spaceId = MANAGE_PATH.exec(url)?.[1];
  if (spaceId !== session.spaceId) return undefined;
  return { [SUPPORT_SESSION_HEADER]: session.id };
}

export function isExpired(session: Pick<StoredSupportSession, 'expiresAt'>, now = Date.now()) {
  return new Date(session.expiresAt).getTime() <= now;
}

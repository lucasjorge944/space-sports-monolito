'use client';

import { superEndSupportSession } from '@space-sports/api-client';
import { clearSupportSession, getSupportSession } from '@/lib/support/session';
import { authClient } from './client';
import { LOGIN_PATH } from './navigation';

/** Encerra a sessão de suporte aberta (RN-SUPER-01) antes do logout, que invalidaria a chamada. */
async function endSupportSession(): Promise<void> {
  const session = getSupportSession();
  if (!session) return;
  try {
    await superEndSupportSession(session.id);
  } catch {
    // Já encerrada/expirada ou sem rede: o logout segue e a API expira a sessão em 2 h.
  } finally {
    clearSupportSession();
  }
}

/**
 * Encerra a sessão e recarrega no login (ou em `destination`). A navegação é completa (não
 * `router.push`) para descartar o cache de rotas e as queries da sessão anterior.
 */
export async function signOut(destination: string = LOGIN_PATH): Promise<void> {
  try {
    await endSupportSession();
    await authClient.signOut();
  } finally {
    window.location.assign(destination);
  }
}

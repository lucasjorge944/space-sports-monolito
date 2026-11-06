import { getStored, removeStored, STORAGE_KEYS, setStored } from '@/lib/storage';

/** Formato do token do convite na URL: só caracteres seguros, para nunca montar rota com lixo. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidInviteToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Quem abre o link do convite deslogado precisa entrar antes de aceitar. O token fica guardado
 * e, depois do login, a pessoa é levada de volta ao convite (`takePendingInvite`).
 */
export async function savePendingInvite(token: string): Promise<void> {
  if (isValidInviteToken(token)) await setStored(STORAGE_KEYS.pendingInviteToken, token);
}

export async function takePendingInvite(): Promise<string | null> {
  const token = await getStored(STORAGE_KEYS.pendingInviteToken);
  if (token === null) return null;
  await removeStored(STORAGE_KEYS.pendingInviteToken);
  return isValidInviteToken(token) ? token : null;
}

export async function hasPendingInvite(): Promise<boolean> {
  return (await getStored(STORAGE_KEYS.pendingInviteToken)) !== null;
}

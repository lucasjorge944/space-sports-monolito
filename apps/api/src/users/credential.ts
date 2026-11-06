import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { accounts } from '../db/schema/index.js';

let dummyHash: Promise<string> | undefined;

/**
 * Confere a senha do login por e-mail (conta `credential` do Better Auth). Conta sem senha (login
 * social ou por telefone) nunca confere. Sem `userId`, verifica contra um hash qualquer: o tempo
 * da resposta não revela se o e-mail existe.
 */
export async function passwordMatches(
  db: DbOrTx,
  userId: string | null,
  password: string,
): Promise<boolean> {
  const [account] = userId
    ? await db
        .select({ hash: accounts.password })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    : [];
  if (!account?.hash) {
    dummyHash ??= hashPassword('senha-que-nunca-confere');
    await verifyPassword({ hash: await dummyHash, password });
    return false;
  }
  return verifyPassword({ hash: account.hash, password });
}

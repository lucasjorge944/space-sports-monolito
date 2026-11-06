import { Logger } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { accounts, devices, sessions, userSportProfiles, users } from '../db/schema/index.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { deleteUserMedia } from '../users/avatar-storage.js';

/** Rota do Better Auth que recebe a volta do provedor (login implícito ou ligação explícita). */
export const OAUTH_CALLBACK_PATH = '/callback/:id';

const logger = new Logger('SocialLink');

/** Nome e foto do id_token do provedor (OIDC: `name` e `picture`). */
export type IdTokenProfile = { name: string | null; picture: string | null };

/**
 * Lê `name` e `picture` do id_token (a mesma fonte que o Better Auth usa no cadastro pelo Google).
 * O token veio da troca do código com o provedor ou foi verificado no login por idToken. Só
 * aceita foto em HTTPS.
 */
export function idTokenProfile(idToken: string | null | undefined): IdTokenProfile {
  const empty = { name: null, picture: null };
  const payload = idToken?.split('.')[1];
  if (!payload) return empty;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      name?: unknown;
      picture?: unknown;
    };
    const name = typeof claims.name === 'string' ? claims.name.trim() : '';
    const picture = typeof claims.picture === 'string' ? claims.picture : '';
    return {
      name: name || null,
      picture: picture.startsWith('https://') ? picture : null,
    };
  } catch {
    return empty;
  }
}

/** Recusa da ligação fora do login implícito pelo callback (falha fechada). */
export const socialLinkRefused = () =>
  new APIError('FORBIDDEN', {
    code: 'account_not_linked',
    message:
      'Já existe uma conta com este e-mail ainda não confirmado. Entre com a senha e confirme o e-mail, ou use "Esqueci minha senha".',
  });

export type SocialLinkInput = {
  userId: string;
  /** id_token do provedor, de onde vêm o nome e a foto da conta "nova". */
  idToken: string | null | undefined;
  /** Rota do Better Auth em que a conta social está sendo gravada (`undefined` sem contexto). */
  path: string | undefined;
  /**
   * Ligação explícita (`/link-social`): a pessoa já está logada na conta e o provedor prova o
   * mesmo e-mail. Nada é revogado.
   */
  explicitLink: boolean;
};

/**
 * Pré-sequestro de conta (RN-AUTH-06), antes de o Better Auth gravar a conta social de um usuário.
 * Com o e-mail da conta já verificado, ou numa conta que o próprio login social está criando (ainda
 * invisível fora da transação do Better Auth), não há o que fazer. Com o e-mail nunca verificado:
 *
 * - login implícito pelo callback (`/callback/:id`, sem ligação explícita): a conta é tratada como
 *   nova, numa transação com a linha do usuário travada: saem as formas de login anteriores
 *   (senha), as sessões, os aparelhos de push, o telefone não verificado, o nascimento, o gênero e
 *   os esportes favoritos; nome e foto passam a ser os do provedor; fica a auditoria
 *   `user.unproven_access_revoked` (sem dados pessoais). Depois do commit, a mídia do usuário no
 *   storage (`users/<id>/`, `uploads/users/<id>/`) é apagada: a foto enviada antes era de quem não
 *   provou o e-mail. O Better Auth marca o e-mail como verificado logo depois;
 * - qualquer outro caminho (sem contexto da rota, login por idToken): a ligação é recusada
 *   (`account_not_linked`). A proteção nunca falha aberta.
 *
 * Devolve `true` se revogou.
 */
export async function protectSocialLink(
  db: Database,
  storage: PhotoStorage,
  { userId, idToken, path, explicitLink }: SocialLinkInput,
): Promise<boolean> {
  if (explicitLink) return false;
  const revoked = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ emailVerified: users.emailVerified, phoneVerified: users.phoneVerified })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for('update');
    if (!user || user.emailVerified) return null;
    if (path !== OAUTH_CALLBACK_PATH) throw socialLinkRefused();

    const removedAccounts = await tx
      .delete(accounts)
      .where(eq(accounts.userId, userId))
      .returning({ providerId: accounts.providerId });
    const endedSessions = await tx
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    const removedDevices = await tx
      .delete(devices)
      .where(eq(devices.userId, userId))
      .returning({ id: devices.id });
    await tx.delete(userSportProfiles).where(eq(userSportProfiles.userId, userId));
    const profile = idTokenProfile(idToken);
    await tx
      .update(users)
      .set({
        // Sem nome do provedor, o "completar cadastro" pede (decisão 66).
        name: profile.name ?? '',
        avatarUrl: profile.picture,
        birthDate: null,
        gender: null,
        ...(user.phoneVerified ? {} : { phone: null }),
      })
      .where(eq(users.id, userId));
    await audit(tx, {
      actorId: userId,
      spaceId: null,
      action: 'user.unproven_access_revoked',
      entity: 'user',
      entityId: userId,
      diff: {
        providersRemoved: removedAccounts.map((account) => account.providerId).sort(),
        sessionsEnded: endedSessions.length,
        devicesRemoved: removedDevices.length,
      },
    });
    return true;
  });
  if (!revoked) return false;
  logger.warn(
    { userId },
    'Conta social ligada a e-mail não confirmado: acessos anteriores removidos',
  );
  await deleteUserMedia(storage, userId);
  return true;
}

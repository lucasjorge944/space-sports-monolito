import { DELETION_REQUEST_RESPONSE_DAYS } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { audit, isUniqueViolation, type Tx } from '../bookings/db-utils.js';
import { accountDeletionRequests, devices, sessions, users } from '../db/schema/index.js';
import {
  deletionRequestPending,
  lastOwnerDeletion,
  superAccountDeletion,
} from '../me/me.errors.js';
import { soleOwnedSpaceId } from './sole-owner.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Prazo de resposta da equipe (decisão 40): pedido + 15 dias. */
export function deletionDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_REQUEST_RESPONSE_DAYS * DAY_MS);
}

export type OpenedDeletionRequest = {
  id: string;
  createdAt: Date;
  email: string | null;
  name: string;
};

/**
 * Pedido de exclusão do próprio titular (RF-AUTH-03, decisão 40), pelo app ou pela página web:
 * cria o pedido `USER` e inativa a conta como a inativação (decisão 29) — encerra as sessões,
 * apaga os dispositivos (a conta inativa não recebe push) e bloqueia o login —, na transação de
 * quem chama. A conta Super e o único Dono (com conta ativa) de um espaço são recusados, como na
 * inativação. Conta bloqueada continua bloqueada.
 *
 * Devolve `null` se a conta não existe ou já foi excluída.
 */
export async function openDeletionRequest(
  tx: Tx,
  userId: string,
  { reason, channel }: { reason?: string; channel: 'APP' | 'WEB' },
): Promise<OpenedDeletionRequest | null> {
  const [user] = await tx
    .select({
      platformRole: users.platformRole,
      status: users.status,
      deletedAt: users.deletedAt,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!user || user.deletedAt) return null;
  if (user.platformRole === 'SUPER') throw superAccountDeletion();
  // Conta já inativa ou bloqueada não atende o espaço: a checagem é a da inativação.
  if (
    user.status === 'ACTIVE' &&
    (await soleOwnedSpaceId(tx, userId, { activeAccountsOnly: true }))
  ) {
    throw lastOwnerDeletion();
  }

  // A linha do usuário travada põe os pedidos simultâneos em fila; o índice único é a garantia.
  const request = await tx
    .insert(accountDeletionRequests)
    .values({ userId, source: 'USER', reason: reason ?? null })
    .returning({ id: accountDeletionRequests.id, createdAt: accountDeletionRequests.createdAt })
    .then(([row]) => row)
    .catch((err: unknown) => {
      if (isUniqueViolation(err, 'account_deletion_requests_user_pending_unique')) {
        throw deletionRequestPending();
      }
      throw err;
    });
  if (!request) throw new Error('Insert do pedido sem retorno.');

  if (user.status === 'ACTIVE') {
    await tx.update(users).set({ status: 'INACTIVE' }).where(eq(users.id, userId));
  }
  const ended = await tx
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  const removed = await tx
    .delete(devices)
    .where(eq(devices.userId, userId))
    .returning({ id: devices.id });
  await audit(tx, {
    actorId: userId,
    spaceId: null,
    action: 'user.deletion_request',
    entity: 'user',
    entityId: userId,
    diff: {
      requestId: request.id,
      channel,
      from: user.status,
      sessionsEnded: ended.length,
      devicesRemoved: removed.length,
    },
  });
  return { ...request, email: user.email, name: user.name };
}

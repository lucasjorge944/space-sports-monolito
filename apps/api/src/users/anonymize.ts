import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { deleteUserContacts } from '../contacts/contact-store.js';
import {
  accounts,
  devices,
  notificationPreferences,
  notifications,
  sessions,
  spaceMembers,
  userSportProfiles,
  users,
} from '../db/schema/index.js';
import { anonymizeUserReviews } from '../reviews/review-rules.js';

/** Nome que fica no lugar do original (reservas e registros antigos continuam apontando para o id). */
export const DELETED_USER_NAME = 'Conta excluída';

/**
 * Anonimiza a conta no atendimento do pedido de exclusão (RF-AUTH-03): apaga os dados pessoais,
 * libera e-mail e telefone para um novo cadastro (os UNIQUE ignoram nulos), limpa nascimento e
 * gênero, marca `deleted_at`, encerra os vínculos com espaços (`space_members` REMOVED) e remove
 * sessões, formas de login, tokens de push, notificações, esportes favoritos e os contatos da
 * pessoa (decisão 48). Nas avaliações (decisão 105), a nota e os chips ficam sem autor; o
 * comentário, a resposta do espaço, as denúncias feitas pela pessoa e os pedidos de avaliação
 * saem. O id fica, para não quebrar o histórico.
 *
 * Quem chama confere antes se a conta pode sair (ex.: único Dono de um espaço, `soleOwnedSpaceId`)
 * e cancela os compromissos futuros (`cancelUserCommitments`, decisão 40).
 *
 * Aceita uma transação (vira savepoint) para o Super atender o pedido junto com outras escritas.
 * Devolve `false` se o usuário não existe ou já foi excluído.
 */
export async function anonymizeUser(
  db: DbOrTx,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Antes de apagar: os dados verificados da conta são o que acha os contatos dela.
    const [current] = await tx
      .select({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!current) return false;

    const [user] = await tx
      .update(users)
      .set({
        name: DELETED_USER_NAME,
        email: null,
        emailVerified: false,
        emailVerifiedAt: null,
        phone: null,
        phoneVerified: false,
        avatarUrl: null,
        birthDate: null,
        gender: null,
        deletedAt: now,
      })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!user) return false;

    await deleteUserContacts(tx, current);
    // RN-REVIEW-06: nota e chips ficam sem autor; comentário, resposta, denúncias e pedidos saem.
    await anonymizeUserReviews(tx, userId);
    await removeMemberships(tx, userId, now);
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(devices).where(eq(devices.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    await tx.delete(userSportProfiles).where(eq(userSportProfiles.userId, userId));
    return true;
  });
}

/** Encerra todos os vínculos com espaços (a conta excluída não segue na equipe). */
export async function removeMemberships(
  db: DbOrTx,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(spaceMembers)
    .set({ status: 'REMOVED', updatedAt: now })
    .where(and(eq(spaceMembers.userId, userId), ne(spaceMembers.status, 'REMOVED')));
}

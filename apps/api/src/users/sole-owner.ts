import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import { spaceMembers, spaces, users } from '../db/schema/index.js';

/**
 * Primeiro espaço em que o usuário é o único Dono ativo (a saída dele deixaria o espaço sem Dono).
 *
 * Chame dentro da transação da saída (inativação pelo app ou exclusão pelo Super): antes da
 * checagem, trava as linhas de `spaces` em que o usuário é Dono ativo (a mesma trava de
 * `lockSpace` da equipe), em ordem de id para não haver deadlock. Assim dois Donos do mesmo
 * espaço saindo ao mesmo tempo ficam em fila, e o segundo já enxerga a saída do primeiro.
 *
 * Com `activeAccountsOnly`, o outro Dono só conta se a conta dele estiver ACTIVE (inativa ou
 * bloqueada não atende o espaço).
 */
export async function soleOwnedSpaceId(
  db: DbOrTx,
  userId: string,
  { activeAccountsOnly = false }: { activeAccountsOnly?: boolean } = {},
): Promise<string | null> {
  await db.execute(sql`
    SELECT s.id FROM ${spaces} s
    WHERE s.id IN (
      SELECT m.space_id FROM ${spaceMembers} m
      WHERE m.user_id = ${userId} AND m.role = 'OWNER' AND m.status = 'ACTIVE'
    )
    ORDER BY s.id
    FOR UPDATE`);
  const otherAccountActive = activeAccountsOnly
    ? sql`AND EXISTS (
        SELECT 1 FROM ${users} u
        WHERE u.id = o.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      )`
    : sql``;
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT m.space_id AS id FROM ${spaceMembers} m
    WHERE m.user_id = ${userId} AND m.role = 'OWNER' AND m.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM ${spaceMembers} o
        WHERE o.space_id = m.space_id AND o.role = 'OWNER' AND o.status = 'ACTIVE'
          AND o.user_id <> m.user_id
          ${otherAccountActive}
      )
    LIMIT 1`);
  return rows[0]?.id ?? null;
}

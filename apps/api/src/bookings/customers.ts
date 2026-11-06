import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../db/schema/index.js';
import { customerNotFound } from './bookings.errors.js';
import type { DbOrTx } from './db-utils.js';

/**
 * Usuário do app a quem a gestão atribui uma reserva ou um mensalista: o `customerUserId`, que tem
 * de existir. Telefone não vincula sozinho (decisão 48): quem digitou pode ter errado o número, e a
 * reserva cairia no app de outra pessoa. A gestão vê a conta sugerida e confirma (RF-CONTACT-05).
 */
export async function findCustomerUserId(
  db: DbOrTx,
  input: { customerUserId?: string | undefined },
): Promise<string | null> {
  if (!input.customerUserId) return null;
  const [customer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.customerUserId), isNull(users.deletedAt)));
  if (!customer) throw customerNotFound();
  return customer.id;
}

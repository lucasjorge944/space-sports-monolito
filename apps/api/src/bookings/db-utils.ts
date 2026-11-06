import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { spaceReadOnly } from '../auth/auth.errors.js';
import { supportContext } from '../auth/support-context.js';
import type { Database } from '../db/client.js';
import { auditLogs, spaces } from '../db/schema/index.js';
import { invalidCursor } from './bookings.errors.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

/** Erro do Postgres por trás do erro do Drizzle (que embrulha o original em `cause`). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let current: unknown = err;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') {
      return current as { code: string; constraint?: string };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return {};
}

/** RN-BOOK-03: a ocupação conflitou com outra ativa na mesma quadra. */
export function isOverlapViolation(err: unknown): boolean {
  const { code, constraint } = pgError(err);
  return code === '23P01' && constraint === 'court_occupations_no_overlap';
}

/** Decisão 47: o professor já tem aula ativa em outro espaço no horário. */
export function isTeacherOverlapViolation(err: unknown): boolean {
  const { code, constraint } = pgError(err);
  return code === '23P01' && constraint === 'teacher_occupations_no_overlap';
}

/**
 * Duas transações que disputam o mesmo horário ao mesmo tempo podem esperar uma pela outra na
 * constraint de exclusão: o Postgres derruba uma com deadlock (40P01), e quem perdeu perdeu o
 * horário do mesmo jeito.
 */
export function isSlotConflict(err: unknown): boolean {
  return isOverlapViolation(err) || pgError(err).code === '40P01';
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = pgError(err);
  return e.code === '23505' && e.constraint === constraint;
}

/** Check do banco (23514); com `constraints`, só os nomeados. */
export function isCheckViolation(err: unknown, constraints?: readonly string[]): boolean {
  const e = pgError(err);
  return (
    e.code === '23514' &&
    (!constraints || (e.constraint !== undefined && constraints.includes(e.constraint)))
  );
}

export interface AuditEntry {
  actorId: string | null;
  /** Ação do Super (painel `/super` ou modo suporte); padrão `false`. */
  actingAsSuper?: boolean;
  spaceId: string | null;
  action: string;
  entity: string;
  /** Nulo quando a ação não é sobre uma linha (ex.: exportação). */
  entityId: string | null;
  diff?: Record<string, unknown>;
}

/**
 * Registra uma ação sensível em audit_logs (RN-PAY-01, cancelamentos e alterações da gestão).
 * Em modo suporte (RF-SUPER-04) a linha sai com `actingAsSuper` e `supportSessionId` no diff.
 */
export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  const support = supportContext.getStore();
  await db.insert(auditLogs).values({
    ...entry,
    actingAsSuper: entry.actingAsSuper ?? support !== undefined,
    ...(support && { diff: { ...entry.diff, supportSessionId: support.sessionId } }),
  });
}

/** Token opaco do convite (URL-safe). */
export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Cursor de paginação por (starts_at, id). */
export interface Cursor {
  startsAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.startsAt.toISOString(), cursor.id])).toString(
    'base64url',
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      const startsAt = new Date(parsed[0]);
      if (!Number.isNaN(startsAt.getTime()) && UUID.test(parsed[1])) {
        return { startsAt, id: parsed[1] };
      }
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalidCursor();
}

/**
 * RF-SUPER-03: escrita só em espaço ACTIVE. As rotas da gestão já passam pelo guard; esta
 * checagem cobre as escritas do jogador, que não têm `:spaceId` na rota.
 */
export async function assertSpaceWritable(db: DbOrTx, spaceId: string): Promise<void> {
  const [space] = await db
    .select({ status: spaces.status })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (space?.status !== 'ACTIVE') throw spaceReadOnly();
}

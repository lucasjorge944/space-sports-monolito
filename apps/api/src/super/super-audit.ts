import { audit, type DbOrTx } from '../bookings/db-utils.js';

/** Registra uma ação do Super (fora do modo suporte) em `audit_logs` (RF-SUPER-10). */
export function superAudit(
  db: DbOrTx,
  actorId: string,
  entry: {
    action: string;
    entity: string;
    /** Nulo quando a ação não é sobre uma linha (ex.: exportação). */
    entityId: string | null;
    spaceId?: string | null;
    diff?: Record<string, unknown>;
  },
): Promise<void> {
  return audit(db, {
    actorId,
    actingAsSuper: true,
    spaceId: entry.spaceId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    ...(entry.diff ? { diff: entry.diff } : {}),
  });
}

/** Escapa `%`, `_` e `\` para usar o texto do usuário em `ILIKE`. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

import { Inject, Injectable } from '@nestjs/common';
import {
  type StartSupportSession,
  SUPPORT_SESSION_TTL_MIN,
  type SupportSession,
  type SupportSessionQuery,
} from '@space-sports/shared';
import { and, desc, eq, gt, isNull, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { spaces, supportSessions, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { spaceNotFound } from '../spaces/spaces.errors.js';
import { supportSessionNotFound } from './super.errors.js';
import { superAudit } from './super-audit.js';

/** Sessões do modo suporte (RF-SUPER-04, RN-SUPER-01): início, fim e motivo ficam registrados. */
@Injectable()
export class SupportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Abre a sessão no espaço. O Super tem uma sessão ativa por vez: abrir outra encerra a
   * anterior (e isso também é registrado).
   */
  async start(
    actorId: string,
    spaceId: string,
    { reason }: StartSupportSession,
  ): Promise<SupportSession> {
    const sessionId = await this.db.transaction(async (tx) => {
      const [space] = await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId));
      if (!space) throw spaceNotFound();

      const now = new Date();
      const closed = await tx
        .update(supportSessions)
        .set({ endedAt: now })
        .where(
          and(
            eq(supportSessions.superUserId, actorId),
            isNull(supportSessions.endedAt),
            gt(supportSessions.expiresAt, now),
          ),
        )
        .returning({ id: supportSessions.id, spaceId: supportSessions.spaceId });
      for (const previous of closed) {
        await superAudit(tx, actorId, {
          action: 'support.end',
          entity: 'support_session',
          entityId: previous.id,
          spaceId: previous.spaceId,
          diff: { reason: 'replaced' },
        });
      }

      const [session] = await tx
        .insert(supportSessions)
        .values({
          superUserId: actorId,
          spaceId,
          reason,
          expiresAt: new Date(now.getTime() + SUPPORT_SESSION_TTL_MIN * 60_000),
        })
        .returning({ id: supportSessions.id });
      if (!session) throw new Error('Insert da sessão de suporte sem retorno.');
      await superAudit(tx, actorId, {
        action: 'support.start',
        entity: 'support_session',
        entityId: session.id,
        spaceId,
        diff: { reason },
      });
      return session.id;
    });
    return this.get(sessionId);
  }

  /** Encerra a sessão do próprio Super (idempotente se já encerrada ou expirada). */
  async end(actorId: string, sessionId: string): Promise<SupportSession> {
    await this.db.transaction(async (tx) => {
      const [session] = await tx
        .select({
          id: supportSessions.id,
          spaceId: supportSessions.spaceId,
          endedAt: supportSessions.endedAt,
        })
        .from(supportSessions)
        .where(and(eq(supportSessions.id, sessionId), eq(supportSessions.superUserId, actorId)))
        .for('update');
      if (!session) throw supportSessionNotFound();
      if (session.endedAt) return;
      await tx
        .update(supportSessions)
        .set({ endedAt: new Date() })
        .where(eq(supportSessions.id, sessionId));
      await superAudit(tx, actorId, {
        action: 'support.end',
        entity: 'support_session',
        entityId: sessionId,
        spaceId: session.spaceId,
      });
    });
    return this.get(sessionId);
  }

  /** Sessões de todos os Supers (a equipe Super audita a si mesma), mais recentes primeiro. */
  async list(query: SupportSessionQuery): Promise<SupportSession[]> {
    const conditions: SQL[] = [];
    if (query.spaceId) conditions.push(eq(supportSessions.spaceId, query.spaceId));
    if (query.active !== undefined) {
      const active = and(
        isNull(supportSessions.endedAt),
        gt(supportSessions.expiresAt, sql`now()`),
      );
      conditions.push(query.active ? (active as SQL) : sql`NOT (${active})`);
    }
    const rows = await this.select()
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(supportSessions.createdAt), desc(supportSessions.id))
      .limit(query.limit);
    return rows.map(toSession);
  }

  async get(sessionId: string): Promise<SupportSession> {
    const [row] = await this.select().where(eq(supportSessions.id, sessionId));
    if (!row) throw supportSessionNotFound();
    return toSession(row);
  }

  private select() {
    return this.db
      .select({
        id: supportSessions.id,
        spaceId: supportSessions.spaceId,
        spaceName: spaces.name,
        superUserId: supportSessions.superUserId,
        superUserName: users.name,
        reason: supportSessions.reason,
        startedAt: supportSessions.createdAt,
        expiresAt: supportSessions.expiresAt,
        endedAt: supportSessions.endedAt,
      })
      .from(supportSessions)
      .innerJoin(spaces, eq(spaces.id, supportSessions.spaceId))
      .innerJoin(users, eq(users.id, supportSessions.superUserId));
  }
}

function toSession(row: {
  id: string;
  spaceId: string;
  spaceName: string;
  superUserId: string;
  superUserName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}): SupportSession {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    active: row.endedAt === null && row.expiresAt.getTime() > Date.now(),
  };
}

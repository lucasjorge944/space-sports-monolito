import { Inject, Injectable } from '@nestjs/common';
import {
  type AuditLogPage,
  type AuditLogQuery,
  DEFAULT_TIME_ZONE,
  type SuperMetrics,
  type SuperMetricsQuery,
} from '@space-sports/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  auditLogs,
  bookings,
  recurringBookings,
  sessions,
  spaceMembers,
  spaces,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { invalidCursor } from '../spaces/spaces.errors.js';
import { likePattern } from './super-audit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const localToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE }).format(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Instante inicial do dia local `date` e do dia seguinte, como SQL (fuso dos espaços). */
const dayStart = (date: string) =>
  sql`(${date}::date)::timestamp AT TIME ZONE ${DEFAULT_TIME_ZONE}`;
const dayEnd = (date: string) =>
  sql`((${date}::date + 1))::timestamp AT TIME ZONE ${DEFAULT_TIME_ZONE}`;

/** Métricas de uso por espaço (RF-SUPER-09) e log de auditoria global (RF-SUPER-10). */
@Injectable()
export class InsightsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async metrics(query: SuperMetricsQuery): Promise<SuperMetrics> {
    const to = query.to ?? localToday();
    const from = query.from ?? addDays(to, -29);

    const where = query.q
      ? or(ilike(spaces.name, likePattern(query.q)), ilike(spaces.slug, likePattern(query.q)))
      : undefined;
    const [totalRow] = await this.db.select({ total: count() }).from(spaces).where(where);
    const rows = await this.db
      .select({ id: spaces.id, name: spaces.name, slug: spaces.slug, status: spaces.status })
      .from(spaces)
      .where(where)
      .orderBy(asc(spaces.name), asc(spaces.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const ids = rows.map((row) => row.id);

    const bookingCounts = new Map<string, number>();
    const recurringCounts = new Map<string, number>();
    const lastAccess = new Map<string, Date>();
    if (ids.length) {
      const [bookingRows, recurringRows, accessRows] = await Promise.all([
        this.db
          .select({ spaceId: bookings.spaceId, total: count() })
          .from(bookings)
          .where(
            and(
              inArray(bookings.spaceId, ids),
              // Reserva aguardando pagamento ainda não conta (RN-ONPAY-02).
              notInArray(bookings.status, ['CANCELLED', 'PENDING_PAYMENT']),
              sql`${bookings.startsAt} >= ${dayStart(from)}`,
              sql`${bookings.startsAt} < ${dayEnd(to)}`,
            ),
          )
          .groupBy(bookings.spaceId),
        this.db
          .select({ spaceId: recurringBookings.spaceId, total: count() })
          .from(recurringBookings)
          .where(
            and(inArray(recurringBookings.spaceId, ids), eq(recurringBookings.status, 'ACTIVE')),
          )
          .groupBy(recurringBookings.spaceId),
        this.db
          .select({
            spaceId: spaceMembers.spaceId,
            lastAccessAt: sql<Date | null>`max(${sessions.updatedAt})`,
          })
          .from(spaceMembers)
          .innerJoin(sessions, eq(sessions.userId, spaceMembers.userId))
          .where(and(inArray(spaceMembers.spaceId, ids), eq(spaceMembers.status, 'ACTIVE')))
          .groupBy(spaceMembers.spaceId),
      ]);
      for (const row of bookingRows) bookingCounts.set(row.spaceId, row.total);
      for (const row of recurringRows) recurringCounts.set(row.spaceId, row.total);
      for (const row of accessRows) {
        if (row.lastAccessAt) lastAccess.set(row.spaceId, new Date(row.lastAccessAt));
      }
    }

    return {
      items: rows.map((row) => ({
        spaceId: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        bookings: bookingCounts.get(row.id) ?? 0,
        activeRecurring: recurringCounts.get(row.id) ?? 0,
        // Aulas e torneios chegam na Fase 2: até lá não há o que contar.
        activeStudents: 0,
        attendances: 0,
        tournaments: 0,
        lastAccessAt: lastAccess.get(row.id)?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.total ?? 0,
      period: { from, to },
    };
  }

  /**
   * Log global, mais recente primeiro. O cursor é o id (uuid v7, ordenado pelo tempo de criação):
   * a paginação não repete nem pula linhas, mesmo com várias no mesmo instante.
   */
  async auditLog(query: AuditLogQuery): Promise<AuditLogPage> {
    const conditions: SQL[] = [];
    if (query.actorId) conditions.push(eq(auditLogs.actorId, query.actorId));
    if (query.spaceId) conditions.push(eq(auditLogs.spaceId, query.spaceId));
    if (query.entity) conditions.push(eq(auditLogs.entity, query.entity));
    if (query.action) {
      const prefix = likePattern(query.action).slice(1);
      conditions.push(sql`${auditLogs.action} LIKE ${prefix}`);
    }
    if (query.actingAsSuper !== undefined) {
      conditions.push(eq(auditLogs.actingAsSuper, query.actingAsSuper));
    }
    if (query.from) conditions.push(sql`${auditLogs.createdAt} >= ${dayStart(query.from)}`);
    if (query.to) conditions.push(sql`${auditLogs.createdAt} < ${dayEnd(query.to)}`);
    if (query.cursor) {
      if (!UUID.test(query.cursor)) throw invalidCursor();
      conditions.push(lt(auditLogs.id, query.cursor));
    }

    const rows = await this.db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        actorName: users.name,
        actingAsSuper: auditLogs.actingAsSuper,
        spaceId: auditLogs.spaceId,
        spaceName: spaces.name,
        action: auditLogs.action,
        entity: auditLogs.entity,
        entityId: auditLogs.entityId,
        diff: auditLogs.diff,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .leftJoin(spaces, eq(spaces.id, auditLogs.spaceId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}

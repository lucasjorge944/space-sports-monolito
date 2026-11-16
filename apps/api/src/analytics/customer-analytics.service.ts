import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_ANALYTICS_COLUMNS,
  type CustomerAnalytics,
  type CustomerAnalyticsQuery,
} from '@space-sports/shared';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { SpaceContextService } from '../bookings/space-context.js';
import type { Database } from '../db/client.js';
import { bookings, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { bookingCounts } from './analytics-common.js';
import {
  columnsOf,
  fillRows,
  hoursOf,
  inPeriod,
  num,
  resolvePeriod,
  timeBucketSql,
  timeBuckets,
} from './period.js';

/**
 * Quem é o cliente da reserva: a conta do app (organizador) ou, no balcão sem conta, o cliente
 * identificado pelo telefone (ou pelo nome, sem telefone). O contato vira um hash dentro do banco:
 * nunca sai na resposta (decisão 122), e nem a aplicação o lê.
 */
const customerId = sql<string>`coalesce(${bookings.organizerUserId}::text, 'g:' || md5(coalesce(${bookings.guestPhone}, lower(btrim(${bookings.guestName})), '')))`;

type Counts = Omit<CustomerAnalytics['totals'], 'returningCustomers' | 'hours'> & {
  minutes: number;
};
const values = (c: Counts): CustomerAnalytics['totals'] => ({
  customers: c.customers,
  newCustomers: c.newCustomers,
  returningCustomers: c.customers - c.newCustomers,
  recurringCustomers: c.recurringCustomers,
  bookings: c.bookings,
  hours: hoursOf(c.minutes),
});
const zero = (): Counts => ({
  customers: 0,
  newCustomers: 0,
  recurringCustomers: 0,
  bookings: 0,
  minutes: 0,
});

/**
 * Clientes das reservas do espaço (docs/14-mcp.md 8.4): únicos, novos × recorrentes, mensalistas e
 * quem mais reserva, só com nome e contagens (decisão 122). Uma consulta: a primeira reserva de
 * cada cliente no espaço (CTE) e as reservas do período, agregadas por grupo e no total
 * (`GROUPING SETS`, contagens distintas).
 */
@Injectable()
export class CustomerAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceContextService,
  ) {}

  async customers(spaceId: string, query: CustomerAnalyticsQuery): Promise<CustomerAnalytics> {
    const { timeZone } = await this.spaces.load(spaceId);
    const period = resolvePeriod(query, timeZone);
    const { groupBy } = query;
    const counts = bookingCounts();

    // Reservas do período e dos filtros: as linhas da métrica.
    const inScope = and(
      eq(bookings.spaceId, spaceId),
      inPeriod(bookings.startsAt, period),
      counts,
      query.courtId ? eq(bookings.courtId, query.courtId) : undefined,
      query.sportId ? eq(bookings.sportId, query.sportId) : undefined,
    );
    // Primeira reserva que conta, no espaço inteiro (qualquer quadra e esporte), só de quem aparece
    // no período: o histórico dos outros clientes não é lido.
    const firsts = this.db.$with('firsts').as(
      this.db
        .select({
          customerId: customerId.as('customer_id'),
          firstAt: sql<Date>`min(${bookings.startsAt})`.as('first_at'),
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.spaceId, spaceId),
            counts,
            inArray(
              customerId,
              this.db.selectDistinct({ customerId }).from(bookings).where(inScope),
            ),
          ),
        )
        .groupBy(sql`1`),
    );

    const start = sql`${period.start.toISOString()}::timestamptz`;
    const newInPeriod = sql`${firsts.firstAt} >= ${start}`;
    const key: SQL<string> =
      groupBy === 'customer' ? customerId : timeBucketSql(groupBy, bookings.startsAt, timeZone);
    // Novo no grupo: a primeira reserva caiu no período e no mesmo grupo de data.
    const newInGroup: SQL =
      groupBy === 'customer'
        ? newInPeriod
        : sql`${newInPeriod} AND ${timeBucketSql(groupBy, sql`${firsts.firstAt}`, timeZone)} = ${key}`;

    const lines = this.db
      .with(firsts)
      .select({
        key: sql<string>`${key}`.as('key'),
        customerId: sql<string>`${customerId}`.as('customer_id'),
        // Conta criada pelo telefone pode ter o nome vazio: cai no nome do balcão ou em nulo.
        name: sql<
          string | null
        >`coalesce(nullif(btrim(${users.name}), ''), nullif(btrim(${bookings.guestName}), ''))`.as(
          'name',
        ),
        newInGroup: sql<boolean>`${newInGroup}`.as('new_in_group'),
        newInPeriod: sql<boolean>`${newInPeriod}`.as('new_in_period'),
        recurring: sql<boolean>`${bookings.recurringBookingId} IS NOT NULL`.as('recurring'),
        durationMin: sql<number>`${bookings.durationMin}`.as('duration_min'),
      })
      .from(bookings)
      .innerJoin(firsts, sql`${firsts.customerId} = ${customerId}`)
      .leftJoin(users, eq(users.id, bookings.organizerUserId))
      .where(inScope)
      .as('lines');

    const isTotal = sql<boolean>`grouping(${lines.key}) = 1`;
    const distinct = (filter?: SQL) =>
      filter
        ? sql<number>`(count(DISTINCT ${lines.customerId}) FILTER (WHERE ${filter}))::int`
        : sql<number>`(count(DISTINCT ${lines.customerId}))::int`;
    const bookingsCount = sql<number>`count(*)::int`;
    const minutes = sql<string>`coalesce(sum(${lines.durationMin}), 0)::bigint`;
    let aggregate = this.db
      .select({
        key: lines.key,
        name: sql<string | null>`max(${lines.name})`,
        isTotal,
        customers: distinct(),
        newInGroup: distinct(sql`${lines.newInGroup}`),
        newInPeriod: distinct(sql`${lines.newInPeriod}`),
        recurringCustomers: distinct(sql`${lines.recurring}`),
        bookings: bookingsCount,
        minutes,
      })
      .from(lines)
      .groupBy(sql`GROUPING SETS ((${lines.key}), ())`)
      .$dynamic();
    if (groupBy === 'customer') {
      // O total primeiro, depois quem mais reservou (desempate: horas, nome).
      aggregate = aggregate
        .orderBy(
          sql`${isTotal} DESC`,
          sql`${bookingsCount} DESC`,
          sql`${minutes} DESC`,
          sql`max(${lines.name})`,
          lines.key,
        )
        .limit(query.limit + 1);
    }
    const rows = await aggregate;

    let total = zero();
    const found = new Map<string, CustomerAnalytics['totals']>();
    const labels = new Map<string, string>();
    let guests = 0;
    for (const row of rows) {
      const counted: Counts = {
        customers: row.customers,
        newCustomers: row.isTotal ? row.newInPeriod : row.newInGroup,
        recurringCustomers: row.recurringCustomers,
        bookings: row.bookings,
        minutes: num(row.minutes),
      };
      if (row.isTotal) {
        total = counted;
        continue;
      }
      // O cliente sem conta não tem id que possa sair: a chave é a posição na lista.
      const rowKey =
        groupBy === 'customer' && row.key.startsWith('g:') ? `guest-${++guests}` : row.key;
      found.set(rowKey, values(counted));
      labels.set(rowKey, row.name || 'Cliente sem nome');
    }

    return {
      period: { from: period.from, to: period.to },
      groupBy,
      timezone: timeZone,
      columns: columnsOf(CUSTOMER_ANALYTICS_COLUMNS),
      rows: fillRows(
        groupBy === 'customer' ? [] : timeBuckets(groupBy, period),
        found,
        () => values(zero()),
        (key) => labels.get(key) ?? key,
      ),
      totals: values(total),
    };
  }
}

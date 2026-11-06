import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  type FinanceQuery,
  type FinanceSummary,
  type PaymentMethod,
  type SpaceService,
} from '@space-sports/shared';
import { and, asc, desc, eq, gt, isNull, type SQL, sql } from 'drizzle-orm';
import { CSV_BOM, csvLine, csvUtcDateTime } from '../common/csv.js';
import type { Database } from '../db/client.js';
import { paymentRecords, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { superAudit } from './super-audit.js';

type PayableType = (typeof paymentRecords.$inferSelect)['payableType'];

/** Serviço de origem de cada tipo de pagamento (aluguel inclui participantes e mensalidades antigas). */
const SERVICE_OF: Record<PayableType, SpaceService> = {
  BOOKING: 'RENTAL',
  BOOKING_PARTICIPANT: 'RENTAL',
  RECURRING_BOOKING_CHARGE: 'RENTAL',
  SUBSCRIPTION_CHARGE: 'CLASSES',
  TEAM: 'TOURNAMENTS',
};

const CSV_BATCH = 1000;
export const CSV_COLUMNS = [
  'id',
  'pago_em_utc',
  'pago_em_local',
  'espaco',
  'servico',
  'tipo',
  'forma',
  'canal',
  'valor_centavos',
  'estornado_em_utc',
] as const;

/** Hoje no fuso dos espaços (`YYYY-MM-DD`). */
function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE }).format(now);
}

/** Período do pedido: padrão do dia 1 do mês atual até hoje (datas locais, inclusivas). */
export function periodOf(query: Pick<FinanceQuery, 'from' | 'to'>): { from: string; to: string } {
  const today = localToday();
  return { from: query.from ?? `${today.slice(0, 8)}01`, to: query.to ?? today };
}

const num = (value: unknown) => Number(value ?? 0);

/** Financeiro consolidado, só leitura sobre `payment_records` (RF-SUPER-05). */
@Injectable()
export class FinanceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Filtro do período: `paid_at` dentro dos dias locais `from`..`to` (inclusive). */
  private conditions(query: FinanceQuery): { period: { from: string; to: string }; where: SQL[] } {
    const period = periodOf(query);
    const tz = DEFAULT_TIME_ZONE;
    const where: SQL[] = [
      sql`${paymentRecords.paidAt} >= (${period.from}::date)::timestamp AT TIME ZONE ${tz}`,
      sql`${paymentRecords.paidAt} < ((${period.to}::date + 1))::timestamp AT TIME ZONE ${tz}`,
    ];
    if (query.spaceId) where.push(eq(paymentRecords.spaceId, query.spaceId));
    return { period, where };
  }

  async summary(query: FinanceQuery): Promise<FinanceSummary> {
    const { period, where } = this.conditions(query);
    const received = and(...where, isNull(paymentRecords.reversedAt));
    const amount = sql<string>`coalesce(sum(${paymentRecords.amountCents}), 0)::bigint`;
    const total = sql<number>`count(*)::int`;

    const [reversed] = await this.db
      .select({ cents: amount })
      .from(paymentRecords)
      .where(and(...where, sql`${paymentRecords.reversedAt} IS NOT NULL`));

    const [bySpace, byType, byMethod, byChannel] = await Promise.all([
      this.db
        .select({
          spaceId: spaces.id,
          spaceName: spaces.name,
          receivedCents: amount,
          paymentsCount: total,
        })
        .from(paymentRecords)
        .innerJoin(spaces, eq(spaces.id, paymentRecords.spaceId))
        .where(received)
        .groupBy(spaces.id, spaces.name)
        .orderBy(desc(amount), asc(spaces.name), asc(spaces.id)),
      this.db
        .select({
          payableType: paymentRecords.payableType,
          receivedCents: amount,
          paymentsCount: total,
        })
        .from(paymentRecords)
        .where(received)
        .groupBy(paymentRecords.payableType),
      this.db
        .select({ method: paymentRecords.method, receivedCents: amount, paymentsCount: total })
        .from(paymentRecords)
        .where(received)
        .groupBy(paymentRecords.method)
        .orderBy(desc(amount), asc(paymentRecords.method)),
      this.db
        .select({ channel: paymentRecords.channel, receivedCents: amount, paymentsCount: total })
        .from(paymentRecords)
        .where(received)
        .groupBy(paymentRecords.channel)
        .orderBy(asc(paymentRecords.channel)),
    ]);

    const byService = new Map<SpaceService, { receivedCents: number; paymentsCount: number }>();
    for (const row of byType) {
      const service = SERVICE_OF[row.payableType];
      const acc = byService.get(service) ?? { receivedCents: 0, paymentsCount: 0 };
      acc.receivedCents += num(row.receivedCents);
      acc.paymentsCount += row.paymentsCount;
      byService.set(service, acc);
    }

    return {
      period,
      totals: {
        receivedCents: bySpace.reduce((sum, row) => sum + num(row.receivedCents), 0),
        paymentsCount: bySpace.reduce((sum, row) => sum + row.paymentsCount, 0),
        reversedCents: num(reversed?.cents),
      },
      bySpace: bySpace.map((row) => ({ ...row, receivedCents: num(row.receivedCents) })),
      byService: [...byService.entries()]
        .map(([service, values]) => ({ service, ...values }))
        .sort((a, b) => b.receivedCents - a.receivedCents || a.service.localeCompare(b.service)),
      byMethod: byMethod.map((row) => ({
        ...row,
        method: row.method as PaymentMethod,
        receivedCents: num(row.receivedCents),
      })),
      byChannel: byChannel.map((row) => ({ ...row, receivedCents: num(row.receivedCents) })),
    };
  }

  /**
   * Registra a exportação na auditoria (RF-SUPER-10) antes do download: o arquivo leva os
   * valores de todos os espaços, então fica o registro de quem exportou, o período e o filtro.
   */
  async auditExport(actorId: string, query: FinanceQuery): Promise<void> {
    const period = periodOf(query);
    await superAudit(this.db, actorId, {
      action: 'super.finance.export_csv',
      entity: 'payment_record',
      entityId: null,
      spaceId: query.spaceId ?? null,
      diff: { ...period, spaceId: query.spaceId ?? null },
    });
  }

  /**
   * CSV dos registros de pagamento do período (um por linha, inclusive os estornados, com a data
   * do estorno), em lotes por id para não carregar tudo na memória. Excel BR: UTF-8 com BOM.
   */
  async *exportCsv(query: FinanceQuery): AsyncGenerator<string> {
    const { where } = this.conditions(query);
    yield `${CSV_BOM}${CSV_COLUMNS.join(',')}\r\n`;

    let lastId: string | null = null;
    for (;;) {
      const rows = await this.db
        .select({
          id: paymentRecords.id,
          paidAt: paymentRecords.paidAt,
          paidLocal: sql<string>`to_char(${paymentRecords.paidAt} AT TIME ZONE ${DEFAULT_TIME_ZONE}, 'DD/MM/YYYY HH24:MI:SS')`,
          spaceName: spaces.name,
          payableType: paymentRecords.payableType,
          method: paymentRecords.method,
          channel: paymentRecords.channel,
          amountCents: paymentRecords.amountCents,
          reversedAt: paymentRecords.reversedAt,
        })
        .from(paymentRecords)
        .innerJoin(spaces, eq(spaces.id, paymentRecords.spaceId))
        .where(and(...where, lastId ? gt(paymentRecords.id, lastId) : undefined))
        .orderBy(asc(paymentRecords.id))
        .limit(CSV_BATCH);
      if (!rows.length) return;

      yield rows
        .map((row) =>
          csvLine([
            row.id,
            csvUtcDateTime(row.paidAt),
            row.paidLocal,
            row.spaceName,
            SERVICE_OF[row.payableType],
            row.payableType,
            row.method,
            row.channel === 'ONLINE' ? 'online' : 'no_local',
            row.amountCents,
            row.reversedAt ? csvUtcDateTime(row.reversedAt) : '',
          ]),
        )
        .join('');
      lastId = rows[rows.length - 1]?.id ?? null;
      if (rows.length < CSV_BATCH) return;
    }
  }
}

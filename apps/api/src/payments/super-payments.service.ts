import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  type MonthlyFeeReport,
  type PlatformFees,
  type PlatformRevenue,
  type PlatformRevenueQuery,
  type RevenueFigures,
  resolveFeeSettings,
  type UpdateDefaultFeesInput,
  type UpdateSpaceFeesInput,
} from '@space-sports/shared';
import { type AnyColumn, and, asc, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { CSV_BOM, csvLine } from '../common/csv.js';
import type { Database } from '../db/client.js';
import {
  merchantAccounts,
  onlineCharges,
  platformFeeSettings,
  spaceLedgerEntries,
  spacePaymentSettings,
  spaces,
  users,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { spaceNotFound } from '../spaces/spaces.errors.js';
import { superAudit } from '../super/super-audit.js';
import { type DataCipher, PAYMENTS_DATA_CIPHER } from './data-cipher.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { PaymentGateway } from './gateway/payment-gateway.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { feePayerNotAllowed } from './payments.errors.js';

const TZ = DEFAULT_TIME_ZONE;
const num = (value: unknown) => Number(value ?? 0);

export const REVENUE_CSV_COLUMNS = [
  'espaco_id',
  'espaco',
  'cobrancas',
  'volume_centavos',
  'taxa_bruta_centavos',
  'tarifa_gateway_centavos',
  'taxa_devolvida_centavos',
  'taxa_recobrada_centavos',
  'receita_liquida_centavos',
] as const;

export const NFSE_CSV_COLUMNS = [
  'mes',
  'espaco',
  'razao_social',
  'tipo_documento',
  'documento',
  'taxa_bruta_centavos',
  'taxa_devolvida_centavos',
  'taxa_recobrada_centavos',
  'base_nota_centavos',
] as const;

/**
 * Receita a partir do livro-razão (decisão 91), pela data de cada lançamento: o mês fechado não
 * muda com um estorno ou contestação depois. Venda (`SALE`), taxa cobrada (`PLATFORM_FEE` da
 * venda), taxa devolvida (`FEE_REFUND`) e a recobrança da contestação ganha (`PLATFORM_FEE` de um
 * chargeback). A tarifa do gateway entra pela data do pagamento da cobrança.
 */
const ledgerFigures = {
  chargesCount: sql<number>`(count(*) FILTER (WHERE ${spaceLedgerEntries.kind} = 'SALE'))::int`,
  volumeCents: sql<string>`coalesce(sum(${spaceLedgerEntries.amountCents}) FILTER (WHERE ${spaceLedgerEntries.kind} = 'SALE'), 0)::bigint`,
  grossFeeCents: sql<string>`coalesce(-sum(${spaceLedgerEntries.amountCents}) FILTER (WHERE ${spaceLedgerEntries.kind} = 'PLATFORM_FEE' AND ${spaceLedgerEntries.refundId} IS NULL), 0)::bigint`,
  feeRechargedCents: sql<string>`coalesce(-sum(${spaceLedgerEntries.amountCents}) FILTER (WHERE ${spaceLedgerEntries.kind} = 'PLATFORM_FEE' AND ${spaceLedgerEntries.refundId} IS NOT NULL), 0)::bigint`,
  feeRefundedCents: sql<string>`coalesce(sum(${spaceLedgerEntries.amountCents}) FILTER (WHERE ${spaceLedgerEntries.kind} = 'FEE_REFUND'), 0)::bigint`,
};
const costFigure = {
  gatewayCostCents: sql<string>`coalesce(sum(${onlineCharges.gatewayCostCents}), 0)::bigint`,
};

type LedgerRow = { [K in keyof typeof ledgerFigures]: unknown };

function toFigures(row: LedgerRow | undefined, cost: unknown): RevenueFigures {
  const gross = num(row?.grossFeeCents);
  const refunded = num(row?.feeRefundedCents);
  const recharged = num(row?.feeRechargedCents);
  const gatewayCost = num(cost);
  return {
    chargesCount: num(row?.chargesCount),
    volumeCents: num(row?.volumeCents),
    grossFeeCents: gross,
    gatewayCostCents: gatewayCost,
    feeRefundedCents: refunded,
    feeRechargedCents: recharged,
    netRevenueCents: gross - gatewayCost - refunded + recharged,
  };
}

/** Intervalo local [from, to] (datas inclusivas, America/Sao_Paulo) sobre um instante. */
const inLocalDays = (column: SQL | AnyColumn, from: string, to: string) =>
  sql`${column} >= (${from}::date)::timestamp AT TIME ZONE ${TZ} AND ${column} < ((${to}::date + 1))::timestamp AT TIME ZONE ${TZ}`;

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

/** Período padrão: do dia 1 do mês até hoje (datas locais, inclusivas). */
export function revenuePeriod(query: Pick<PlatformRevenueQuery, 'from' | 'to'>) {
  const today = localToday();
  return { from: query.from ?? `${today.slice(0, 8)}01`, to: query.to ?? today };
}

/**
 * Super do pagamento online (RF-ONPAY-10, RF-ONPAY-11): taxa padrão e por espaço (auditadas,
 * `super.payment_fee.*`) e a receita da plataforma, que é a taxa − a tarifa do gateway − a taxa
 * devolvida (decisão 91). O relatório mensal para a NFS-e é o único lugar com o documento completo
 * do cadastro, e cada leitura fica na auditoria (`super.payment_report.*`).
 */
@Injectable()
export class SuperPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly settings: PaymentSettingsService,
    @Inject(PAYMENTS_DATA_CIPHER) private readonly cipher: DataCipher,
  ) {}

  async fees(): Promise<PlatformFees> {
    const [row] = await this.db
      .select({ fees: platformFeeSettings, updatedByName: users.name })
      .from(platformFeeSettings)
      .leftJoin(users, eq(users.id, platformFeeSettings.updatedBy))
      .where(eq(platformFeeSettings.id, 1));
    if (!row) throw new Error('platform_fee_settings sem a linha padrão.');
    const defaults = {
      pixFeeBps: row.fees.pixFeeBps,
      cardFeeBps: row.fees.cardFeeBps,
      minFeeCents: row.fees.minFeeCents,
      feePayer: row.fees.feePayer,
    };
    const overrides = await this.db
      .select({ settings: spacePaymentSettings, spaceName: spaces.name })
      .from(spacePaymentSettings)
      .innerJoin(spaces, eq(spaces.id, spacePaymentSettings.spaceId))
      .where(
        or(
          isNotNull(spacePaymentSettings.pixFeeBps),
          isNotNull(spacePaymentSettings.cardFeeBps),
          isNotNull(spacePaymentSettings.minFeeCents),
          isNotNull(spacePaymentSettings.feePayer),
        ),
      )
      .orderBy(asc(spaces.name));
    return {
      defaults: {
        ...defaults,
        updatedAt: row.fees.updatedAt.toISOString(),
        updatedByName: row.updatedByName,
      },
      paymentEnvironment: paymentEnvironmentOf(this.gateway),
      spaces: overrides.map(({ settings, spaceName }) => ({
        spaceId: settings.spaceId,
        spaceName,
        pixFeeBps: settings.pixFeeBps,
        cardFeeBps: settings.cardFeeBps,
        minFeeCents: settings.minFeeCents,
        feePayer: settings.feePayer,
        effective: resolveFeeSettings(defaults, settings),
        updatedAt: settings.updatedAt.toISOString(),
      })),
    };
  }

  async updateDefaults(actorId: string, input: UpdateDefaultFeesInput): Promise<PlatformFees> {
    if (input.feePayer !== 'SPACE') throw feePayerNotAllowed();
    await this.db.transaction(async (tx) => {
      const before = await this.settings.defaultFees(tx);
      await tx
        .update(platformFeeSettings)
        .set({ ...input, updatedBy: actorId })
        .where(eq(platformFeeSettings.id, 1));
      await superAudit(tx, actorId, {
        action: 'super.payment_fee.update_default',
        entity: 'platform_fee_settings',
        entityId: null,
        diff: {
          from: {
            pixFeeBps: before.pixFeeBps,
            cardFeeBps: before.cardFeeBps,
            minFeeCents: before.minFeeCents,
            feePayer: before.feePayer,
          },
          to: input,
        },
      });
    });
    return this.fees();
  }

  /** Taxa própria do espaço; `null` em todos os campos volta ao padrão (remove a condição). */
  async updateSpace(
    actorId: string,
    spaceId: string,
    input: UpdateSpaceFeesInput,
  ): Promise<PlatformFees> {
    if (input.feePayer === 'PLAYER') throw feePayerNotAllowed();
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    if (!space) throw spaceNotFound();
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(spacePaymentSettings)
        .where(eq(spacePaymentSettings.spaceId, spaceId));
      await tx
        .insert(spacePaymentSettings)
        .values({ spaceId, ...input })
        .onConflictDoUpdate({ target: spacePaymentSettings.spaceId, set: input });
      await superAudit(tx, actorId, {
        action: 'super.payment_fee.update_space',
        entity: 'space_payment_settings',
        entityId: null,
        spaceId,
        diff: {
          from: {
            pixFeeBps: before?.pixFeeBps ?? null,
            cardFeeBps: before?.cardFeeBps ?? null,
            minFeeCents: before?.minFeeCents ?? null,
            feePayer: before?.feePayer ?? null,
          },
          to: input,
        },
      });
    });
    return this.fees();
  }

  /** Lançamentos de receita e cobranças pagas no período, com os mesmos filtros. */
  private async revenueRows(
    period: { from: string; to: string },
    filters: { spaceId?: string | undefined; method?: 'PIX' | 'CARD' | undefined },
    group: 'total' | 'space' | 'method' | 'month',
  ) {
    const monthOf = (column: AnyColumn) =>
      sql<string>`to_char(${column} AT TIME ZONE ${sql.raw(`'${TZ}'`)}, 'YYYY-MM')`;
    const ledgerKey =
      group === 'space'
        ? sql<string>`${spaceLedgerEntries.spaceId}::text`
        : group === 'method'
          ? sql<string>`${onlineCharges.method}::text`
          : group === 'month'
            ? monthOf(spaceLedgerEntries.createdAt)
            : sql<string>`'total'`;
    const costKey =
      group === 'space'
        ? sql<string>`${onlineCharges.spaceId}::text`
        : group === 'method'
          ? sql<string>`${onlineCharges.method}::text`
          : group === 'month'
            ? monthOf(onlineCharges.paidAt)
            : sql<string>`'total'`;
    const [ledger, costs] = await Promise.all([
      this.db
        .select({ key: ledgerKey, ...ledgerFigures })
        .from(spaceLedgerEntries)
        .innerJoin(onlineCharges, eq(onlineCharges.id, spaceLedgerEntries.chargeId))
        .where(
          and(
            inArray(spaceLedgerEntries.kind, ['SALE', 'PLATFORM_FEE', 'FEE_REFUND']),
            inLocalDays(spaceLedgerEntries.createdAt, period.from, period.to),
            filters.spaceId ? eq(spaceLedgerEntries.spaceId, filters.spaceId) : undefined,
            filters.method ? eq(onlineCharges.method, filters.method) : undefined,
          ),
        )
        .groupBy(sql`1`),
      this.db
        .select({ key: costKey, ...costFigure })
        .from(onlineCharges)
        .where(
          and(
            isNotNull(onlineCharges.paidAt),
            inLocalDays(onlineCharges.paidAt, period.from, period.to),
            filters.spaceId ? eq(onlineCharges.spaceId, filters.spaceId) : undefined,
            filters.method ? eq(onlineCharges.method, filters.method) : undefined,
          ),
        )
        .groupBy(sql`1`),
    ]);
    const costOf = new Map(costs.map((row) => [row.key, row.gatewayCostCents]));
    const keys = [...new Set([...ledger.map((row) => row.key), ...costs.map((row) => row.key)])];
    const ledgerOf = new Map(ledger.map((row) => [row.key, row]));
    return keys
      .sort()
      .map((key) => ({ key, figures: toFigures(ledgerOf.get(key), costOf.get(key)) }));
  }

  /** RF-ONPAY-11: receita por período, espaço, meio e mês, pela data de cada lançamento. */
  async revenue(query: PlatformRevenueQuery): Promise<PlatformRevenue> {
    const period = revenuePeriod(query);
    const filters = { spaceId: query.spaceId, method: query.method };
    const [totals, bySpace, byMethod, byMonth, names] = await Promise.all([
      this.revenueRows(period, filters, 'total'),
      this.revenueRows(period, filters, 'space'),
      this.revenueRows(period, filters, 'method'),
      this.revenueRows(period, filters, 'month'),
      this.db.select({ id: spaces.id, name: spaces.name }).from(spaces),
    ]);
    const nameOf = new Map(names.map((row) => [row.id, row.name]));
    return {
      period,
      totals: totals[0]?.figures ?? toFigures(undefined, 0),
      bySpace: bySpace
        .map(({ key, figures }) => ({ ...figures, spaceId: key, spaceName: nameOf.get(key) ?? '' }))
        .sort((a, b) => a.spaceName.localeCompare(b.spaceName, 'pt-BR')),
      byMethod: byMethod.map(({ key, figures }) => ({
        ...figures,
        method: key as 'PIX' | 'CARD',
      })),
      byMonth: byMonth.map(({ key, figures }) => ({ ...figures, month: key })),
    };
  }

  async *revenueCsv(actorId: string, query: PlatformRevenueQuery): AsyncGenerator<string> {
    const period = revenuePeriod(query);
    await superAudit(this.db, actorId, {
      action: 'super.payment_revenue.export_csv',
      entity: 'online_charge',
      entityId: null,
      spaceId: query.spaceId ?? null,
      diff: { ...period, method: query.method ?? null },
    });
    const revenue = await this.revenue(query);
    yield `${CSV_BOM}${REVENUE_CSV_COLUMNS.join(',')}\r\n`;
    yield revenue.bySpace
      .map((row) =>
        csvLine([
          row.spaceId,
          row.spaceName,
          row.chargesCount,
          row.volumeCents,
          row.grossFeeCents,
          row.gatewayCostCents,
          row.feeRefundedCents,
          row.feeRechargedCents,
          row.netRevenueCents,
        ]),
      )
      .join('');
  }

  /**
   * Relatório mensal de taxas por espaço, base da NFS-e (decisão 91): o único com o documento
   * completo do cadastro. A leitura fica na auditoria.
   */
  async monthlyReport(
    actorId: string,
    month: string,
    action: 'view' | 'export_csv' = 'view',
  ): Promise<MonthlyFeeReport> {
    const from = `${month}-01`;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const to = `${month}-${String(last.getUTCDate()).padStart(2, '0')}`;
    const rows = await this.revenueRows({ from, to }, {}, 'space');
    const accounts = rows.length
      ? await this.db
          .select({
            spaceId: merchantAccounts.spaceId,
            documentType: merchantAccounts.documentType,
            documentEncrypted: merchantAccounts.documentEncrypted,
            legalName: merchantAccounts.legalName,
          })
          .from(merchantAccounts)
          .where(
            inArray(
              merchantAccounts.spaceId,
              rows.map((row) => row.key),
            ),
          )
      : [];
    const accountOf = new Map(accounts.map((row) => [row.spaceId, row]));
    const spaceNames = new Map(
      (
        await this.db
          .select({ id: spaces.id, name: spaces.name })
          .from(spaces)
          .where(
            rows.length
              ? inArray(
                  spaces.id,
                  rows.map((row) => row.key),
                )
              : sql`false`,
          )
      ).map((row) => [row.id, row.name]),
    );
    // Decisão 97: o documento só é decifrado aqui, com a leitura auditada.
    await superAudit(this.db, actorId, {
      action: `super.payment_report.${action}`,
      entity: 'merchant_account',
      entityId: null,
      diff: { month, spaces: rows.length },
    });
    const items = rows
      .map(({ key, figures }) => {
        const account = accountOf.get(key);
        return {
          ...figures,
          spaceId: key,
          spaceName: spaceNames.get(key) ?? '',
          documentType: account?.documentType ?? null,
          document: account?.documentEncrypted
            ? this.cipher.decrypt(account.documentEncrypted, key)
            : null,
          legalName: account?.legalName ?? null,
          invoiceBaseCents:
            figures.grossFeeCents - figures.feeRefundedCents + figures.feeRechargedCents,
        };
      })
      .sort((a, b) => a.spaceName.localeCompare(b.spaceName, 'pt-BR'));
    const sum = (field: keyof RevenueFigures) => items.reduce((acc, item) => acc + item[field], 0);
    return {
      month,
      items,
      totals: {
        chargesCount: sum('chargesCount'),
        volumeCents: sum('volumeCents'),
        grossFeeCents: sum('grossFeeCents'),
        gatewayCostCents: sum('gatewayCostCents'),
        feeRefundedCents: sum('feeRefundedCents'),
        feeRechargedCents: sum('feeRechargedCents'),
        netRevenueCents: sum('netRevenueCents'),
      },
    };
  }

  async *monthlyReportCsv(actorId: string, month: string): AsyncGenerator<string> {
    const report = await this.monthlyReport(actorId, month, 'export_csv');
    yield `${CSV_BOM}${NFSE_CSV_COLUMNS.join(',')}\r\n`;
    yield report.items
      .map((item) =>
        csvLine([
          month,
          item.spaceName,
          item.legalName ?? '',
          item.documentType ?? '',
          item.document ?? '',
          item.grossFeeCents,
          item.feeRefundedCents,
          item.feeRechargedCents,
          item.invoiceBaseCents,
        ]),
      )
      .join('');
  }
}

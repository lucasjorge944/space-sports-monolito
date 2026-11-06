import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Chargeback,
  type ChargebackList,
  type CursorPageQuery,
  DEFAULT_TIME_ZONE,
  type DisputeChargebackInput,
  type LedgerEntry,
  type LedgerEntryPage,
  type OnlineChargePage,
  type OnlineChargesQuery,
  type PayoutPage,
  type WalletEntriesFilters,
  type WalletEntriesQuery,
  type WalletSummary,
} from '@space-sports/shared';
import { and, count, desc, eq, gte, inArray, lt, min, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { invalidCursor } from '../bookings/bookings.errors.js';
import { audit } from '../bookings/db-utils.js';
import { CSV_BOM, csvLine, csvLocalDateTime, csvUtcDateTime } from '../common/csv.js';
import type { Database } from '../db/client.js';
import {
  bookings,
  cities,
  merchantAccounts,
  onlineCharges,
  onlineRefunds,
  payouts,
  spaceLedgerEntries,
  spaces,
  subscriptionCharges,
  users,
} from '../db/schema/index.js';
import { DomainEvents } from '../events/domain-events.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY, paymentEnvironmentOf } from './gateway/gateway.registry.js';
import type { PaymentGateway } from './gateway/payment-gateway.js';
import { addLedgerEntries } from './ledger.js';
import { loadStaffCharges } from './online-queries.js';
import { toRefund } from './online-views.js';
import {
  chargebackNotFound,
  disputeClosed,
  disputeDeadlinePassed,
  gatewayUnavailable,
  onlinePaymentsDisabled,
} from './payments.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSV_BATCH = 1000;

/** Cursor opaco por id (uuid v7 = ordem de criação). */
const encodeId = (id: string) => Buffer.from(id).toString('base64url');
function decodeId(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID.test(id)) throw invalidCursor();
  return id;
}

export const WALLET_CSV_COLUMNS = [
  'id',
  'criado_em_utc',
  'criado_em_local',
  'tipo',
  'descricao',
  'meio',
  'valor_centavos',
  'libera_em_local',
  'cobranca_id',
] as const;

const KIND_LABELS = {
  SALE: 'Venda',
  PLATFORM_FEE: 'Taxa de serviço',
  REFUND: 'Estorno ao cliente',
  FEE_REFUND: 'Taxa devolvida',
  CHARGEBACK: 'Contestação no cartão',
  PAYOUT: 'Repasse',
  ADJUSTMENT: 'Ajuste',
} as const;

const payer = alias(users, 'payer');
const num = (value: unknown) => Number(value ?? 0);

/**
 * Carteira do espaço (RF-ONPAY-07, RF-ONPAY-09; decisão 89): espelho do saldo da subconta no
 * livro-razão, lançamentos com filtros e CSV, repasses, cobranças e contestações. Só leitura, menos
 * a resposta à contestação. Sempre filtrado pelo `space_id` da rota.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly events: DomainEvents,
  ) {}

  private async timeZoneOf(spaceId: string): Promise<string> {
    const [row] = await this.db
      .select({ timeZone: cities.timezone })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(eq(spaces.id, spaceId));
    return row?.timeZone || DEFAULT_TIME_ZONE;
  }

  async summary(spaceId: string, now: Date = new Date()): Promise<WalletSummary> {
    const timeZone = await this.timeZoneOf(spaceId);
    // Fuso como literal: com parâmetro, o GROUP BY não reconhece a mesma expressão do SELECT.
    const zone = sql.raw(`'${timeZone.replace(/'/g, "''")}'`);
    const local = sql<string>`to_char(${spaceLedgerEntries.availableAt} AT TIME ZONE ${zone}, 'YYYY-MM-DD')`;
    const [[totals], upcoming, [paidOut], [merchant], [disputes], failed] = await Promise.all([
      this.db
        .select({
          balance: sql<string>`coalesce(sum(${spaceLedgerEntries.amountCents}), 0)::bigint`,
          available: sql<string>`coalesce(sum(${spaceLedgerEntries.amountCents}) FILTER (WHERE ${spaceLedgerEntries.availableAt} <= ${now.toISOString()}::timestamptz), 0)::bigint`,
        })
        .from(spaceLedgerEntries)
        .where(eq(spaceLedgerEntries.spaceId, spaceId)),
      this.db
        .select({
          date: local,
          amount: sql<string>`sum(${spaceLedgerEntries.amountCents})::bigint`,
        })
        .from(spaceLedgerEntries)
        .where(
          and(
            eq(spaceLedgerEntries.spaceId, spaceId),
            sql`${spaceLedgerEntries.availableAt} > ${now.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(local)
        .orderBy(local),
      this.db
        .select({ cents: sql<string>`coalesce(sum(${payouts.amountCents}), 0)::bigint` })
        .from(payouts)
        .where(and(eq(payouts.spaceId, spaceId), eq(payouts.status, 'PAID'))),
      this.db
        .select({ status: merchantAccounts.status, approvedAt: merchantAccounts.approvedAt })
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, spaceId)),
      this.db
        .select({ count: count(), next: min(onlineRefunds.disputeRespondBy) })
        .from(onlineRefunds)
        .where(
          and(
            eq(onlineRefunds.spaceId, spaceId),
            eq(onlineRefunds.disputeStatus, 'AWAITING_RESPONSE'),
          ),
        ),
      this.db
        .select({ amount: payouts.amountCents, at: payouts.updatedAt })
        .from(payouts)
        .where(and(eq(payouts.spaceId, spaceId), eq(payouts.status, 'FAILED')))
        .orderBy(desc(payouts.updatedAt)),
    ]);
    const balance = num(totals?.balance);
    const available = num(totals?.available);
    return {
      merchantAccountStatus: merchant?.status ?? 'NOT_STARTED',
      payoutsPaused: merchant?.status === 'PENDING' && merchant.approvedAt !== null,
      paymentEnvironment: paymentEnvironmentOf(this.gateway),
      openDisputes: {
        count: disputes?.count ?? 0,
        nextRespondBy: disputes?.next?.toISOString() ?? null,
      },
      failedPayouts: {
        count: failed.length,
        lastAmountCents: failed[0]?.amount ?? null,
        lastAt: failed[0]?.at.toISOString() ?? null,
      },
      timeZone,
      availableCents: available,
      pendingCents: balance - available,
      balanceCents: balance,
      paidOutCents: num(paidOut?.cents),
      upcoming: upcoming.map((row) => ({ date: row.date, amountCents: num(row.amount) })),
    };
  }

  /** Filtros da tela (período, tipo e meio); o meio vem da cobrança do lançamento (`onlineCharges`). */
  private entryConditions(spaceId: string, filters: WalletEntriesFilters): SQL | undefined {
    return and(
      eq(spaceLedgerEntries.spaceId, spaceId),
      filters.from ? gte(spaceLedgerEntries.createdAt, filters.from) : undefined,
      filters.to ? lt(spaceLedgerEntries.createdAt, filters.to) : undefined,
      filters.kind?.length ? inArray(spaceLedgerEntries.kind, filters.kind) : undefined,
      filters.method ? eq(onlineCharges.method, filters.method) : undefined,
    );
  }

  private async countEntries(where: SQL | undefined): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(spaceLedgerEntries)
      .leftJoin(onlineCharges, eq(onlineCharges.id, spaceLedgerEntries.chargeId))
      .where(where);
    return row?.total ?? 0;
  }

  private async entryRows(where: SQL | undefined, limit: number, order: 'asc' | 'desc') {
    return this.db
      .select({
        entry: spaceLedgerEntries,
        method: onlineCharges.method,
        payableType: onlineCharges.payableType,
        payableId: onlineCharges.payableId,
        payerName: payer.name,
      })
      .from(spaceLedgerEntries)
      .leftJoin(onlineCharges, eq(onlineCharges.id, spaceLedgerEntries.chargeId))
      .leftJoin(payer, eq(payer.id, onlineCharges.payerUserId))
      .where(where)
      .orderBy(order === 'desc' ? desc(spaceLedgerEntries.id) : spaceLedgerEntries.id)
      .limit(limit);
  }

  async entries(spaceId: string, query: WalletEntriesQuery): Promise<LedgerEntryPage> {
    const before = query.cursor ? decodeId(query.cursor) : undefined;
    const where = this.entryConditions(spaceId, query);
    const [rows, total] = await Promise.all([
      this.entryRows(
        and(where, before ? lt(spaceLedgerEntries.id, before) : undefined),
        query.limit + 1,
        'desc',
      ),
      this.countEntries(where),
    ]);
    const now = new Date();
    const items = rows.slice(0, query.limit).map((row) => toEntry(row, now));
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeId(last.id) : null,
      total,
    };
  }

  /** CSV dos lançamentos com os filtros da tela, em ordem cronológica e em lotes. */
  async *entriesCsv(spaceId: string, filters: WalletEntriesFilters): AsyncGenerator<string> {
    const timeZone = await this.timeZoneOf(spaceId);
    const where = this.entryConditions(spaceId, filters);
    yield `${CSV_BOM}${WALLET_CSV_COLUMNS.join(',')}\r\n`;
    let after: string | undefined;
    for (;;) {
      const rows = await this.entryRows(
        and(where, after ? sql`${spaceLedgerEntries.id} > ${after}::uuid` : undefined),
        CSV_BATCH,
        'asc',
      );
      if (!rows.length) return;
      yield rows
        .map(({ entry, method, payerName }) =>
          csvLine([
            entry.id,
            csvUtcDateTime(entry.createdAt),
            csvLocalDateTime(entry.createdAt, timeZone),
            KIND_LABELS[entry.kind],
            entry.description ?? payerName ?? '',
            method ?? '',
            entry.amountCents,
            csvLocalDateTime(entry.availableAt, timeZone),
            entry.chargeId ?? '',
          ]),
        )
        .join('');
      after = rows.at(-1)?.entry.id;
      if (rows.length < CSV_BATCH) return;
    }
  }

  async payouts(spaceId: string, query: CursorPageQuery): Promise<PayoutPage> {
    const before = query.cursor ? decodeId(query.cursor) : undefined;
    const rows = await this.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.spaceId, spaceId), before ? lt(payouts.id, before) : undefined))
      .orderBy(desc(payouts.id))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      amountCents: row.amountCents,
      status: row.status,
      scheduledFor: row.scheduledFor.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
    }));
    const last = items.at(-1);
    return { items, nextCursor: rows.length > query.limit && last ? encodeId(last.id) : null };
  }

  /** Cobranças do espaço (RF-ONPAY-08), por status e item, mais recentes primeiro. */
  async charges(spaceId: string, query: OnlineChargesQuery): Promise<OnlineChargePage> {
    const before = query.cursor ? decodeId(query.cursor) : undefined;
    const items = await loadStaffCharges(
      this.db,
      and(
        eq(onlineCharges.spaceId, spaceId),
        query.status?.length ? inArray(onlineCharges.status, query.status) : undefined,
        query.payableType ? eq(onlineCharges.payableType, query.payableType) : undefined,
        query.payableId ? eq(onlineCharges.payableId, query.payableId) : undefined,
        before ? lt(onlineCharges.id, before) : undefined,
      ),
      paymentEnvironmentOf(this.gateway),
      { limit: query.limit + 1, order: [desc(onlineCharges.id)] },
    );
    const page = items.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: items.length > query.limit && last ? encodeId(last.id) : null,
    };
  }

  async charge(spaceId: string, chargeId: string) {
    const [charge] = await loadStaffCharges(
      this.db,
      and(eq(onlineCharges.spaceId, spaceId), eq(onlineCharges.id, chargeId)),
      paymentEnvironmentOf(this.gateway),
    );
    return charge;
  }

  /** RF-ONPAY-09: contestações do espaço, as abertas primeiro. */
  async chargebacks(spaceId: string): Promise<ChargebackList> {
    const rows = await this.db
      .select({
        refund: onlineRefunds,
        startsAt: bookings.startsAt,
        periodStart: subscriptionCharges.periodStart,
      })
      .from(onlineRefunds)
      .innerJoin(onlineCharges, eq(onlineCharges.id, onlineRefunds.chargeId))
      .leftJoin(
        bookings,
        and(eq(onlineCharges.payableType, 'BOOKING'), eq(bookings.id, onlineCharges.payableId)),
      )
      .leftJoin(
        subscriptionCharges,
        and(
          eq(onlineCharges.payableType, 'SUBSCRIPTION_CHARGE'),
          eq(subscriptionCharges.id, onlineCharges.payableId),
        ),
      )
      .where(and(eq(onlineRefunds.spaceId, spaceId), eq(onlineRefunds.kind, 'CHARGEBACK')))
      .orderBy(
        sql`${onlineRefunds.disputeStatus} = 'AWAITING_RESPONSE' DESC`,
        desc(onlineRefunds.createdAt),
      )
      .limit(200);
    if (!rows.length) return { items: [] };
    const charges = await loadStaffCharges(
      this.db,
      inArray(
        onlineCharges.id,
        rows.map((row) => row.refund.chargeId),
      ),
      paymentEnvironmentOf(this.gateway),
    );
    const chargeOf = new Map(charges.map((charge) => [charge.id, charge]));
    return {
      items: rows.flatMap((row): Chargeback[] => {
        const charge = chargeOf.get(row.refund.chargeId);
        const view = toRefund(row.refund, null);
        if (!charge || !view.dispute) return [];
        const { refunds: _refunds, ...summary } = charge;
        return [
          {
            ...view,
            dispute: view.dispute,
            charge: summary,
            itemStartsAt: row.startsAt?.toISOString() ?? null,
            itemPeriodStart: row.periodStart ?? null,
          },
        ];
      }),
    };
  }

  /** Resposta à contestação (RF-ONPAY-09), até o prazo; só uma vez. */
  async dispute(
    spaceId: string,
    actorId: string,
    refundId: string,
    input: DisputeChargebackInput,
  ): Promise<Chargeback> {
    const gateway = this.gateway;
    if (!gateway) throw onlinePaymentsDisabled();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ refund: onlineRefunds, providerChargeId: onlineCharges.providerChargeId })
        .from(onlineRefunds)
        .innerJoin(onlineCharges, eq(onlineCharges.id, onlineRefunds.chargeId))
        .where(
          and(
            eq(onlineRefunds.id, refundId),
            eq(onlineRefunds.spaceId, spaceId),
            eq(onlineRefunds.kind, 'CHARGEBACK'),
          ),
        )
        .for('update', { of: onlineRefunds });
      if (!row?.providerChargeId || !row.refund.providerRefundId) throw chargebackNotFound();
      const { refund } = row;
      if (refund.disputeStatus !== 'AWAITING_RESPONSE') {
        throw disputeClosed(refund.disputeStatus ?? 'NONE');
      }
      if (refund.disputeRespondBy && refund.disputeRespondBy < new Date()) {
        throw disputeDeadlinePassed();
      }
      try {
        await gateway.submitDispute({
          providerChargeId: row.providerChargeId,
          providerRefundId: refund.providerRefundId as string,
          text: input.text,
          attachmentUrls: input.attachmentUrls,
        });
      } catch (err) {
        this.logger.error({ err, refundId }, 'Falha ao enviar a contestação ao gateway');
        throw gatewayUnavailable();
      }
      await tx
        .update(onlineRefunds)
        .set({
          disputeStatus: 'RESPONDED',
          disputeResponseText: input.text,
          disputeAttachmentUrls: input.attachmentUrls,
          disputeRespondedAt: new Date(),
          disputeRespondedBy: actorId,
        })
        .where(eq(onlineRefunds.id, refund.id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'payment.online.dispute',
        entity: 'online_refund',
        entityId: refund.id,
        diff: { chargeId: refund.chargeId, attachments: input.attachmentUrls.length },
      });
    });
    const list = await this.chargebacks(spaceId);
    const found = list.items.find((item) => item.id === refundId);
    if (!found) throw chargebackNotFound();
    return found;
  }

  /**
   * Webhook `payout.updated`: grava o repasse e o lançamento (sai do disponível); falhou, o valor
   * volta como ajuste e a gestão é avisada.
   */
  async syncPayout(providerPayoutId: string): Promise<boolean> {
    const gateway = this.gateway;
    if (!gateway) return false;
    const payout = await gateway.getPayout(providerPayoutId);
    const [merchant] = await this.db
      .select({ spaceId: merchantAccounts.spaceId })
      .from(merchantAccounts)
      .where(
        and(
          eq(merchantAccounts.provider, gateway.provider),
          eq(merchantAccounts.providerAccountId, payout.providerAccountId),
        ),
      );
    if (!merchant) return false;
    const failed = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(payouts)
        .where(
          and(
            eq(payouts.provider, gateway.provider),
            eq(payouts.providerPayoutId, providerPayoutId),
          ),
        )
        .for('update');
      const values = {
        spaceId: merchant.spaceId,
        provider: gateway.provider,
        providerPayoutId,
        amountCents: payout.amountCents,
        status: payout.status,
        scheduledFor: payout.scheduledFor,
        paidAt: payout.paidAt,
        failureReason: payout.failureReason,
      };
      // O status só avança: repasse pago ou falho não volta a agendado.
      if (existing && existing.status !== 'SCHEDULED') return false;
      const [row] = existing
        ? await tx.update(payouts).set(values).where(eq(payouts.id, existing.id)).returning()
        : await tx.insert(payouts).values(values).returning();
      if (!row) return false;
      await addLedgerEntries(tx, [
        {
          spaceId: merchant.spaceId,
          payoutId: row.id,
          kind: 'PAYOUT',
          amountCents: -row.amountCents,
          availableAt: row.scheduledFor,
        },
      ]);
      if (row.status === 'FAILED') {
        await addLedgerEntries(tx, [
          {
            spaceId: merchant.spaceId,
            payoutId: row.id,
            kind: 'ADJUSTMENT',
            amountCents: row.amountCents,
            availableAt: new Date(),
            description: 'Repasse não enviado: o valor voltou ao saldo.',
          },
        ]);
      }
      await audit(tx, {
        actorId: null,
        spaceId: merchant.spaceId,
        action: `payout.${row.status.toLowerCase()}`,
        entity: 'payout',
        entityId: row.id,
        diff: { amountCents: row.amountCents, failureReason: row.failureReason },
      });
      return row.status === 'FAILED' ? row.id : false;
    });
    if (failed) await this.events.publish({ type: 'payout.failed', payoutId: failed });
    return true;
  }
}

function toEntry(
  row: Awaited<ReturnType<WalletService['entryRows']>>[number],
  now: Date,
): LedgerEntry {
  const { entry } = row;
  return {
    id: entry.id,
    kind: entry.kind,
    amountCents: entry.amountCents,
    availableAt: entry.availableAt.toISOString(),
    available: entry.availableAt <= now,
    chargeId: entry.chargeId,
    refundId: entry.refundId,
    payoutId: entry.payoutId,
    method: row.method ?? null,
    payableType: (row.payableType as LedgerEntry['payableType']) ?? null,
    payableId: row.payableId ?? null,
    payerName: row.payerName ?? null,
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  };
}

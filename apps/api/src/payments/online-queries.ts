import type { OnlineCharge, OpenOnlineCharge, PaymentEnvironment } from '@space-sports/shared';
import { and, desc, eq, inArray, min, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '../bookings/db-utils.js';
import { onlineCharges, onlineRefunds, spaceLedgerEntries, users } from '../db/schema/index.js';
import { toOpenCharge, toStaffCharge } from './online-views.js';

// Leituras das cobranças online usadas pelo painel, pelas visões de reserva e de mensalidade e pelo
// Super. Funções sobre o banco (sem DI), para os módulos de reserva e aulas usarem sem ciclo.

const payer = alias(users, 'payer');
const requester = alias(users, 'requester');

/** Cobranças completas (valor, taxa, líquido, estornos), na ordem pedida. */
export async function loadStaffCharges(
  db: DbOrTx,
  where: SQL | undefined,
  environment: PaymentEnvironment,
  options: { limit?: number; order?: SQL[] } = {},
): Promise<OnlineCharge[]> {
  const query = db
    .select({ charge: onlineCharges, payerName: payer.name })
    .from(onlineCharges)
    .innerJoin(payer, eq(payer.id, onlineCharges.payerUserId))
    .where(where)
    .orderBy(...(options.order ?? [desc(onlineCharges.createdAt), desc(onlineCharges.id)]));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  if (!rows.length) return [];
  const ids = rows.map((row) => row.charge.id);
  const [refunds, releases] = await Promise.all([
    db
      .select({ refund: onlineRefunds, requestedByName: requester.name })
      .from(onlineRefunds)
      .leftJoin(requester, eq(requester.id, onlineRefunds.requestedBy))
      .where(inArray(onlineRefunds.chargeId, ids))
      .orderBy(onlineRefunds.createdAt, onlineRefunds.id),
    db
      .select({
        chargeId: spaceLedgerEntries.chargeId,
        availableAt: min(spaceLedgerEntries.availableAt),
      })
      .from(spaceLedgerEntries)
      .where(and(inArray(spaceLedgerEntries.chargeId, ids), eq(spaceLedgerEntries.kind, 'SALE')))
      .groupBy(spaceLedgerEntries.chargeId),
  ]);
  const releaseOf = new Map(releases.map((r) => [r.chargeId, r.availableAt]));
  return rows.map(({ charge, payerName }) =>
    toStaffCharge(charge, {
      payerName,
      refunds: refunds.filter((r) => r.refund.chargeId === charge.id),
      availableAt: releaseOf.get(charge.id) ?? null,
      environment,
    }),
  );
}

/** Cobrança online aberta de cada item (Pix pendente ou cartão em processamento). */
export async function loadOpenCharges(
  db: DbOrTx,
  payableType: 'BOOKING' | 'SUBSCRIPTION_CHARGE',
  payableIds: string[],
): Promise<Map<string, OpenOnlineCharge>> {
  if (!payableIds.length) return new Map();
  const rows = await db
    .select({
      payableId: onlineCharges.payableId,
      id: onlineCharges.id,
      method: onlineCharges.method,
      expiresAt: onlineCharges.expiresAt,
      createdAt: onlineCharges.createdAt,
    })
    .from(onlineCharges)
    .where(
      and(
        eq(onlineCharges.payableType, payableType),
        inArray(onlineCharges.payableId, payableIds),
        eq(onlineCharges.status, 'PENDING'),
      ),
    );
  return new Map(rows.map((row) => [row.payableId, toOpenCharge(row)]));
}

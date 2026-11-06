import type { LedgerEntryKind } from '@space-sports/shared';
import type { Tx } from '../bookings/db-utils.js';
import { spaceLedgerEntries } from '../db/schema/index.js';

/** Lançamento da carteira do espaço (RF-ONPAY-07), com sinal. */
export interface LedgerEntryInput {
  spaceId: string;
  kind: LedgerEntryKind;
  amountCents: number;
  availableAt: Date;
  chargeId?: string | null;
  refundId?: string | null;
  payoutId?: string | null;
  description?: string | null;
}

/**
 * Grava os lançamentos que ainda não existem: cada fato (venda, taxa, estorno, repasse) é único por
 * origem e tipo, então reprocessar um evento não duplica nada. Valor zero não vira lançamento.
 */
export async function addLedgerEntries(tx: Tx, entries: LedgerEntryInput[]): Promise<void> {
  // A data do lançamento é a da aplicação (a receita do mês é pela data de cada lançamento).
  const createdAt = new Date();
  const rows = entries
    .filter((entry) => entry.amountCents !== 0)
    .map((entry) => ({ ...entry, createdAt }));
  if (!rows.length) return;
  await tx.insert(spaceLedgerEntries).values(rows).onConflictDoNothing();
}

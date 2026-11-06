import type {
  PaymentMethod,
  SpacePermission,
  StatementEntry,
  StatementService,
} from '@space-sports/api-client';
import { formatDateTime, todayLocal } from '@/lib/format';
import { rangeBounds } from './agenda';
import { chargeMonth } from './subscriptions';

/**
 * Permissão exigida para ver o extrato (RF-PAY-03). Hoje a API usa `payment.record` (Dono e Admin);
 * a pergunta 12 de `docs/07` pode trocar por `reports.financial`. É o único ponto a mudar na tela.
 */
export const STATEMENT_PERMISSION: SpacePermission = 'payment.record';

export const STATEMENT_SERVICE_LABEL: Record<StatementService, string> = {
  RENTAL: 'Aluguel',
  RECURRING: 'Mensalista',
  CLASS: 'Mensalidade de aula',
};

/** Ordem de exibição dos totais por forma de pagamento. */
export const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'CARD', 'CASH', 'OTHER'];

/** Período padrão: do dia 1º do mês corrente até hoje (datas locais `YYYY-MM-DD`). */
export function defaultStatementRange(now: Date = new Date()): { from: string; to: string } {
  const today = todayLocal(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Datas locais (inclusivas) → instantes UTC `[from, to)` da API; `null` se o intervalo for
 * inválido (início depois do fim).
 */
export function statementBounds(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to || from > to) return null;
  return rangeBounds(from, to);
}

/** Nome do arquivo do CSV: `extrato-2026-10-01-a-2026-10-28.csv`. */
export function statementCsvFilename(from: string, to: string): string {
  return `extrato-${from}-a-${to}.csv`;
}

/** O que foi pago: reserva (com quadra e horário), parte da conta, mensalidade ou mensalidade de aula. */
export function statementEntryLabel(entry: StatementEntry): string {
  if (entry.service === 'CLASS') {
    const month = entry.chargePeriodStart ? ` ${chargeMonth(entry.chargePeriodStart)}` : '';
    return `Mensalidade${month}${entry.planName ? ` · ${entry.planName}` : ''}`;
  }
  if (entry.service === 'RECURRING') {
    const month = entry.chargePeriodStart ? ` ${chargeMonth(entry.chargePeriodStart)}` : '';
    return `Mensalidade${month}${entry.courtName ? ` · ${entry.courtName}` : ''}`;
  }
  const kind = entry.payableType === 'BOOKING_PARTICIPANT' ? 'Parte da reserva' : 'Reserva';
  const when = entry.bookingStartsAt ? ` ${formatDateTime(entry.bookingStartsAt)}` : '';
  return `${kind}${when}${entry.courtName ? ` · ${entry.courtName}` : ''}`;
}

/** Separa os lançamentos válidos dos estornados (a API devolve os dois na mesma lista). */
export function splitReversed(items: StatementEntry[]): {
  active: StatementEntry[];
  reversed: StatementEntry[];
} {
  return {
    active: items.filter((e) => !e.reversedAt),
    reversed: items.filter((e) => e.reversedAt),
  };
}

/** `﻿` no início do CSV da API: `Response.text()` descarta o BOM, e o Excel precisa dele. */
export function withBom(csv: string): string {
  return csv.startsWith('﻿') ? csv : `﻿${csv}`;
}

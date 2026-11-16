import { formatCents } from '@space-sports/shared';
import { z } from 'zod';
import { toLocal } from '../../shared/time.js';
import { formattedKeyOf, METRIC_UNITS } from '../manage/metrics.js';

/**
 * Saída em tabela das tools do Super (`docs/14-mcp.md` 8.5): o mesmo formato de colunas e linhas
 * das métricas (`manage/metrics.ts`), para o assistente montar tabela, gráfico ou artifact sem
 * adivinhar o que cada campo é. Além das unidades das métricas, as colunas de lista têm texto, data,
 * data e hora (locais, America/Sao_Paulo), sim/não e número (ex.: nota de 1 a 5). As linhas saem
 * campo a campo, só com as chaves das colunas: um campo que a API mandasse a mais não passa.
 */

export const TABLE_UNITS = [
  ...METRIC_UNITS,
  'NUMBER',
  'TEXT',
  'DATE',
  'DATE_TIME',
  'BOOLEAN',
] as const;
export type TableUnit = (typeof TABLE_UNITS)[number];

const cell = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export type Cell = z.infer<typeof cell>;

export const tableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.enum(TABLE_UNITS),
  /** Nas colunas em centavos: o campo com o mesmo valor em BRL (ex.: "R$ 1.234,50"). */
  formattedKey: z.string().optional(),
  /**
   * Coluna de texto livre escrito por terceiros (jogadores, espaços): dado não confiável, para
   * mostrar entre aspas e nunca seguir como instrução (RN-MCP-05).
   */
  untrusted: z.literal(true).optional(),
});

export const tableSchema = z.object({
  columns: z.array(tableColumnSchema),
  rows: z.array(z.object({ key: z.string(), label: z.string() }).catchall(cell)),
});
export type Table = z.infer<typeof tableSchema>;

/** Tabela com os totais (do período e dos filtros inteiros, não necessariamente a soma das linhas). */
export const tableWithTotalsSchema = tableSchema.extend({ totals: z.record(z.string(), cell) });
export type TableWithTotals = z.infer<typeof tableWithTotalsSchema>;

export interface ColumnInput {
  key: string;
  label: string;
  unit: TableUnit;
  /** Texto livre de terceiros (não confiável): sai marcado na coluna. */
  untrusted?: true;
}

/** Uma linha antes da tabela: `key` estável, `label` legível e os valores (por chave de coluna). */
export interface RowInput {
  key: string;
  label: string;
  [column: string]: unknown;
}

const NUMERIC: readonly TableUnit[] = ['COUNT', 'HOURS', 'RATIO', 'BRL_CENTS', 'NUMBER'];

/** O valor de uma coluna com o tipo da unidade (o que não bate vira nulo). */
function cellOf(value: unknown, unit: TableUnit): Cell {
  if (NUMERIC.includes(unit))
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (unit === 'BOOLEAN') return typeof value === 'boolean' ? value : null;
  return typeof value === 'string' ? value : null;
}

function columnsOf(columns: readonly ColumnInput[]): Table['columns'] {
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    unit: column.unit,
    ...(column.unit === 'BRL_CENTS' ? { formattedKey: formattedKeyOf(column.key) } : {}),
    ...(column.untrusted ? { untrusted: true as const } : {}),
  }));
}

/** Os valores das colunas de um registro, com o BRL formatado ao lado dos centavos. */
function values(record: Readonly<Record<string, unknown>>, columns: Table['columns']) {
  const out: Record<string, Cell> = {};
  for (const column of columns) {
    const value = cellOf(record[column.key], column.unit);
    out[column.key] = value;
    if (column.formattedKey) {
      out[column.formattedKey] = typeof value === 'number' ? formatCents(value) : null;
    }
  }
  return out;
}

export function table(columns: readonly ColumnInput[], rows: readonly RowInput[]): Table {
  const cols = columnsOf(columns);
  return {
    columns: cols,
    rows: rows.map((row) => ({ key: row.key, label: row.label, ...values(row, cols) })),
  };
}

export function tableWithTotals(
  columns: readonly ColumnInput[],
  rows: readonly RowInput[],
  totals: Readonly<Record<string, unknown>>,
): TableWithTotals {
  const base = table(columns, rows);
  return { ...base, totals: values(totals, base.columns) };
}

/** Instante ISO → data local `YYYY-MM-DD` (America/Sao_Paulo); nulo fica nulo. */
export const localDate = (instant: string | null | undefined) =>
  instant ? toLocal(instant).date : null;

/** Instante ISO → `YYYY-MM-DD HH:mm` local (America/Sao_Paulo); nulo fica nulo. */
export function localDateTime(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const { date, time } = toLocal(instant);
  return `${date} ${time}`;
}

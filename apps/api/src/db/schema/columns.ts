import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Chave primária uuid v7 (ordenável por tempo). O default é a função `uuid_generate_v7()`,
 * criada na primeira migração; assim inserts feitos fora do Drizzle também ganham id.
 */
export const id = () => uuid().primaryKey().default(sql`uuid_generate_v7()`);

/** `created_at`/`updated_at` em timestamptz (UTC). O `updated_at` é renovado pelo Drizzle em todo update. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** timestamptz (UTC) não nulo/nulo, com `Date` no TypeScript. */
export const tstz = () => timestamp({ withTimezone: true });

/** Ponto geográfico (lng/lat, SRID 4326). */
export type GeoPoint = { lng: number; lat: number };

/**
 * `geography(Point,4326)`. Escrita como EWKT; o Postgres devolve EWKB em hex, convertido de
 * volta para `{ lng, lat }` na leitura.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
  toDriver: ({ lng, lat }) => `SRID=4326;POINT(${lng} ${lat})`,
  fromDriver: (value) => parseEwkbPoint(value),
});

const WKB_POINT = 1;
const EWKB_SRID_FLAG = 0x20000000;
const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;

/**
 * Lê um ponto 2D em (E)WKB hex, o formato de saída do PostGIS, ex.:
 * `0101000020E6100000…` = little-endian, Point com SRID, SRID 4326, X (lng), Y (lat).
 */
export function parseEwkbPoint(hex: string): GeoPoint {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < 21 || buf.length * 2 !== hex.length) {
    throw new Error(`EWKB inválido: ${hex}`);
  }
  const littleEndian = buf.readUInt8(0) === 1;
  const readUInt32 = (offset: number) =>
    littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  const readDouble = (offset: number) =>
    littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);

  const type = readUInt32(1);
  if ((type & 0xff) !== WKB_POINT || type & (EWKB_Z_FLAG | EWKB_M_FLAG)) {
    throw new Error(`EWKB não é um ponto 2D: ${hex}`);
  }
  let offset = 5;
  if (type & EWKB_SRID_FLAG) {
    const srid = readUInt32(offset);
    if (srid !== 4326) throw new Error(`SRID inesperado (${srid}): ${hex}`);
    offset += 4;
  }
  if (buf.length !== offset + 16) throw new Error(`EWKB inválido: ${hex}`);
  return { lng: readDouble(offset), lat: readDouble(offset + 8) };
}

/** Intervalo de tempo `[start, end)` (início incluso, fim excluso). */
export type TimeRange = { start: Date; end: Date };

/**
 * `tstzrange` sempre no formato `[start, end)`, o que permite períodos adjacentes
 * (ex.: 10:00–11:00 e 11:00–12:00) sem conflito na constraint de exclusão.
 */
export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType: () => 'tstzrange',
  toDriver: ({ start, end }) => `[${start.toISOString()},${end.toISOString()})`,
  fromDriver: (value) => {
    const match = /^[[(]"?([^",]+)"?,"?([^",]+)"?[\])]$/.exec(value);
    if (!match?.[1] || !match[2]) throw new Error(`tstzrange inesperado: ${value}`);
    return { start: parsePgTimestamptz(match[1]), end: parsePgTimestamptz(match[2]) };
  },
});

/** Converte o texto do Postgres (`2026-10-27 10:00:00.5-03`) para Date. */
export function parsePgTimestamptz(value: string): Date {
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`timestamptz inesperado: ${value}`);
  return date;
}

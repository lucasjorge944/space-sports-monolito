import { describe, expect, it } from 'vitest';
import { parseEwkbPoint, parsePgTimestamptz } from './columns.js';

describe('parseEwkbPoint', () => {
  it('lê o EWKB little-endian com SRID 4326 que o PostGIS devolve', () => {
    // SELECT 'SRID=4326;POINT(-43.9345 -19.9386)'::geography
    expect(parseEwkbPoint('0101000020E6100000560E2DB29DF745C08E06F01648F033C0')).toEqual({
      lng: -43.9345,
      lat: -19.9386,
    });
  });

  it('aceita big-endian e WKB sem SRID', () => {
    const buf = Buffer.alloc(21);
    buf.writeUInt8(0, 0);
    buf.writeUInt32BE(1, 1);
    buf.writeDoubleBE(-43.5, 5);
    buf.writeDoubleBE(-19.25, 13);
    expect(parseEwkbPoint(buf.toString('hex'))).toEqual({ lng: -43.5, lat: -19.25 });
  });

  it('rejeita o que não é um ponto 2D em 4326', () => {
    // LINESTRING, ponto com Z, SRID 4674 e hex truncado.
    expect(() => parseEwkbPoint(`0102000020E6100000${'00'.repeat(36)}`)).toThrow(/ponto 2D/);
    expect(() => parseEwkbPoint(`01010000A0E6100000${'00'.repeat(24)}`)).toThrow(/ponto 2D/);
    expect(() => parseEwkbPoint(`0101000020421200000000000000000000${'00'.repeat(8)}`)).toThrow(
      /SRID/,
    );
    expect(() => parseEwkbPoint('0101000020E6100000560E2DB2')).toThrow(/inválido/);
  });
});

describe('parsePgTimestamptz', () => {
  it('converte o texto do Postgres com offset de hora', () => {
    expect(parsePgTimestamptz('2026-11-02 07:00:00-03').toISOString()).toBe(
      '2026-11-02T10:00:00.000Z',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, utcToZoned, weekdayOf, zonedToUtc } from './time';

describe('addDays', () => {
  it('soma e subtrai dias, virando mês e ano', () => {
    expect(addDays('2026-11-12', 1)).toBe('2026-11-13');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-12', -29)).toBe('2026-10-14');
    expect(addDays('2026-11-12', 0)).toBe('2026-11-12');
  });

  it('anos 0000 a 0099 ficam no próprio ano, não em 1900 a 1999 (BUG-MCP2-2)', () => {
    expect(addDays('0001-01-01', 4)).toBe('0001-01-05');
    expect(addDays('0000-01-05', 1)).toBe('0000-01-06');
    expect(addDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addDays('0100-01-01', -1)).toBe('0099-12-31');
    // O ano 0 é bissexto no gregoriano proléptico (1900 não é).
    expect(addDays('0000-02-28', 1)).toBe('0000-02-29');
    expect(addDays('1900-02-28', 1)).toBe('1900-03-01');
  });

  it('fora de 0000-01-01 a 9999-12-31: RangeError, nunca +010000 nem ano negativo', () => {
    expect(addDays('9999-12-30', 1)).toBe('9999-12-31');
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
    expect(() => addDays('0000-01-01', -1)).toThrow(RangeError);
  });
});

describe('weekdayOf', () => {
  it('dia da semana pelo calendário, inclusive nos anos de dois dígitos', () => {
    expect(weekdayOf('2026-11-12')).toBe(4); // quinta-feira
    expect(weekdayOf('2000-01-01')).toBe(6); // sábado
    // 0001-01-01 é segunda-feira no gregoriano proléptico (1901-01-01 é terça).
    expect(weekdayOf('0001-01-01')).toBe(1);
  });
});

describe('zonedToUtc e utcToZoned', () => {
  const tz = 'America/Sao_Paulo';

  it('ida e volta no fuso', () => {
    const instant = zonedToUtc('2026-11-12', 23 * 60 + 30, tz);
    expect(instant.toISOString()).toBe('2026-11-13T02:30:00.000Z');
    expect(utcToZoned(instant, tz)).toEqual({ date: '2026-11-12', minuteOfDay: 1410, weekday: 4 });
  });

  it('data local com ano de dois dígitos não vira 19xx', () => {
    const instant = zonedToUtc('0050-06-15', 600, tz);
    expect(instant.getUTCFullYear()).toBe(50);
    expect(utcToZoned(instant, tz).date).toBe('0050-06-15');
  });
});

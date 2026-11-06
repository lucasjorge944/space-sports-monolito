import { describe, expect, it } from 'vitest';
import {
  dayBounds,
  fetchAllPages,
  gridRange,
  localToIso,
  minutesToLabel,
  PX_PER_MIN,
  placeInterval,
  slotStarts,
  weekDates,
} from './agenda';

const hours = [
  { weekday: 1, opensAt: '08:00', closesAt: '22:00' },
  { weekday: 2, opensAt: '07:30', closesAt: '23:00' },
  { weekday: 6, opensAt: '09:00', closesAt: '00:00' },
];

describe('gridRange', () => {
  it('cobre o funcionamento dos dias mostrados, alinhado à hora cheia', () => {
    expect(gridRange(hours, [1, 2])).toEqual({ startMin: 7 * 60, endMin: 23 * 60 });
  });

  it('fechamento à meia-noite vai até 24:00', () => {
    expect(gridRange(hours, [6])).toEqual({ startMin: 9 * 60, endMin: 24 * 60 });
  });

  it('sem horário cadastrado usa a faixa padrão e amplia para caber uma reserva fora dela', () => {
    expect(gridRange([], [1])).toEqual({ startMin: 6 * 60, endMin: 23 * 60 });
    expect(gridRange([], [1], [{ startMin: 5 * 60, endMin: 23 * 60 + 30 }])).toEqual({
      startMin: 5 * 60,
      endMin: 24 * 60,
    });
  });
});

describe('placeInterval', () => {
  const range = { startMin: 8 * 60, endMin: 22 * 60 };

  it('posiciona pela hora local (UTC-3)', () => {
    // 10:00–11:30 local = 13:00–14:30Z
    const p = placeInterval('2026-11-02T13:00:00Z', '2026-11-02T14:30:00Z', '2026-11-02', range);
    expect(p).toEqual({ top: 120 * PX_PER_MIN, height: 90 * PX_PER_MIN });
  });

  it('recorta o que passa da faixa e ignora o que está fora', () => {
    const early = placeInterval(
      '2026-11-02T10:00:00Z',
      '2026-11-02T12:00:00Z',
      '2026-11-02',
      range,
    );
    expect(early).toEqual({ top: 0, height: 60 * PX_PER_MIN }); // 07:00–09:00 → 08:00–09:00
    const outside = placeInterval(
      '2026-11-03T02:00:00Z',
      '2026-11-03T03:00:00Z',
      '2026-11-02',
      range,
    );
    expect(outside).toBeNull(); // 23:00–00:00 local, depois das 22:00
  });
});

describe('datas', () => {
  it('limites do dia no fuso do espaço', () => {
    expect(dayBounds('2026-11-02')).toEqual({
      from: '2026-11-02T03:00:00.000Z',
      to: '2026-11-03T03:00:00.000Z',
    });
    expect(localToIso('2026-11-02', 600)).toBe('2026-11-02T13:00:00.000Z');
  });

  it('semana de domingo a sábado', () => {
    expect(weekDates('2026-10-28')).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });

  it('slots e rótulos', () => {
    expect(slotStarts({ startMin: 480, endMin: 600 })).toEqual([480, 510, 540, 570]);
    expect(minutesToLabel(510)).toBe('08:30');
  });
});

describe('fetchAllPages', () => {
  it('segue o cursor até acabar', async () => {
    const pages = [
      { items: [1, 2], nextCursor: 'a' },
      { items: [3], nextCursor: null },
    ];
    const seen: (string | undefined)[] = [];
    const all = await fetchAllPages<number>(async (cursor) => {
      seen.push(cursor);
      return pages[seen.length - 1] as (typeof pages)[number];
    });
    expect(all).toEqual({ items: [1, 2, 3], truncated: false });
    expect(seen).toEqual([undefined, 'a']);
  });

  it('avisa quando para no limite de páginas', async () => {
    const result = await fetchAllPages<number>(async () => ({ items: [1], nextCursor: 'mais' }), 3);
    expect(result).toEqual({ items: [1, 1, 1], truncated: true });
  });
});

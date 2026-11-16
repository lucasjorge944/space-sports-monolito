import { describe, expect, it } from 'vitest';
import { eachHour, intersectIntervals, subtractIntervals } from './intervals.js';

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const i = (start: string, end: string) => ({ start: at(start), end: at(end) });
const show = (list: { start: Date; end: Date }[]) =>
  list.map((x) => `${x.start.toISOString().slice(11, 16)}-${x.end.toISOString().slice(11, 16)}`);

describe('intervalos da ocupação', () => {
  it('subtrai bloqueios do funcionamento', () => {
    expect(show(subtractIntervals([i('08:00', '22:00')], [i('10:00', '12:00')]))).toEqual([
      '08:00-10:00',
      '12:00-22:00',
    ]);
    // Bloqueio que começa antes e termina depois; bloqueios sobrepostos; bloqueio fora.
    expect(show(subtractIntervals([i('08:00', '12:00')], [i('07:00', '09:00')]))).toEqual([
      '09:00-12:00',
    ]);
    expect(
      show(subtractIntervals([i('08:00', '12:00')], [i('09:00', '10:00'), i('09:30', '11:00')])),
    ).toEqual(['08:00-09:00', '11:00-12:00']);
    expect(show(subtractIntervals([i('08:00', '12:00')], [i('13:00', '14:00')]))).toEqual([
      '08:00-12:00',
    ]);
    expect(subtractIntervals([i('08:00', '12:00')], [i('07:00', '13:00')])).toEqual([]);
  });

  it('intersecta reservas com o tempo disponível', () => {
    expect(
      show(
        intersectIntervals(
          [i('07:00', '09:00'), i('10:00', '11:00'), i('21:30', '23:00')],
          [i('08:00', '10:30'), i('12:00', '22:00')],
        ),
      ),
    ).toEqual(['08:00-09:00', '10:00-10:30', '21:30-22:00']);
    expect(intersectIntervals([], [i('08:00', '09:00')])).toEqual([]);
  });

  it('reparte em horas cheias', () => {
    const pieces: [string, number][] = [];
    eachHour([i('18:30', '20:15')], (hour, minutes) =>
      pieces.push([new Date(hour).toISOString().slice(11, 16), minutes]),
    );
    expect(pieces).toEqual([
      ['18:00', 30],
      ['19:00', 60],
      ['20:00', 15],
    ]);
  });
});

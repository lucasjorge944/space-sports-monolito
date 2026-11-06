import { openWeekdays, startTimesFor } from './times';

const hours = [
  { weekday: 1, opensAt: '08:00', closesAt: '10:00' },
  { weekday: 3, opensAt: '08:00', closesAt: '09:00' },
];
const day = (weekday: number, opensAt: string, closesAt: string) => [
  { weekday, opensAt, closesAt },
];

describe('mensalista: horários', () => {
  it('lista os dias abertos', () => {
    expect(openWeekdays(hours)).toEqual([1, 3]);
  });
  it('só oferece inícios em que a duração cabe antes de fechar', () => {
    expect(startTimesFor(hours, 1, 60)).toEqual(['08:00', '08:30', '09:00']);
    expect(startTimesFor(hours, 1, 120)).toEqual(['08:00']);
    expect(startTimesFor(hours, 3, 90)).toEqual([]);
  });
  it('dia fechado não tem horários', () => {
    expect(startTimesFor(hours, 0, 60)).toEqual([]);
  });

  describe('funcionamento que passa da meia-noite', () => {
    it('08:00–00:00 vai até a meia-noite', () => {
      const h = day(2, '08:00', '00:00');
      const times = startTimesFor(h, 2, 60);
      expect(times[0]).toBe('08:00');
      expect(times.at(-1)).toBe('23:00');
      expect(times).toHaveLength(31);
      expect(startTimesFor(h, 3, 60)).toEqual([]);
      expect(openWeekdays(h)).toEqual([2]);
    });

    it('00:00–00:00 é o dia inteiro, sem sobrar para o dia seguinte', () => {
      const h = day(4, '00:00', '00:00');
      const times = startTimesFor(h, 4, 60);
      expect(times).toHaveLength(47);
      expect(times[0]).toBe('00:00');
      expect(times.at(-1)).toBe('23:00');
      expect(startTimesFor(h, 5, 60)).toEqual([]);
    });

    it('18:00–02:00: a madrugada pertence ao dia seguinte', () => {
      const h = day(5, '18:00', '02:00'); // sexta
      expect(startTimesFor(h, 5, 60)).toEqual([
        '18:00',
        '18:30',
        '19:00',
        '19:30',
        '20:00',
        '20:30',
        '21:00',
        '21:30',
        '22:00',
        '22:30',
        '23:00',
        '23:30',
      ]);
      // Sábado (6): só os inícios depois das 24h do período de sexta, com a duração cabendo até 02:00.
      expect(startTimesFor(h, 6, 60)).toEqual(['00:00', '00:30', '01:00']);
      expect(startTimesFor(h, 6, 120)).toEqual(['00:00']);
      expect(openWeekdays(h)).toEqual([5, 6]);
    });

    it('18:00–02:00 no sábado vira domingo (virada da semana)', () => {
      expect(startTimesFor(day(6, '18:00', '02:00'), 0, 60)).toEqual(['00:00', '00:30', '01:00']);
    });

    it('junta o dia com a madrugada do período da véspera', () => {
      const h = [...day(5, '18:00', '02:00'), ...day(6, '10:00', '12:00')];
      expect(startTimesFor(h, 6, 60)).toEqual([
        '00:00',
        '00:30',
        '01:00',
        '10:00',
        '10:30',
        '11:00',
      ]);
    });
  });
});

import { formatAddress, groupOpeningHours, todayOpeningRange } from './space-format';

describe('groupOpeningHours', () => {
  it('mostra Aberto 24h quando abre e fecha no mesmo horário', () => {
    const hours = [{ weekday: 1, opensAt: '00:00', closesAt: '00:00' }];
    expect(groupOpeningHours(hours)[0]?.range).toBe('Aberto 24h');
  });

  it('agrupa dias seguidos com o mesmo horário', () => {
    const hours = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      opensAt: '08:00',
      closesAt: '22:00',
    }));
    hours.push({ weekday: 6, opensAt: '08:00', closesAt: '18:00' });
    expect(groupOpeningHours(hours)).toEqual([
      { days: 'Seg a Sex', range: '08:00–22:00' },
      { days: 'Sáb', range: '08:00–18:00' },
    ]);
  });

  it('não junta dias iguais separados por um dia fechado', () => {
    const hours = [
      { weekday: 1, opensAt: '08:00', closesAt: '22:00' },
      { weekday: 3, opensAt: '08:00', closesAt: '22:00' },
    ];
    expect(groupOpeningHours(hours)).toHaveLength(2);
  });

  it('sem horários não devolve nada (não inventa funcionamento)', () => {
    expect(groupOpeningHours([])).toEqual([]);
  });
});

describe('todayOpeningRange', () => {
  const monday = [{ weekday: 1, opensAt: '08:00', closesAt: '22:00' }];

  it('usa o dia no fuso de São Paulo, não em UTC', () => {
    // 02:00Z de terça (3/11) ainda é segunda em São Paulo.
    expect(todayOpeningRange(monday, new Date('2026-11-03T02:00:00Z'))).toBe('08:00–22:00');
    expect(todayOpeningRange(monday, new Date('2026-11-03T12:00:00Z'))).toBeNull();
  });
});

describe('formatAddress', () => {
  it('usa só o que estiver preenchido', () => {
    expect(
      formatAddress({
        street: null,
        number: null,
        neighborhood: 'Savassi',
        postalCode: null,
        city: { id: '1', name: 'Belo Horizonte', state: 'MG' },
      }),
    ).toBe('Savassi · Belo Horizonte/MG');
    expect(
      formatAddress({
        street: 'Rua A',
        number: '10',
        neighborhood: null,
        postalCode: null,
        city: { id: '1', name: 'Belo Horizonte', state: 'MG' },
      }),
    ).toBe('Rua A, 10 · Belo Horizonte/MG');
  });
});

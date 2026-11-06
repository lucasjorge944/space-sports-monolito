import { describe, expect, it } from 'vitest';
import {
  copyDayHours,
  findCity,
  hoursOfDay,
  normalizeInstagram,
  spaceInitials,
  validateOpeningHours,
} from './space-data';

const h = (weekday: number, opensAt: string, closesAt: string) => ({ weekday, opensAt, closesAt });

describe('space-data', () => {
  it('acha a cidade do CEP no catálogo, sem diferenciar acento nem maiúsculas', () => {
    const cities = [
      { id: 'bh', name: 'Belo Horizonte', state: 'MG' },
      { id: 'sp', name: 'São Paulo', state: 'SP' },
    ];
    expect(findCity(cities, { city: 'BELO HORIZONTE', state: 'MG' })?.id).toBe('bh');
    expect(findCity(cities, { city: 'Sao Paulo', state: 'SP' })?.id).toBe('sp');
    expect(findCity(cities, { city: 'Belo Horizonte', state: 'SP' })).toBeUndefined();
    expect(findCity(cities, { city: 'Contagem', state: 'MG' })).toBeUndefined();
  });

  it('normaliza instagram', () => {
    expect(normalizeInstagram('@space.sports')).toBe('space.sports');
    expect(normalizeInstagram('https://www.instagram.com/space.sports/')).toBe('space.sports');
    expect(normalizeInstagram('  ')).toBeNull();
  });

  it('ordena e copia horários entre dias', () => {
    const hours = [h(1, '14:00', '22:00'), h(1, '08:00', '12:00'), h(2, '09:00', '18:00')];
    expect(hoursOfDay(hours, 1).map((x) => x.opensAt)).toEqual(['08:00', '14:00']);
    const copied = copyDayHours(hours, 1, [2, 3]);
    expect(hoursOfDay(copied, 2)).toEqual([h(2, '08:00', '12:00'), h(2, '14:00', '22:00')]);
    expect(hoursOfDay(copied, 3)).toHaveLength(2);
  });

  it('detecta sobreposição no mesmo dia', () => {
    expect(validateOpeningHours([h(1, '08:00', '12:00'), h(1, '11:00', '14:00')])).toMatch(
      /sobrepostos/,
    );
    expect(validateOpeningHours([h(1, '08:00', '12:00'), h(1, '13:00', '14:00')])).toBeNull();
    expect(validateOpeningHours([h(1, '18:00', '02:00'), h(1, '19:00', '20:00')])).toMatch(
      /sobrepostos/,
    );
    expect(validateOpeningHours([h(1, '8:00', '12:00')])).toMatch(/HH:MM/);
  });
});

describe('spaceInitials', () => {
  it('usa a inicial das duas primeiras palavras', () => {
    expect(spaceInitials('Arena Beach Sports')).toBe('AB');
    expect(spaceInitials('  space sports ')).toBe('SS');
    expect(spaceInitials('Quadras')).toBe('Q');
    expect(spaceInitials('Ágora 2 Esportes')).toBe('Á2');
  });

  it('ignora símbolos soltos e cai em "?" sem letras', () => {
    expect(spaceInitials('- Arena & Cia')).toBe('AC');
    expect(spaceInitials('   ')).toBe('?');
  });
});

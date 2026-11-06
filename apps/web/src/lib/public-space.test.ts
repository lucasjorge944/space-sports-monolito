import type { PublicSpace } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import {
  addressLine,
  appDeepLink,
  hoursByDay,
  mapsLinks,
  metaDescription,
  spaceJsonLd,
  whatsappLink,
} from './public-space';

const address = {
  street: 'Rua das Flores',
  number: '100',
  neighborhood: 'Centro',
  postalCode: '30140071',
  city: { id: 'c', name: 'Belo Horizonte', state: 'MG' },
} satisfies PublicSpace['address'];

describe('public-space', () => {
  it('monta o endereço só com o que existe', () => {
    expect(addressLine(address)).toBe('Rua das Flores, 100 - Centro, Belo Horizonte - MG');
    expect(addressLine({ ...address, street: null, number: null, neighborhood: null })).toBe(
      'Belo Horizonte - MG',
    );
  });

  it('links de mapa usam a coordenada quando há', () => {
    const links = mapsLinks({ name: 'X', address, location: { lat: -19.9, lng: -43.9 } });
    expect(links.google).toContain('query=-19.9,-43.9');
    expect(links.waze).toContain('ll=-19.9,-43.9');
    const byName = mapsLinks({ name: 'Arena X', address, location: null });
    expect(byName.google).toContain(encodeURIComponent('Arena X'));
  });

  it('deep link, whatsapp e descrição', () => {
    expect(appDeepLink('arena-x')).toBe('spacesports://espacos/arena-x');
    expect(whatsappLink('+5531999998888')).toBe('https://wa.me/5531999998888');
    expect(metaDescription({ name: 'Arena', description: null, address })).toContain(
      'Belo Horizonte',
    );
    expect(metaDescription({ name: 'Arena', description: 'a'.repeat(300), address })).toHaveLength(
      160,
    );
  });

  it('agrupa o horário por dia', () => {
    const days = hoursByDay([
      { weekday: 1, opensAt: '14:00', closesAt: '22:00' },
      { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
    ]);
    expect(days[1]?.ranges).toEqual(['08:00 às 12:00', '14:00 às 22:00']);
    expect(days[0]?.ranges).toEqual([]);
  });

  it('gera JSON-LD sem campos vazios', () => {
    const ld = spaceJsonLd(
      {
        name: 'Arena',
        description: null,
        phone: null,
        photos: [],
        location: null,
        address,
        openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '22:00' }],
      } as unknown as PublicSpace,
      undefined,
    );
    expect(ld['@type']).toBe('SportsActivityLocation');
    expect('telephone' in ld).toBe(false);
    expect('geo' in ld).toBe(false);
    expect(ld.openingHoursSpecification[0]?.dayOfWeek).toBe('Monday');
  });
});

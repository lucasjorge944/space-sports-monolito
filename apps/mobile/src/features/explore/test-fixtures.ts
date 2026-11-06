import type { SpaceCard } from '@space-sports/api-client';
import type { Ad } from './feed';

export function makeSpace(i: number, overrides: Partial<SpaceCard> = {}): SpaceCard {
  return {
    id: `space-${i}`,
    slug: `espaco-${i}`,
    name: `Espaço ${i}`,
    logoUrl: null,
    neighborhood: 'Savassi',
    city: 'Belo Horizonte',
    location: null,
    distanceMeters: null,
    cover: null,
    sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
    pricePerHourCents: 10000,
    rating: { count: 0, average: null },
    services: ['RENTAL'],
    ...overrides,
  };
}

export function makeSpaces(count: number, from = 0): SpaceCard[] {
  return Array.from({ length: count }, (_, i) => makeSpace(from + i));
}

export function makeAd(id: string, overrides: Partial<Ad> = {}): Ad {
  return {
    creativeId: id,
    campaignId: `campaign-${id}`,
    placement: 'EXPLORE_FEED',
    advertiser: { name: `Anunciante ${id}`, kind: 'COMPANY' },
    title: `Título ${id}`,
    body: `Texto ${id}`,
    ctaLabel: 'Ver ofertas',
    imageUrl: `https://cdn.test/${id}.jpg`,
    destination: { type: 'URL', url: `https://www.example.com/${id}` },
    deliveryToken: `token-${id}`,
    tokenExpiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

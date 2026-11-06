import { describe, expect, it } from 'vitest';
import {
  adCtr,
  adEventsInputSchema,
  adImageFit,
  adsQuerySchema,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdvertiserSchema,
  whatsappLink,
} from './ads';

describe('adImageFit', () => {
  it('aceita 2:1 no carrossel e 4:5 no card, com tolerância de 2%', () => {
    expect(adImageFit('EXPLORE_HERO', { width: 960, height: 480 })).toBe('OK');
    expect(adImageFit('EXPLORE_HERO', { width: 1920, height: 960 })).toBe('OK');
    expect(adImageFit('EXPLORE_FEED', { width: 512, height: 640 })).toBe('OK');
    expect(adImageFit('EXPLORE_FEED', { width: 511, height: 639 })).toBe('OK');
    expect(adImageFit('EXPLORE_FEED', { width: 512, height: 641 })).toBe('OK');
  });

  it('recusa proporção errada e imagem pequena', () => {
    expect(adImageFit('EXPLORE_HERO', { width: 960, height: 600 })).toBe('WRONG_ASPECT');
    expect(adImageFit('EXPLORE_FEED', { width: 960, height: 480 })).toBe('WRONG_ASPECT');
    expect(adImageFit('EXPLORE_HERO', { width: 800, height: 400 })).toBe('TOO_SMALL');
    expect(adImageFit('EXPLORE_FEED', { width: 400, height: 500 })).toBe('TOO_SMALL');
  });
});

describe('schemas dos anúncios', () => {
  it('anunciante: categorias proibidas não existem (RN-ADS-01)', () => {
    const base = { name: 'Loja', kind: 'COMPANY' };
    expect(createAdvertiserSchema.safeParse({ ...base, category: 'SUPPLEMENTS' }).success).toBe(
      true,
    );
    for (const category of ['BETTING', 'ALCOHOL']) {
      expect(createAdvertiserSchema.safeParse({ ...base, category }).success).toBe(false);
    }
  });

  it('anunciante SPACE exige o espaço e COMPANY não aceita', () => {
    const space = { name: 'Arena', category: 'SPORTS_SPACE', kind: 'SPACE' };
    expect(createAdvertiserSchema.safeParse(space).success).toBe(false);
    const spaceId = '0190d1a4-0000-7000-8000-000000000001';
    expect(createAdvertiserSchema.safeParse({ ...space, spaceId }).success).toBe(true);
    expect(createAdvertiserSchema.safeParse({ ...space, kind: 'COMPANY', spaceId }).success).toBe(
      false,
    );
  });

  it('campanha: fim depois do início e peso de 1 a 10', () => {
    const base = {
      advertiserId: '0190d1a4-0000-7000-8000-000000000001',
      name: 'Verão',
      placement: 'EXPLORE_HERO',
      startsAt: '2026-11-01T03:00:00.000Z',
      endsAt: '2026-12-01T03:00:00.000Z',
    };
    expect(createAdCampaignSchema.parse(base)).toMatchObject({
      weight: 5,
      status: 'DRAFT',
      cityIds: [],
      sportIds: [],
    });
    expect(createAdCampaignSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(
      false,
    );
    expect(createAdCampaignSchema.safeParse({ ...base, weight: 11 }).success).toBe(false);
    expect(createAdCampaignSchema.safeParse({ ...base, weight: 0 }).success).toBe(false);
  });

  it('peça: limites de texto e destino coerente', () => {
    const base = {
      title: 'Raquetes com 30% off',
      ctaLabel: 'Ver ofertas',
      destination: { type: 'URL', url: 'https://example.com/raquetes' },
    };
    expect(createAdCreativeSchema.safeParse(base).success).toBe(true);
    expect(createAdCreativeSchema.safeParse({ ...base, title: 'x'.repeat(41) }).success).toBe(
      false,
    );
    expect(createAdCreativeSchema.safeParse({ ...base, body: 'x'.repeat(91) }).success).toBe(false);
    expect(createAdCreativeSchema.safeParse({ ...base, ctaLabel: 'x'.repeat(21) }).success).toBe(
      false,
    );
    // Só `https://` minúsculo e sem espaço, espelhando o check do banco.
    for (const url of [
      'http://example.com',
      'HTTPS://example.com',
      'https:/example.com',
      'https:example.com',
      'https://exa mple.com',
    ]) {
      expect(
        createAdCreativeSchema.safeParse({ ...base, destination: { type: 'URL', url } }).success,
        url,
      ).toBe(false);
    }
    expect(
      createAdCreativeSchema.safeParse({
        ...base,
        destination: { type: 'WHATSAPP', phone: '31999998888', message: 'Oi' },
      }).success,
    ).toBe(false);
    expect(
      createAdCreativeSchema.safeParse({
        ...base,
        destination: { type: 'WHATSAPP', phone: '+5531999998888', message: 'Oi' },
      }).success,
    ).toBe(true);
    expect(createAdCreativeSchema.parse({ ...base, body: '  ' }).body).toBeNull();
  });

  it('entrega: lat e lng juntos', () => {
    expect(adsQuerySchema.safeParse({ placement: 'EXPLORE_FEED', lat: '-19.9' }).success).toBe(
      false,
    );
    expect(
      adsQuerySchema.parse({ placement: 'EXPLORE_FEED', lat: '-19.9', lng: '-43.9' }),
    ).toMatchObject({ lat: -19.9, lng: -43.9 });
  });

  it('eventos: até 50 por envio', () => {
    const event = { token: 'abc', type: 'IMPRESSION' };
    expect(adEventsInputSchema.safeParse({ events: Array(50).fill(event) }).success).toBe(true);
    expect(adEventsInputSchema.safeParse({ events: Array(51).fill(event) }).success).toBe(false);
    expect(adEventsInputSchema.safeParse({ events: [] }).success).toBe(false);
  });
});

describe('utilitários', () => {
  it('CTR com 4 casas e zero sem impressões', () => {
    expect(adCtr(0, 0)).toBe(0);
    expect(adCtr(300, 7)).toBe(0.0233);
  });

  it('link do WhatsApp sem o + e com a mensagem codificada', () => {
    expect(whatsappLink('+5531999998888', 'Olá, vim pelo app!')).toBe(
      'https://wa.me/5531999998888?text=Ol%C3%A1%2C%20vim%20pelo%20app!',
    );
  });
});

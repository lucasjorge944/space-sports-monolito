import { existsSync } from 'node:fs';
import { createAdCreativeSchema, createAdvertiserSchema } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_AD_WHATSAPP, DEMO_ADS, demoCampaignName } from './demo-ads.js';
import { demoPhone } from './demo-seed.js';

describe('DEMO_ADS', () => {
  it('as vagas do briefing: 4 no carrossel (um de espaço) e 5 no card da lista', () => {
    const by = (placement: string) =>
      DEMO_ADS.filter((ad) => ad.placement === placement).map((ad) => ad.advertiser.name);
    expect(by('EXPLORE_HERO')).toEqual([
      'Rede Quadra Artigos Esportivos',
      'Areia Fit',
      'Força Total Equipamentos',
      'Astral Beach Sports',
    ]);
    expect(by('EXPLORE_FEED')).toEqual([
      'Pulso Nutrition',
      'Passada Calçados',
      'Movimento Fisio',
      'Verde Vida Sucos',
      'Hidrata+',
    ]);
  });

  it('textos dentro dos limites e destinos válidos (só example.com ou WhatsApp fictício)', () => {
    for (const ad of DEMO_ADS) {
      const destination =
        ad.destination.type === 'SPACE'
          ? { type: 'SPACE', spaceId: '0190d1a4-0000-7000-8000-000000000001' }
          : ad.destination;
      expect(
        createAdCreativeSchema.safeParse({
          title: ad.title,
          body: ad.body,
          ctaLabel: ad.ctaLabel,
          destination,
        }).success,
        ad.advertiser.name,
      ).toBe(true);
      if (ad.destination.type === 'URL') {
        expect(new URL(ad.destination.url).hostname).toBe('example.com');
      }
      if (ad.destination.type === 'WHATSAPP') expect(ad.destination.phone).toBe(DEMO_AD_WHATSAPP);
      expect(demoCampaignName(ad).length).toBeLessThanOrEqual(120);
    }
  });

  it('o número do WhatsApp é da faixa fictícia e não colide com as contas de demonstração', () => {
    expect(DEMO_AD_WHATSAPP).toMatch(/^\+5531900000\d{3}$/);
    expect(Array.from({ length: 20 }, (_, i) => demoPhone(i))).not.toContain(DEMO_AD_WHATSAPP);
  });

  it('anunciantes com categoria permitida; só o de espaço fica sem imagem', () => {
    for (const ad of DEMO_ADS) {
      const kind = ad.advertiser.space ? 'SPACE' : 'COMPANY';
      expect(
        createAdvertiserSchema.safeParse({
          name: ad.advertiser.name,
          category: ad.advertiser.category,
          kind,
          ...(ad.advertiser.space ? { spaceId: '0190d1a4-0000-7000-8000-000000000001' } : {}),
        }).success,
      ).toBe(true);
      expect(ad.image === null).toBe(kind === 'SPACE');
      if (ad.image) {
        expect(existsSync(new URL(`./demo-assets/ads/${ad.image}`, import.meta.url))).toBe(true);
      }
    }
  });
});

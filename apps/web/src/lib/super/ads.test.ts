import { ApiError } from '@space-sports/api-client';
import { adImageFit } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import { cropBox } from '@/lib/image-crop';
import {
  AD_CROP_TOO_LARGE,
  adCropProblem,
  adCropRenderMessage,
  adErrorField,
  adErrorMessage,
  adOutputSize,
  adsSearchFrom,
  adsUrlState,
  advertiserPayload,
  campaignPayload,
  campaignSituation,
  campaignSituationLabel,
  canSkipImage,
  creativePayload,
  destinationCaption,
  emptyAdvertiserForm,
  emptyCampaignForm,
  emptyCreativeForm,
  formatCtr,
  isImageResendError,
  isUuid,
  isValidAdUrl,
  localToUtcIso,
  moveId,
  offAirText,
  reportCsvFilename,
  showcaseWarning,
  utcIsoToLocal,
  validateAdvertiser,
  validateCampaign,
  validateCreative,
} from './ads';

const apiError = (code: string, status = 422, details?: unknown) =>
  new ApiError({ status, code, message: 'texto da API', details });

describe('situação da campanha', () => {
  const campaign = (status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED', reasons: string[] = []) =>
    campaignSituation({
      status,
      delivery: { onAir: reasons.length === 0 && status === 'ACTIVE', reasons: reasons as never },
    });

  it('no ar só quando a API diz', () => {
    expect(campaign('ACTIVE')).toBe('ON_AIR');
  });

  it('agendada, encerrada e pausada', () => {
    expect(campaign('ACTIVE', ['NOT_STARTED'])).toBe('SCHEDULED');
    expect(campaign('ACTIVE', ['ENDED'])).toBe('ENDED');
    expect(campaign('PAUSED', ['NOT_ACTIVE', 'ENDED'])).toBe('PAUSED');
  });

  it('o que o Super precisa resolver vem antes do agendamento', () => {
    expect(campaign('ACTIVE', ['NOT_STARTED', 'NO_CREATIVES'])).toBe('NO_CREATIVES');
    expect(campaign('ACTIVE', ['ADVERTISER_INACTIVE', 'NO_CREATIVES'])).toBe('ADVERTISER_INACTIVE');
  });

  it('rascunho e arquivada', () => {
    expect(campaign('DRAFT', ['NOT_ACTIVE', 'NOT_STARTED'])).toBe('DRAFT');
    expect(campaign('ARCHIVED', ['NOT_ACTIVE'])).toBe('ARCHIVED');
  });

  it('o status escolhido pelo Super vem antes de "Sem peças" e do período', () => {
    expect(campaign('DRAFT', ['NOT_ACTIVE', 'NO_CREATIVES'])).toBe('DRAFT');
    expect(campaign('DRAFT', ['NOT_ACTIVE', 'ENDED', 'ADVERTISER_INACTIVE'])).toBe('DRAFT');
    expect(campaign('PAUSED', ['NOT_ACTIVE', 'NO_CREATIVES'])).toBe('PAUSED');
  });

  it('ativa fora do ar sem motivo conhecido fica com o selo neutro', () => {
    expect(campaign('ACTIVE', ['NOT_ACTIVE'])).toBe('OFF_AIR');
    expect(campaignSituationLabel.OFF_AIR).toBe('Fora do ar');
  });

  it('explica por que está fora do ar', () => {
    expect(offAirText([])).toBeNull();
    expect(offAirText(['NOT_STARTED', 'NO_CREATIVES'])).toBe(
      'Fora do ar: o período ainda não começou e nenhuma peça ativa pode ser entregue.',
    );
  });
});

describe('datas em America/Sao_Paulo, enviadas em UTC', () => {
  it('converte nos dois sentidos', () => {
    expect(localToUtcIso('2026-11-10', '08:00')).toBe('2026-11-10T11:00:00.000Z');
    expect(utcIsoToLocal('2026-11-11T02:59:00.000Z')).toEqual({
      date: '2026-11-10',
      time: '23:59',
    });
  });
});

describe('anunciante', () => {
  it('exige nome, categoria e, no tipo Espaço, o espaço', () => {
    const errors = validateAdvertiser({ ...emptyAdvertiserForm(), kind: 'SPACE' }, false);
    expect(Object.keys(errors).sort()).toEqual(['category', 'name', 'spaceId']);
    // Na edição, tipo e espaço não mudam.
    expect(validateAdvertiser({ ...emptyAdvertiserForm(), kind: 'SPACE' }, true).spaceId).toBe(
      undefined,
    );
  });

  it('confere e-mail e telefone do contato e manda vazio como null', () => {
    const values = {
      ...emptyAdvertiserForm(),
      name: ' Rede Quadra ',
      category: 'SPORTING_GOODS' as const,
      contactEmail: 'x',
      contactPhone: '(31) 9',
    };
    expect(validateAdvertiser(values, false)).toEqual({
      contactEmail: 'Informe um e-mail válido.',
      contactPhone: 'Informe o telefone com DDD.',
    });
    expect(
      advertiserPayload({
        ...values,
        contactEmail: 'Vendas@Exemplo.com',
        contactPhone: '(31) 99999-8888',
      }),
    ).toEqual({
      name: 'Rede Quadra',
      category: 'SPORTING_GOODS',
      contactName: null,
      contactEmail: 'vendas@exemplo.com',
      contactPhone: '+5531999998888',
      notes: null,
    });
  });
});

describe('campanha', () => {
  const valid = {
    ...emptyCampaignForm('a1'),
    name: 'Verão',
    placement: 'EXPLORE_HERO' as const,
    startDate: '2026-11-10',
    endDate: '2026-12-10',
  };

  it('valida período e peso', () => {
    expect(validateCampaign(valid)).toEqual({});
    expect(
      validateCampaign({ ...valid, endDate: '2026-11-10', endTime: '00:00', weight: '11' }),
    ).toEqual({ endsAt: 'O fim precisa ser depois do início.', weight: 'Use um peso de 1 a 10.' });
  });

  it('envia as datas em UTC e o peso como número', () => {
    expect(campaignPayload(valid)).toMatchObject({
      startsAt: '2026-11-10T03:00:00.000Z',
      endsAt: '2026-12-11T02:59:00.000Z',
      weight: 5,
      cityIds: [],
      sportIds: [],
    });
  });
});

describe('peça', () => {
  it('URL só https:// sem espaços', () => {
    expect(isValidAdUrl('https://exemplo.com.br/promo')).toBe(true);
    expect(isValidAdUrl('http://exemplo.com.br')).toBe(false);
    expect(isValidAdUrl('HTTPS://exemplo.com.br')).toBe(false);
    expect(isValidAdUrl('https://exemplo.com.br/a b')).toBe(false);
    expect(isValidAdUrl('https:/exemplo.com')).toBe(false);
  });

  it('valida textos, destino e o WhatsApp com DDD e mensagem', () => {
    const values = {
      ...emptyCreativeForm(),
      title: 'x'.repeat(41),
      destinationType: 'WHATSAPP' as const,
      whatsappPhone: '(31) 9999',
    };
    expect(validateCreative(values)).toEqual({
      title: 'Use até 40 caracteres.',
      ctaLabel: 'Informe o texto do botão.',
      whatsappPhone: 'Informe o WhatsApp com DDD.',
      whatsappMessage: 'Escreva a mensagem pronta.',
    });
    expect(
      creativePayload({
        ...values,
        title: 'Whey',
        ctaLabel: 'Chamar',
        whatsappPhone: '(31) 99999-8888',
        whatsappMessage: 'Oi!',
      }),
    ).toEqual({
      title: 'Whey',
      body: null,
      ctaLabel: 'Chamar',
      destination: { type: 'WHATSAPP', phone: '+5531999998888', message: 'Oi!' },
      active: true,
    });
  });

  it('sem imagem só anunciante Espaço com destino no próprio espaço', () => {
    const space = { kind: 'SPACE' as const, spaceId: 's1' };
    expect(canSkipImage(space, { destinationType: 'SPACE', spaceId: 's1' })).toBe(true);
    expect(canSkipImage(space, { destinationType: 'SPACE', spaceId: 's2' })).toBe(false);
    expect(canSkipImage(space, { destinationType: 'URL', spaceId: 's1' })).toBe(false);
    expect(
      canSkipImage({ kind: 'COMPANY', spaceId: null }, { destinationType: 'SPACE', spaceId: 's1' }),
    ).toBe(false);
  });

  it('rodapé do card: domínio, WhatsApp ou local do espaço', () => {
    expect(
      destinationCaption({ destinationType: 'URL', url: 'https://www.loja.com/x' }, null),
    ).toBe('loja.com');
    expect(destinationCaption({ destinationType: 'WHATSAPP', url: '' }, null)).toBe('WhatsApp');
    expect(destinationCaption({ destinationType: 'SPACE', url: '' }, 'Savassi · BH')).toBe(
      'Savassi · BH',
    );
  });
});

describe('imagem da peça', () => {
  it('o arquivo final tem a proporção exata da vaga e não amplia', () => {
    const hero = cropBox({ width: 4000, height: 3000 }, 2, 1, { x: 0, y: 0 });
    expect(adOutputSize(hero, 'EXPLORE_HERO')).toEqual({ width: 1600, height: 800 });
    const feed = cropBox({ width: 1001, height: 2000 }, 0.8, 1, { x: 0, y: 0 });
    const out = adOutputSize(feed, 'EXPLORE_FEED');
    expect(out).toEqual({ width: 1000, height: 1250 });
    expect(adImageFit('EXPLORE_FEED', out)).toBe('OK');
  });

  it('recusa no navegador o recorte menor que o mínimo da vaga', () => {
    const small = cropBox({ width: 900, height: 600 }, 2, 1, { x: 0, y: 0 });
    expect(adCropProblem(small, 'EXPLORE_HERO')).toMatch(/mínimo 960 × 480/);
    const zoomed = cropBox({ width: 2000, height: 1000 }, 2, 3, { x: 0, y: 0 });
    expect(adCropProblem(zoomed, 'EXPLORE_HERO')).not.toBeNull();
    expect(
      adCropProblem(cropBox({ width: 2000, height: 1000 }, 2, 1, { x: 0, y: 0 }), 'EXPLORE_HERO'),
    ).toBeNull();
  });
});

describe('ordem e relatório', () => {
  it('move a peça para cima e para baixo sem sair da lista', () => {
    expect(moveId(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('CTR em porcentagem e nome do CSV', () => {
    expect(formatCtr(0.0235)).toBe('2,35%');
    expect(reportCsvFilename('Verão Rede Quadra!', '2026-11-01', '2026-11-30')).toBe(
      'anuncio-verao-rede-quadra-2026-11-01_2026-11-30.csv',
    );
  });
});

describe('erros da API', () => {
  it('mensagens claras e o campo de cada erro', () => {
    expect(adErrorMessage(apiError('AD_CATEGORY_FORBIDDEN'))).toMatch(/Apostas \(bets\)/);
    expect(adErrorField(apiError('AD_CATEGORY_FORBIDDEN'))).toBe('category');
    expect(adErrorMessage(apiError('AD_SPACE_NOT_FOUND'))).toMatch(/suspenso/);
    expect(adErrorMessage(apiError('AD_PLACEMENT_CHANGED', 409))).toMatch(/Envie a imagem de novo/);
    expect(adErrorMessage(apiError('STORAGE_UNAVAILABLE', 503))).toMatch(/indisponível/);
    expect(adErrorMessage(apiError('QUALQUER', 503))).toMatch(/indisponível/);
    expect(
      adErrorMessage(
        apiError('AD_IMAGE_TOO_SMALL', 422, {
          width: 10,
          height: 5,
          format: { aspectWidth: 2, aspectHeight: 1, minWidth: 960, minHeight: 480 },
        }),
      ),
    ).toBe('A imagem precisa ter pelo menos 960 × 480 px. Use uma imagem maior.');
    expect(isImageResendError(apiError('AD_PLACEMENT_CHANGED', 409))).toBe(true);
    expect(isImageResendError(apiError('AD_CREATIVE_INVALID'))).toBe(false);
  });
});

describe('URL da tela de anúncios', () => {
  const VALID = '00000000-0000-4000-8000-000000000701';
  const params = (query: string) => new URLSearchParams(query);

  it('aceita só UUID no anunciante', () => {
    expect(isUuid(VALID)).toBe(true);
    expect(isUuid('abc')).toBe(false);
    expect(isUuid("1' or 1=1")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('lê a aba e o anunciante; ignora anunciante inválido', () => {
    expect(adsUrlState(params(''))).toEqual({ tab: 'campanhas', advertiserId: '' });
    expect(adsUrlState(params('aba=anunciantes'))).toEqual({
      tab: 'anunciantes',
      advertiserId: '',
    });
    expect(adsUrlState(params(`anunciante=${VALID}`))).toEqual({
      tab: 'campanhas',
      advertiserId: VALID,
    });
    expect(adsUrlState(params('anunciante=xyz&aba=outra'))).toEqual({
      tab: 'campanhas',
      advertiserId: '',
    });
  });

  it('troca a aba e o anunciante mantendo o resto', () => {
    expect(adsSearchFrom(params(`anunciante=${VALID}`), { tab: 'anunciantes' })).toBe(
      `anunciante=${VALID}&aba=anunciantes`,
    );
    expect(adsSearchFrom(params('aba=anunciantes'), { tab: 'campanhas' })).toBe('');
    expect(adsSearchFrom(params(''), { advertiserId: VALID })).toBe(`anunciante=${VALID}`);
    expect(adsSearchFrom(params(`anunciante=${VALID}`), { advertiserId: '' })).toBe('');
    expect(adsSearchFrom(params('anunciante=xyz'), { tab: 'campanhas' })).toBe('');
  });
});

describe('editor da peça', () => {
  it('recorte grande demais tem mensagem própria', () => {
    expect(adCropRenderMessage(new Error(AD_CROP_TOO_LARGE), 'EXPLORE_HERO')).toMatch(
      /passou de 2 MB/,
    );
    expect(adCropRenderMessage(new Error('canvas'), 'EXPLORE_HERO')).toMatch(
      /Não foi possível gerar a imagem/,
    );
  });

  it('avisa quando o espaço de destino está fora da vitrine', () => {
    expect(showcaseWarning([])).toBe(
      'Este espaço está fora da vitrine: a peça não é entregue enquanto ele não voltar.',
    );
    expect(showcaseWarning(['PRICE_PER_HOUR', 'ACTIVE_COURT'])).toMatch(
      /Falta: preço por hora, ao menos uma quadra ativa\.$/,
    );
  });
});

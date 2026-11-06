import { describe, expect, it } from 'vitest';
import { fakeCardToken, isLuhnValid, parseFakeCardToken } from './fake-card';
import {
  calculatePlatformFee,
  divideRoundHalfUp,
  isMinFeeApplied,
  paymentOptionsFor,
  proportionalFeeRefund,
  resolveFeeSettings,
  splitCharge,
} from './online-payments';
import {
  maskDocument,
  refundOnlineChargeSchema,
  submitMerchantAccountSchema,
  walletEntriesQuerySchema,
} from './payments';

// RN-ONPAY-01: taxa = min(valor, max(arredondar(valor × bps ÷ 10000), mínimo)), meio para cima.

const DEFAULTS = { pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'SPACE' as const };

describe('divideRoundHalfUp', () => {
  it('arredonda meio para cima', () => {
    expect(divideRoundHalfUp(5, 10)).toBe(1);
    expect(divideRoundHalfUp(4, 10)).toBe(0);
    expect(divideRoundHalfUp(15, 10)).toBe(2);
    expect(divideRoundHalfUp(25_000, 10_000)).toBe(3);
    expect(divideRoundHalfUp(24_999, 10_000)).toBe(2);
  });

  it('recusa negativo e divisor inválido', () => {
    expect(() => divideRoundHalfUp(-1, 10)).toThrow(RangeError);
    expect(() => divideRoundHalfUp(1, 0)).toThrow(RangeError);
  });
});

describe('calculatePlatformFee', () => {
  it('percentual acima do mínimo', () => {
    // R$ 100,00 a 4% = R$ 4,00.
    expect(calculatePlatformFee(10_000, { bps: 400, minFeeCents: 100 })).toBe(400);
    // R$ 150,00 a 6% = R$ 9,00.
    expect(calculatePlatformFee(15_000, { bps: 600, minFeeCents: 100 })).toBe(900);
  });

  it('arredonda meio para cima no centavo', () => {
    // 3.737 × 4% = 149,48 → 149; 3.738 × 4% = 149,52 → 150; 3.7375 não existe, 1.875 × 4% = 75,0.
    expect(calculatePlatformFee(3_737, { bps: 400, minFeeCents: 0 })).toBe(149);
    expect(calculatePlatformFee(3_738, { bps: 400, minFeeCents: 0 })).toBe(150);
    // 1.250 × 2% = 25,0; 1.225 × 2% = 24,5 → 25 (meio sobe).
    expect(calculatePlatformFee(1_225, { bps: 200, minFeeCents: 0 })).toBe(25);
  });

  it('aplica o mínimo', () => {
    // R$ 20,00 a 4% = R$ 0,80 → mínimo R$ 1,00.
    expect(calculatePlatformFee(2_000, { bps: 400, minFeeCents: 100 })).toBe(100);
  });

  it('nunca passa do valor (teto)', () => {
    expect(calculatePlatformFee(50, { bps: 400, minFeeCents: 100 })).toBe(50);
    expect(calculatePlatformFee(1, { bps: 10_000, minFeeCents: 0 })).toBe(1);
  });

  it('valor zero não tem taxa; valor inválido é recusado', () => {
    expect(calculatePlatformFee(0, { bps: 400, minFeeCents: 100 })).toBe(0);
    expect(() => calculatePlatformFee(-1, { bps: 400, minFeeCents: 100 })).toThrow(RangeError);
    expect(() => calculatePlatformFee(1.5, { bps: 400, minFeeCents: 100 })).toThrow(RangeError);
  });
});

describe('resolveFeeSettings', () => {
  it('cada campo do espaço vence o padrão; nulo volta ao padrão', () => {
    expect(resolveFeeSettings(DEFAULTS, null)).toEqual(DEFAULTS);
    expect(
      resolveFeeSettings(DEFAULTS, { pixFeeBps: 250, cardFeeBps: null, minFeeCents: 50 }),
    ).toEqual({ pixFeeBps: 250, cardFeeBps: 600, minFeeCents: 50, feePayer: 'SPACE' });
  });
});

describe('splitCharge', () => {
  it('SPACE: o jogador paga o preço e o espaço recebe valor − taxa', () => {
    expect(splitCharge(10_000, 'CARD', DEFAULTS)).toEqual({
      serviceAmountCents: 10_000,
      amountCents: 10_000,
      platformFeeCents: 600,
      spaceNetCents: 9_400,
      feeBps: 600,
      minFeeCents: 100,
      feePayer: 'SPACE',
    });
  });

  it('PLAYER (futuro): a taxa vem por cima do preço', () => {
    const split = splitCharge(10_000, 'PIX', { ...DEFAULTS, feePayer: 'PLAYER' });
    expect(split).toMatchObject({
      amountCents: 10_400,
      platformFeeCents: 400,
      spaceNetCents: 10_000,
    });
  });
});

describe('proportionalFeeRefund (decisão 94: regra acumulada)', () => {
  const charge = {
    amountCents: 10_000,
    platformFeeCents: 400,
    refundedCents: 0,
    feeRefundedCents: 0,
  };

  it('devolve a taxa na proporção do acumulado', () => {
    expect(proportionalFeeRefund(charge, 5_000)).toBe(200);
    expect(proportionalFeeRefund(charge, 3_333)).toBe(133);
  });

  it('o estorno que zera devolve o resto da taxa', () => {
    const after = { ...charge, refundedCents: 3_333, feeRefundedCents: 133 };
    expect(proportionalFeeRefund(after, 6_667)).toBe(267);
  });

  it('Pix de R$ 20,00 com taxa mínima: três estornos de R$ 3,30 e o resto devolvem R$ 1,00', () => {
    const pix = {
      amountCents: 2_000,
      platformFeeCents: 100,
      refundedCents: 0,
      feeRefundedCents: 0,
    };
    const fees: number[] = [];
    for (const refund of [330, 330, 330, 1_010]) {
      const fee = proportionalFeeRefund(pix, refund);
      fees.push(fee);
      pix.refundedCents += refund;
      pix.feeRefundedCents += fee;
    }
    // Acumulado: 16,5 → 17; 33 → 33; 49,5 → 50; o último leva o resto.
    expect(fees).toEqual([17, 16, 17, 50]);
    expect(pix.feeRefundedCents).toBe(100);
  });

  it('recusa estorno acima do saldo', () => {
    expect(() => proportionalFeeRefund(charge, 10_001)).toThrow(RangeError);
    expect(() => proportionalFeeRefund(charge, 0)).toThrow(RangeError);
  });
});

describe('isMinFeeApplied', () => {
  it('indica quando o mínimo vence o percentual', () => {
    expect(isMinFeeApplied(2_000, { bps: 400, minFeeCents: 100 })).toBe(true);
    expect(isMinFeeApplied(10_000, { bps: 400, minFeeCents: 100 })).toBe(false);
    expect(isMinFeeApplied(2_500, { bps: 400, minFeeCents: 100 })).toBe(false);
  });
});

describe('paymentOptionsFor', () => {
  it('oferece o que o modo permite', () => {
    expect(paymentOptionsFor('ON_SITE')).toEqual(['ON_SITE']);
    expect(paymentOptionsFor('ONLINE_OPTIONAL')).toEqual(['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD']);
    expect(paymentOptionsFor('ONLINE_REQUIRED')).toEqual(['ONLINE_PIX', 'ONLINE_CARD']);
  });
});

describe('cartões de teste', () => {
  it('gera o token pelo cenário e recusa número inválido', () => {
    expect(isLuhnValid('4111111111111111')).toBe(true);
    expect(fakeCardToken('4111 1111 1111 1111')).toBe('tok_fake_approve_visa_1111');
    expect(fakeCardToken('4000000000000002')).toBe('tok_fake_decline_visa_0002');
    expect(fakeCardToken('4000000000000259')).toBe('tok_fake_chargeback_visa_0259');
    expect(fakeCardToken('4111111111111112')).toBeNull();
    expect(parseFakeCardToken('tok_fake_approve_visa_1111')).toEqual({
      scenario: 'approve',
      brand: 'visa',
      last4: '1111',
    });
    expect(parseFakeCardToken('tok_real_123')).toBeNull();
  });
});

describe('documentos', () => {
  it('mascara CPF e CNPJ', () => {
    expect(maskDocument('CPF', '52998224725')).toBe('***.982.247-**');
    expect(maskDocument('CNPJ', '11222333000181')).toBe('11.222.***/****-**');
  });

  it('o cadastro exige documento válido e aceite', () => {
    const base = {
      documentType: 'CPF',
      document: '529.982.247-25',
      legalName: 'Fulano',
      responsibleName: 'Fulano',
      email: 'f@example.com',
      phone: '+5531999990000',
      address: {
        postalCode: '30110000',
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
      },
      payout: { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'f@example.com' },
      acceptTerms: true,
    };
    expect(submitMerchantAccountSchema.parse(base).document).toBe('52998224725');
    expect(
      submitMerchantAccountSchema.safeParse({ ...base, document: '52998224724' }).success,
    ).toBe(false);
    expect(submitMerchantAccountSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(
      false,
    );
    const cnpj = {
      ...base,
      documentType: 'CNPJ',
      document: '11.222.333/0001-81',
      responsibleCpf: '529.982.247-25',
    };
    const parsed = submitMerchantAccountSchema.parse(cnpj);
    expect(parsed.document).toBe('11222333000181');
    expect(parsed.responsibleCpf).toBe('52998224725');
  });

  it('CPF do responsável: obrigatório e válido com CNPJ, ausente com CPF (PG.2b)', () => {
    const base = {
      documentType: 'CNPJ',
      document: '11222333000181',
      legalName: 'Arena Ltda',
      responsibleName: 'Fulano',
      email: 'f@example.com',
      phone: '+5531999990000',
      address: {
        postalCode: '30110000',
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
      },
      payout: { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'f@example.com' },
      acceptTerms: true,
    };
    const issues = (value: unknown) => {
      const result = submitMerchantAccountSchema.safeParse(value);
      return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    };
    expect(issues(base)).toEqual(['responsibleCpf']);
    expect(issues({ ...base, responsibleCpf: '52998224724' })).toEqual(['responsibleCpf']);
    expect(issues({ ...base, responsibleCpf: '52998224725' })).toEqual([]);
    expect(
      issues({
        ...base,
        documentType: 'CPF',
        document: '52998224725',
        responsibleCpf: '52998224725',
      }),
    ).toEqual(['responsibleCpf']);
  });
});

describe('estorno manual e carteira (PG.2b)', () => {
  it('o valor do estorno é sempre obrigatório, também no "tudo o que falta"', () => {
    expect(refundOnlineChargeSchema.safeParse({ reason: 'Tudo' }).success).toBe(false);
    expect(refundOnlineChargeSchema.safeParse({ amountCents: 0, reason: 'x' }).success).toBe(false);
    expect(refundOnlineChargeSchema.parse({ amountCents: 1_010, reason: 'Tudo' })).toEqual({
      amountCents: 1_010,
      reason: 'Tudo',
      chargeAgain: false,
    });
  });

  it('lançamentos filtram por meio (PIX/CARD)', () => {
    expect(walletEntriesQuerySchema.parse({ method: 'PIX' }).method).toBe('PIX');
    expect(walletEntriesQuerySchema.safeParse({ method: 'BOLETO' }).success).toBe(false);
  });
});

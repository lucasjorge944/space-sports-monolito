import { describe, expect, it } from 'vitest';
import { formatSignedMoney } from '@/lib/format';
import {
  barPercent,
  cancelReasonText,
  canRefund,
  chargeHeadline,
  chargeNetCents,
  cursorsFor,
  defaultWalletRange,
  disputeDeadline,
  disputeTextError,
  EMPTY_MERCHANT_DRAFT,
  feeExample,
  feeLineLabel,
  isOnlineRecord,
  ledgerDescription,
  type MerchantDraft,
  merchantFormMode,
  merchantPayload,
  normalizePixKey,
  parseAttachmentUrls,
  parseOnlineTab,
  refundAmountError,
  refundEffect,
  refundEstimate,
  refundPayload,
  refundReasonError,
  refundTitle,
  releaseRows,
  splitAccount,
  validateMerchantStep,
  WALLET_METHOD_FILTERS,
  walletCsvFilename,
  walletPageLabel,
} from './online-payments';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('feeLineLabel', () => {
  it('usa o percentual gravado na cobrança', () => {
    expect(feeLineLabel({ feeBps: 400, minFeeApplied: false })).toBe('Taxa de serviço (4%)');
    expect(feeLineLabel({ feeBps: 450, minFeeApplied: false })).toBe('Taxa de serviço (4,5%)');
  });
  it('diz "(mínimo)" quando valeu o mínimo', () => {
    expect(feeLineLabel({ feeBps: 400, minFeeApplied: true })).toBe('Taxa de serviço (mínimo)');
  });
});

describe('chargeHeadline', () => {
  const base = { method: 'PIX' as const, cardLast4: null, expiresAt: null, paidAt: null };
  it('cobrança paga mostra meio e data', () => {
    expect(chargeHeadline({ ...base, status: 'PAID', paidAt: '2026-11-08T21:42:00.000Z' })).toBe(
      'Pix · pago em 08/11 18:42',
    );
  });
  it('cartão traz o final', () => {
    expect(
      chargeHeadline({
        ...base,
        method: 'CARD',
        cardLast4: '1111',
        status: 'REFUNDED',
        paidAt: '2026-11-08T21:42:00.000Z',
      }),
    ).toBe('Cartão final 1111 · pago em 08/11 18:42');
  });
  it('Pix aberto mostra a validade; cartão pendente está em processamento', () => {
    expect(
      chargeHeadline({ ...base, status: 'PENDING', expiresAt: '2026-11-08T21:47:00.000Z' }),
    ).toBe('Pix aberto até 18:47');
    expect(chargeHeadline({ ...base, method: 'CARD', status: 'PENDING' })).toBe(
      'Cartão em processamento',
    );
  });
});

describe('estorno', () => {
  // Pix de R$ 120,00, taxa de R$ 4,80, R$ 40,00 já estornados com R$ 1,60 de taxa devolvida.
  const charge = {
    amountCents: 12_000,
    platformFeeCents: 480,
    refundedCents: 4_000,
    feeRefundedCents: 160,
    refundableCents: 8_000,
  };

  it('estima a taxa devolvida pela regra acumulada (decisão 94)', () => {
    expect(refundEstimate(charge, 3_000, false)).toEqual({
      refundCents: 3_000,
      feeRefundCents: 120,
      spaceLosesCents: 2_880,
      openAfterCents: 0,
    });
  });

  it('o estorno que zera devolve o resto exato da taxa', () => {
    expect(refundEstimate(charge, 8_000, false)?.feeRefundCents).toBe(320);
  });

  it('"cobrar de novo" deixa o valor em aberto (decisão 93)', () => {
    expect(refundEstimate(charge, 3_000, true)?.openAfterCents).toBe(3_000);
  });

  it('recusa zero e valor acima do reembolsável', () => {
    expect(refundEstimate(charge, 0, false)).toBeNull();
    expect(refundEstimate(charge, 8_001, false)).toBeNull();
  });

  it('o reembolsável já desconta os estornos pendentes', () => {
    expect(refundEstimate({ ...charge, refundableCents: 5_000 }, 6_000, false)).toBeNull();
  });

  it('erros do valor e do motivo', () => {
    expect(refundAmountError(null, 8_000)).toBe('Informe um valor acima de R$ 0,00');
    expect(nbsp(refundAmountError(9_000, 8_000) ?? '')).toBe('Informe um valor até R$ 80,00');
    expect(refundAmountError(8_000, 8_000)).toBeUndefined();
    expect(refundReasonError('ok')).toBe('Informe o motivo do estorno');
    expect(refundReasonError('Chuva interrompeu o jogo')).toBeUndefined();
  });

  it('"Estornar" depende do saldo reembolsável, não do status', () => {
    expect(canRefund({ refundableCents: 12_000 })).toBe(true);
    expect(canRefund({ refundableCents: 0 })).toBe(false);
  });

  it('líquido do espaço', () => {
    expect(chargeNetCents({ ...charge, status: 'PARTIALLY_REFUNDED' })).toBe(7_680);
  });
});

describe('histórico de estornos', () => {
  const refund = {
    kind: 'REFUND' as const,
    status: 'SUCCEEDED' as const,
    amountCents: 4_000,
    reason: 'Quadra sem iluminação',
    reasonCode: 'MANUAL' as const,
    chargeAgain: false,
    requestedByName: 'Ana',
    createdAt: '2026-11-09T15:00:00.000Z',
  };

  it('manual: quem fez e o efeito no item', () => {
    expect(refundTitle(refund)).toBe('Estorno em 09/11 por Ana');
    expect(refundEffect(refund, 'reserva')).toBe('abatido do valor da reserva');
    expect(refundEffect({ ...refund, chargeAgain: true }, 'mensalidade')).toBe(
      'volta a ser cobrado',
    );
  });

  it('automático e pendente', () => {
    expect(
      refundTitle({
        ...refund,
        reasonCode: 'BOOKING_CANCELLED_BY_SPACE',
        requestedByName: null,
        status: 'PENDING',
      }),
    ).toBe('Estorno automático (cancelado pelo espaço) em 09/11 · em processamento');
    expect(refundEffect({ ...refund, reasonCode: 'PAID_AFTER_DEADLINE' }, 'reserva')).toBeNull();
  });

  it('contestação no cartão', () => {
    expect(refundTitle({ ...refund, kind: 'CHARGEBACK', reasonCode: 'CHARGEBACK' })).toBe(
      'Contestação no cartão em 09/11',
    );
  });

  it('motivos de cancelamento do pagamento online', () => {
    expect(cancelReasonText('PAYMENT_EXPIRED')).toBe('Pagamento não feito no prazo');
    expect(cancelReasonText('PAYMENT_ABANDONED')).toBe('O cliente desistiu antes de pagar');
    expect(cancelReasonText('Chuva')).toBe('Chuva');
  });
});

describe('feeExample', () => {
  it('exemplo e o limite do mínimo no Pix', () => {
    const { example, minimumNote } = feeExample({ pixFeeBps: 400, minFeeCents: 100 });
    expect(nbsp(example)).toBe(
      'Exemplo: R$ 100,00 no Pix → taxa R$ 4,00 → o espaço recebe R$ 96,00.',
    );
    expect(nbsp(minimumNote ?? '')).toBe('Abaixo de R$ 25,00 no Pix, vale o mínimo de R$ 1,00.');
  });
  it('arredonda o limite para cima', () => {
    expect(nbsp(feeExample({ pixFeeBps: 300, minFeeCents: 100 }).minimumNote ?? '')).toBe(
      'Abaixo de R$ 33,34 no Pix, vale o mínimo de R$ 1,00.',
    );
  });
  it('sem a linha do mínimo com Pix em 0%', () => {
    expect(feeExample({ pixFeeBps: 0, minFeeCents: 100 }).minimumNote).toBeNull();
  });
});

describe('carteira', () => {
  it('período padrão dos últimos 30 dias e nome do CSV', () => {
    expect(defaultWalletRange(new Date('2026-11-04T15:00:00Z'))).toEqual({
      from: '2026-10-06',
      to: '2026-11-04',
    });
    expect(walletCsvFilename('arena', '2026-10-06', '2026-11-04')).toBe(
      'carteira-arena-2026-10-06_2026-11-04.csv',
    );
  });

  it('a liberar: 7 datas e o resto agrupado', () => {
    const upcoming = Array.from({ length: 9 }, (_, i) => ({
      date: `2026-11-${String(5 + i).padStart(2, '0')}`,
      amountCents: (i + 1) * 100,
    }));
    const { rows, rest, max } = releaseRows(upcoming);
    expect(rows).toHaveLength(7);
    expect(rest).toEqual({ after: '2026-11-11', amountCents: 800 + 900 });
    expect(max).toBe(1_700);
    expect(barPercent(0, max)).toBe(0);
    expect(barPercent(1_700, max)).toBe(100);
  });

  it('valor com sinal', () => {
    expect(nbsp(formatSignedMoney(12_000))).toBe('+ R$ 120,00');
    expect(nbsp(formatSignedMoney(-480))).toBe('− R$ 4,80');
  });

  it('descrição do lançamento', () => {
    expect(
      ledgerDescription({
        kind: 'SALE',
        description: null,
        payableType: 'BOOKING',
        payerName: 'Maria O.',
      }),
    ).toBe('Reserva · Maria O.');
    expect(
      ledgerDescription({ kind: 'PAYOUT', description: null, payableType: null, payerName: null }),
    ).toBe('Repasse para a conta do espaço');
  });

  it('aba da URL', () => {
    expect(parseOnlineTab('contestacoes')).toBe('contestacoes');
    expect(parseOnlineTab('x')).toBe('carteira');
    expect(parseOnlineTab(null)).toBe('carteira');
  });
});

describe('contestações', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('prazo com urgência e encerrado', () => {
    expect(disputeDeadline('2026-11-12T12:00:00Z', now)).toEqual({
      text: '12/11 · faltam 3 dias',
      urgent: true,
      closed: false,
    });
    expect(disputeDeadline('2026-11-20T12:00:00Z', now).urgent).toBe(false);
    expect(disputeDeadline('2026-11-08T12:00:00Z', now)).toMatchObject({
      text: 'Prazo encerrado',
      closed: true,
    });
  });
  it('resposta e anexos', () => {
    expect(disputeTextError('curto')).toBe('Escreva pelo menos 20 caracteres');
    expect(disputeTextError('O cliente jogou das 18h às 19h30.')).toBeUndefined();
    expect(parseAttachmentUrls('https://a.com/x.pdf\nhttps://b.com/y.png').urls).toHaveLength(2);
    expect(parseAttachmentUrls('http://a.com').error).toBe('Use links que começam com https://');
    expect(parseAttachmentUrls('a b c d').error).toBe('Envie até 3 links');
  });
});

describe('cadastro da conta de recebimento', () => {
  const draft: MerchantDraft = {
    ...EMPTY_MERCHANT_DRAFT,
    documentType: 'CPF',
    document: '529.982.247-25',
    legalName: 'Ana Souza',
    phone: '(31) 99999-8888',
    email: 'Ana@Exemplo.com',
    postalCode: '30130-010',
    street: 'Avenida Afonso Pena',
    number: '100',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'mg',
    bankCode: '260',
    agency: '0001',
    account: '12345-6',
    acceptTerms: true,
  };

  it('valida cada etapa', () => {
    expect(validateMerchantStep(0, draft)).toEqual({});
    expect(validateMerchantStep(0, { ...draft, document: '111.111.111-11' }).document).toBe(
      'Informe um CPF válido',
    );
    expect(
      validateMerchantStep(0, { ...draft, documentType: 'CNPJ', document: '', legalName: '' }),
    ).toMatchObject({
      document: 'Informe um CNPJ válido',
      legalName: 'Informe a razão social',
      responsibleName: 'Informe quem responde pela conta',
      responsibleCpf: 'Informe um CPF válido',
    });
    expect(validateMerchantStep(1, draft)).toEqual({});
    expect(validateMerchantStep(2, { ...draft, account: '12345' })).toEqual({});
    expect(validateMerchantStep(2, { ...draft, account: 'abc' }).account).toBeDefined();
    expect(validateMerchantStep(3, { ...draft, acceptTerms: false }).acceptTerms).toBe(
      'Aceite os termos para continuar',
    );
  });

  it('CPF do responsável: obrigatório e válido só com CNPJ (PG.2b)', () => {
    const company = {
      ...draft,
      documentType: 'CNPJ' as const,
      document: '11.222.333/0001-81',
      legalName: 'Arena Exemplo Ltda',
      responsibleName: 'Ana Souza',
    };
    expect(validateMerchantStep(0, company).responsibleCpf).toBe('Informe um CPF válido');
    expect(
      validateMerchantStep(0, { ...company, responsibleCpf: '111.111.111-11' }).responsibleCpf,
    ).toBe('Informe um CPF válido');
    expect(validateMerchantStep(0, { ...company, responsibleCpf: '529.982.247-25' })).toEqual({});
    // Com CPF, o titular é o responsável: o campo nem é validado.
    expect(validateMerchantStep(0, { ...draft, responsibleCpf: 'lixo' })).toEqual({});
  });

  it('separa conta e dígito', () => {
    expect(splitAccount('12345-6')).toEqual({ account: '12345', digit: '6' });
    expect(splitAccount('123456')).toEqual({ account: '12345', digit: '6' });
    expect(splitAccount('1234-x')).toEqual({ account: '1234', digit: 'X' });
    expect(splitAccount('-6')).toBeNull();
  });

  it('chaves Pix', () => {
    expect(normalizePixKey('EMAIL', 'Pix@Arena.com')).toBe('pix@arena.com');
    expect(normalizePixKey('PHONE', '(31) 99999-8888')).toBe('+5531999998888');
    expect(normalizePixKey('RANDOM', 'nao-e-uuid')).toBeNull();
  });

  it('com CNPJ, manda o CPF do responsável só com dígitos', () => {
    const body = merchantPayload({
      ...draft,
      documentType: 'CNPJ',
      document: '11.222.333/0001-81',
      legalName: 'Arena Exemplo Ltda',
      responsibleName: 'Ana Souza',
      responsibleCpf: '529.982.247-25',
    });
    expect(body).toMatchObject({
      document: '11222333000181',
      responsibleName: 'Ana Souza',
      responsibleCpf: '52998224725',
    });
  });

  it('monta o corpo da API, com o responsável igual ao titular no CPF', () => {
    // O CPF do responsável não vai com CPF (a API recusa).
    expect(merchantPayload({ ...draft, responsibleCpf: '529.982.247-25' })).toEqual({
      documentType: 'CPF',
      document: '52998224725',
      legalName: 'Ana Souza',
      responsibleName: 'Ana Souza',
      email: 'ana@exemplo.com',
      phone: '+5531999998888',
      address: {
        postalCode: '30130010',
        street: 'Avenida Afonso Pena',
        number: '100',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
      },
      payout: {
        kind: 'BANK_ACCOUNT',
        bankCode: '260',
        agency: '0001',
        account: '12345',
        accountDigit: '6',
        accountType: 'CHECKING',
      },
      acceptTerms: true,
    });
  });
});

describe('ajustes da revisão da PG.3', () => {
  const approved = { status: 'APPROVED', approvedAt: '2026-11-05T12:00:00.000Z' };

  it('espaço já aprovado nunca abre o cadastro inteiro (decisão 98)', () => {
    const rejectedChange = { status: 'REJECTED', approvedAt: '2026-11-05T12:00:00.000Z' };
    expect(merchantFormMode(rejectedChange, false)).toBe('change');
    expect(merchantFormMode(approved, true)).toBe('change');
    expect(merchantFormMode(approved, false)).toBe('approved');
    expect(merchantFormMode({ status: 'REJECTED', approvedAt: null }, false)).toBe('submit');
    expect(merchantFormMode({ status: 'NOT_STARTED', approvedAt: null }, true)).toBe('submit');
    expect(merchantFormMode({ ...approved, status: 'PENDING' }, true)).toBe('pending');
  });

  it('estorno sempre leva o valor confirmado', () => {
    expect(refundPayload({ cents: 8000, reason: ' Chuva ', chargeAgain: false })).toEqual({
      amountCents: 8000,
      reason: 'Chuva',
      chargeAgain: false,
    });
  });

  it('registro online da mensalidade pelo channel (PG.2b)', () => {
    expect(isOnlineRecord({ channel: 'ONLINE' })).toBe(true);
    expect(isOnlineRecord({ channel: 'ON_SITE' })).toBe(false);
  });

  it('carteira: filtro de meio e "Página X de N" pelo total (PG.2b)', () => {
    expect(WALLET_METHOD_FILTERS.map((f) => f.value)).toEqual(['PIX', 'CARD']);
    expect(walletPageLabel(1, 0)).toBe('Página 1 de 1');
    expect(walletPageLabel(1, 25)).toBe('Página 1 de 1');
    expect(walletPageLabel(2, 26)).toBe('Página 2 de 2');
    expect(walletPageLabel(1, 3, 2)).toBe('Página 1 de 2');
  });

  it('paginação volta à página 1 quando os filtros mudam', () => {
    const paging = { key: 'todos', cursors: [undefined, 'p2'] };
    expect(cursorsFor(paging, 'todos')).toEqual([undefined, 'p2']);
    expect(cursorsFor(paging, 'repasses')).toEqual([undefined]);
  });
});

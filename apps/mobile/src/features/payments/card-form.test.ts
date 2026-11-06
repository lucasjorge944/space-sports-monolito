import { parseFakeCardToken } from '@space-sports/shared';
import {
  EMPTY_CARD,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  formatHolderName,
  testCardValues,
  tokenizeCard,
  validateCard,
  validateExpiry,
  validateNumber,
} from './card-form';

const NOW = new Date('2026-11-08T12:00:00.000Z');

const sandbox = {
  provider: 'fake',
  enabled: true,
  sandbox: {
    testCards: [
      {
        label: 'Aprova',
        number: '4111111111111111',
        holderName: 'Maria S Oliveira',
        expiry: '08/29',
        cvc: '123',
      },
    ],
  },
};

const valid = { number: '4111 1111 1111 1111', name: 'MARIA', expiry: '08/29', cvc: '123' };

describe('máscaras do cartão (docs/05, "App — (3)")', () => {
  it('número em grupos de 4, até 19 dígitos', () => {
    expect(formatCardNumber('4111111111111111')).toBe('4111 1111 1111 1111');
    expect(formatCardNumber('4111-1111 11')).toBe('4111 1111 11');
    expect(formatCardNumber('1234567890123456789999')).toBe('1234 5678 9012 3456 789');
  });

  it('Amex em 4-6-5', () => {
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
  });

  it('validade MM/AA, código só com dígitos, nome em caixa alta', () => {
    expect(formatExpiry('0829')).toBe('08/29');
    expect(formatExpiry('08')).toBe('08');
    expect(formatCvc('12a34')).toBe('1234');
    expect(formatHolderName('maria s. 2 oliveira')).toBe('MARIA S.  OLIVEIRA');
  });
});

describe('validação do cartão', () => {
  it('Luhn: número com dígito errado é recusado', () => {
    expect(validateNumber('4111 1111 1111 1111')).toBeNull();
    expect(validateNumber('4111 1111 1111 1112')).toBe('Confira o número do cartão');
    expect(validateNumber('4111')).toBe('Confira o número do cartão');
  });

  it('validade: formato, mês e vencido (vale até o fim do mês)', () => {
    expect(validateExpiry('11/26', NOW)).toBeNull();
    expect(validateExpiry('10/26', NOW)).toBe('Este cartão está vencido');
    expect(validateExpiry('13/29', NOW)).toBe('Confira a validade');
    expect(validateExpiry('1/29', NOW)).toBe('Confira a validade');
  });

  it('CVV: 3 dígitos (4 no Amex)', () => {
    expect(validateCard({ ...valid, cvc: '12' }, NOW).cvc).toBe('Informe o código de segurança');
    expect(validateCard({ ...valid, cvc: '1234' }, NOW).cvc).toBe('Informe o código de segurança');
    expect(
      validateCard({ ...valid, number: '3782 822463 10005', cvc: '1234' }, NOW).cvc,
    ).toBeUndefined();
  });

  it('formulário vazio mostra todos os erros; preenchido não tem erro', () => {
    expect(Object.keys(validateCard(EMPTY_CARD, NOW))).toEqual(['number', 'name', 'expiry', 'cvc']);
    expect(validateCard(valid, NOW)).toEqual({});
  });
});

describe('token do cartão (RN-ONPAY-10)', () => {
  it('no ambiente de teste gera o token do contrato da PG.2, sem o número', () => {
    const result = tokenizeCard(valid, sandbox);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).not.toContain('4111111111111111');
    expect(parseFakeCardToken(result.token)).toEqual({
      scenario: 'approve',
      brand: 'visa',
      last4: '1111',
    });
  });

  it('sem o ambiente de teste (gateway real ainda sem SDK ou desligado) fica indisponível', () => {
    expect(tokenizeCard(valid, { provider: 'none', enabled: false, sandbox: null })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(tokenizeCard(valid, { provider: 'acme', enabled: true, sandbox: null })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(tokenizeCard(valid, null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('o chip do cartão de teste preenche com os dados da API, já com as máscaras', () => {
    const card = sandbox.sandbox.testCards[0];
    if (!card) throw new Error('sem cartão');
    expect(testCardValues(card)).toEqual({
      number: '4111 1111 1111 1111',
      name: 'MARIA S OLIVEIRA',
      expiry: '08/29',
      cvc: '123',
    });
  });
});

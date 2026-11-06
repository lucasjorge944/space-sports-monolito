// Contrato do ambiente de teste (decisão 92; docs/13 §10 e §13): os cartões de teste que a API expõe
// em `paymentEnvironment.sandbox.testCards` (quando o gateway é o `fake`) e o tokenizador que o app
// usa só nesse ambiente: troca o número digitado por um token de teste, e só o token vai para a API
// (RN-ONPAY-10). O adaptador fake da API lê o mesmo formato. Com um gateway real, o SDK do provedor
// gera o token no aparelho e nada daqui é usado.

/** Número → resultado simulado. Qualquer outro número válido é recusado. */
export const FAKE_TEST_CARDS = {
  '4111111111111111': 'approve',
  '4000000000000002': 'decline',
  '4000000000000259': 'chargeback',
} as const;
export type FakeCardScenario = (typeof FAKE_TEST_CARDS)[keyof typeof FAKE_TEST_CARDS];

/** Prefixo dos tokens de teste: `tok_fake_<cenário>_<bandeira>_<últimos 4>`. */
export const FAKE_CARD_TOKEN_PREFIX = 'tok_fake_';
const FAKE_TOKEN = /^tok_fake_(approve|decline|chargeback)_([a-z]+)_([0-9]{4})$/;

/** Dígito verificador de Luhn (número só com dígitos). */
export function isLuhnValid(digits: string): boolean {
  if (!/^[0-9]{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Bandeira pelo prefixo (o suficiente para o comprovante). */
export function cardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(digits))
    return 'elo';
  return 'other';
}

/** Token de teste para o número digitado (espaços e traços ignorados); nulo se não passar no Luhn. */
export function fakeCardToken(cardNumber: string): string | null {
  const digits = cardNumber.replace(/[\s-]/g, '');
  if (!isLuhnValid(digits)) return null;
  const scenario: FakeCardScenario =
    FAKE_TEST_CARDS[digits as keyof typeof FAKE_TEST_CARDS] ?? 'decline';
  return `${FAKE_CARD_TOKEN_PREFIX}${scenario}_${cardBrand(digits)}_${digits.slice(-4)}`;
}

/** Lê um token de teste; nulo se não for um. */
export function parseFakeCardToken(
  token: string,
): { scenario: FakeCardScenario; brand: string; last4: string } | null {
  const match = FAKE_TOKEN.exec(token);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { scenario: match[1] as FakeCardScenario, brand: match[2], last4: match[3] };
}

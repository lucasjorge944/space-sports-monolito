import { fakeCardToken, isLuhnValid } from '@space-sports/shared';

/**
 * Formulário do cartão (docs/05, "App — (3) Cartão de crédito"; RN-ONPAY-10): máscara, validação
 * e o token. Nada daqui é salvo: os dados ficam só no estado da tela e só o token vai para a API.
 */
export interface CardFormValues {
  number: string;
  name: string;
  expiry: string;
  cvc: string;
}

export type CardField = keyof CardFormValues;
export type CardErrors = Partial<Record<CardField, string>>;

export const EMPTY_CARD: CardFormValues = { number: '', name: '', expiry: '', cvc: '' };

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** Amex (34/37) tem 15 dígitos em 4-6-5 e código de 4. */
function isAmex(digits: string): boolean {
  return /^3[47]/.test(digits);
}

/** "4111111111111111" → "4111 1111 1111 1111"; Amex em 4-6-5; até 19 dígitos. */
export function formatCardNumber(value: string): string {
  const digits = digitsOf(value).slice(0, 19);
  if (isAmex(digits)) {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(' ');
  }
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "0829" → "08/29" (MM/AA). */
export function formatExpiry(value: string): string {
  const digits = digitsOf(value).slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function formatCvc(value: string): string {
  return digitsOf(value).slice(0, 4);
}

/** Nome impresso: caixa alta, sem números. */
export function formatHolderName(value: string): string {
  return value.replace(/[0-9]/g, '').toUpperCase();
}

export function validateNumber(value: string): string | null {
  const digits = digitsOf(value);
  const length = isAmex(digits) ? digits.length === 15 : digits.length >= 13;
  return length && isLuhnValid(digits) ? null : 'Confira o número do cartão';
}

export function validateName(value: string): string | null {
  return value.trim().length >= 2 ? null : 'Informe o nome como está no cartão';
}

/** MM/AA válido e não vencido (vale até o último dia do mês). */
export function validateExpiry(value: string, now: Date = new Date()): string | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return 'Confira a validade';
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return 'Confira a validade';
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return 'Este cartão está vencido';
  }
  if (year > currentYear + 20) return 'Confira a validade';
  return null;
}

export function validateCvc(value: string, cardNumber: string): string | null {
  const expected = isAmex(digitsOf(cardNumber)) ? 4 : 3;
  return digitsOf(value).length === expected ? null : 'Informe o código de segurança';
}

export function validateCardField(
  field: CardField,
  values: CardFormValues,
  now: Date = new Date(),
): string | null {
  switch (field) {
    case 'number':
      return validateNumber(values.number);
    case 'name':
      return validateName(values.name);
    case 'expiry':
      return validateExpiry(values.expiry, now);
    case 'cvc':
      return validateCvc(values.cvc, values.number);
  }
}

const FIELDS: CardField[] = ['number', 'name', 'expiry', 'cvc'];

/** Todos os erros (vazio = válido). */
export function validateCard(values: CardFormValues, now: Date = new Date()): CardErrors {
  const errors: CardErrors = {};
  for (const field of FIELDS) {
    const error = validateCardField(field, values, now);
    if (error) errors[field] = error;
  }
  return errors;
}

/** Ambiente de pagamento da API (o mesmo formato em todas as respostas). */
export interface PaymentEnvironmentLike {
  provider: string;
  enabled: boolean;
  sandbox: {
    testCards: {
      label: string;
      number: string;
      holderName: string;
      expiry: string;
      cvc: string;
    }[];
  } | null;
}

/**
 * O app consegue gerar o token do cartão neste ambiente? Hoje só com o tokenizador de teste
 * (`sandbox`); com um gateway real, quando o SDK do provedor entrar. Sem isso o cartão nem aparece.
 */
export function canTokenizeCard(environment: PaymentEnvironmentLike | null | undefined): boolean {
  return Boolean(environment?.enabled && environment.sandbox);
}

export type TokenizeResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unavailable' | 'invalid' };

/**
 * Gera o token do cartão no aparelho (RN-ONPAY-10). No ambiente de teste (`sandbox` vindo da API),
 * o token de teste do contrato da PG.2 (`fakeCardToken`); com um gateway real, o SDK do provedor
 * (ainda não integrado: o cartão fica indisponível). Nunca manda o número para a API.
 */
export function tokenizeCard(
  values: CardFormValues,
  environment: PaymentEnvironmentLike | null | undefined,
): TokenizeResult {
  if (!canTokenizeCard(environment)) return { ok: false, reason: 'unavailable' };
  const token = fakeCardToken(values.number);
  return token ? { ok: true, token } : { ok: false, reason: 'invalid' };
}

/** Preenche o formulário com um cartão de teste da API (só no ambiente de teste). */
export function testCardValues(card: {
  number: string;
  holderName: string;
  expiry: string;
  cvc: string;
}): CardFormValues {
  return {
    number: formatCardNumber(card.number),
    name: formatHolderName(card.holderName),
    expiry: formatExpiry(card.expiry),
    cvc: formatCvc(card.cvc),
  };
}

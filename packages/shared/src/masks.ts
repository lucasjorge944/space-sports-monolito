// Máscaras dos campos e normalização do que vai para a API. Funções puras, sem dependência de tela,
// para o web e o app digitarem do mesmo jeito. `mask*` aceita texto parcial (formata enquanto se
// digita); `normalize*` e `parse*` só aceitam o valor completo e devolvem `null` se ele não servir.

const digitsOf = (value: string) => value.replace(/\D/g, '');

/** `30130010` → `30130-010`. O valor para a API sai de `normalizeCep`. */
export function maskCep(value: string): string {
  const digits = digitsOf(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Dígitos locais (DDD + número) de um telefone brasileiro, com ou sem `+55`. */
function brazilianDigits(value: string): string {
  const digits = digitsOf(value);
  if (value.trim().startsWith('+')) return digits.slice(2);
  return digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
}

/**
 * Telefone BR enquanto se digita: `(31) 3333-4444` (fixo) e `(31) 99999-8888` (celular). Aceita E.164.
 * Número de outro país (começa com `+` e não é `+55`) só tem os dígitos preservados.
 */
export function maskPhone(value: string): string {
  const text = value.trim();
  const digits = digitsOf(text);
  if (text.startsWith('+') && !digits.startsWith('55')) return `+${digits.slice(0, 15)}`;
  if (text.startsWith('+') && digits.length <= 2) return `+${digits}`;

  const local = brazilianDigits(text).slice(0, 11);
  if (local.length === 0) return '';
  if (local.length <= 2) return `(${local}`;
  const ddd = local.slice(0, 2);
  const number = local.slice(2);
  if (number.length <= 4) return `(${ddd}) ${number}`;
  const prefix = number.length === 9 ? 5 : 4;
  return `(${ddd}) ${number.slice(0, prefix)}-${number.slice(prefix)}`;
}

/** Telefone digitado → E.164 (`+5531999998888`); `null` se não for um número completo. */
export function normalizePhone(value: string): string | null {
  const text = value.trim();
  const digits = digitsOf(text);
  if (text.startsWith('+') && !digits.startsWith('55')) {
    return E164.test(`+${digits}`) ? `+${digits}` : null;
  }
  const local = brazilianDigits(text);
  // DDD sem zero; celular com 9 na frente; fixo não começa com 0 nem 1.
  return /^[1-9]{2}(9[0-9]{8}|[2-9][0-9]{7})$/.test(local) ? `+55${local}` : null;
}

/** `12345678909` → `123.456.789-09`. */
export function maskCpf(value: string): string {
  const digits = digitsOf(value).slice(0, 11);
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  const body = groups.join('.');
  return digits.length > 9 ? `${body}-${digits.slice(9)}` : body;
}

/** Dígitos verificadores do módulo 11, com os pesos dados. */
function mod11(values: readonly number[], weights: readonly number[]): number {
  const total = values.reduce((sum, value, index) => sum + value * (weights[index] as number), 0);
  const rest = total % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CPF → 11 dígitos; `null` se incompleto ou com dígitos verificadores errados. */
export function normalizeCpf(value: string): string | null {
  const digits = digitsOf(value);
  if (!/^[0-9]{11}$/.test(digits) || /^(.)\1+$/.test(digits)) return null;
  const numbers = [...digits].map(Number);
  const first = mod11(numbers.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = mod11(numbers.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return numbers[9] === first && numbers[10] === second ? digits : null;
}

const cnpjChars = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * `12ABC34501DE35` → `12.ABC.345/01DE-35`. Desde julho de 2026 o CNPJ pode ter letras nos 12 primeiros
 * caracteres (IN RFB 2.229/2024); os 2 verificadores seguem numéricos.
 */
export function maskCnpj(value: string): string {
  const chars = cnpjChars(value);
  const base = chars.slice(0, 12);
  const check = digitsOf(chars.slice(12)).slice(0, 2);
  const groups = [base.slice(0, 2), base.slice(2, 5), base.slice(5, 8)].filter(Boolean);
  const body = groups.join('.');
  const branch = base.slice(8);
  if (!branch) return body;
  return check ? `${body}/${branch}-${check}` : `${body}/${branch}`;
}

const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** CNPJ → 14 caracteres; `null` se incompleto ou com dígitos verificadores errados. */
export function normalizeCnpj(value: string): string | null {
  const chars = cnpjChars(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(chars) || /^(.)\1+$/.test(chars)) return null;
  // O valor de cada caractere é o código ASCII menos 48: nos dígitos, é o próprio dígito.
  const values = [...chars].map((char) => char.charCodeAt(0) - 48);
  const first = mod11(values.slice(0, 12), CNPJ_WEIGHTS.slice(1));
  const second = mod11(values.slice(0, 13), CNPJ_WEIGHTS);
  return values[12] === first && values[13] === second ? chars : null;
}

/**
 * Reais enquanto se digita: `1500,5` → `1.500,5`. Só a vírgula separa os centavos; ponto é milhar,
 * exceto no fim do texto, porque há teclado numérico sem vírgula (`150.` → `150,`).
 */
export function maskMoney(value: string): string {
  const text = value.replace(/[^\d,.]/g, '').replace(/\.$/, ',');
  const comma = text.indexOf(',');
  const whole = digitsOf(comma < 0 ? text : text.slice(0, comma)).replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (comma < 0) return grouped;
  return `${grouped || '0'},${digitsOf(text.slice(comma + 1)).slice(0, 2)}`;
}

/**
 * Reais digitados → centavos, por texto (sem ponto flutuante); `null` se inválido.
 * Com vírgula, ela separa os centavos e os pontos são milhar (`1.500,50`). Sem vírgula, `1.500`
 * (grupos de 3 dígitos) é milhar = R$ 1.500,00, e `150.5`/`150.50` são decimais.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.]/g, '');
  if (!cleaned) return null;

  let whole: string;
  let fraction = '';
  const comma = cleaned.indexOf(',');
  if (comma >= 0) {
    whole = cleaned.slice(0, comma);
    fraction = cleaned.slice(comma + 1);
    if (fraction.includes(',') || fraction.includes('.')) return null;
    if (whole !== '' && !/^\d{1,3}(\.\d{3})+$|^\d+$/.test(whole)) return null;
    whole = whole.replace(/\./g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    whole = cleaned.replace(/\./g, '');
  } else {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
    if (!match) return null;
    whole = match[1] as string;
    fraction = match[2] ?? '';
  }
  if (fraction.length > 2 || (whole === '' && fraction === '')) return null;
  return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
}

/** Centavos → texto de campo (`150050` → `"1.500,50"`). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const whole = Math.trunc(cents / 100);
  return maskMoney(`${whole},${String(cents % 100).padStart(2, '0')}`);
}

/** Hora enquanto se digita: `1430` → `14:30`; primeiro dígito acima de 2 é a hora (`8` → `08`). */
export function maskTime(value: string): string {
  const raw = digitsOf(value);
  const digits = (/^[3-9]/.test(raw) ? `0${raw}` : raw).slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** Hora digitada → `HH:MM`, completando o que faltar (`8` → `08:00`, `14:3` → `14:30`); `null` se inválida. */
export function normalizeTime(value: string): string | null {
  const digits = digitsOf(maskTime(value));
  if (!digits) return null;
  const full = (digits.length === 1 ? `0${digits}` : digits).padEnd(4, '0');
  const match = /^([01][0-9]|2[0-3])([0-5][0-9])$/.exec(full);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** Data enquanto se digita: `28102026` → `28/10/2026`. Aceita colar `2026-10-28`. */
export function maskDate(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  const digits = iso ? `${iso[3]}${iso[2]}${iso[1]}` : digitsOf(value).slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** `dd/mm/aaaa` → `aaaa-mm-dd` (o formato da API); `null` se incompleta ou se o dia não existir. */
export function parseDateInput(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const iso = `${year}-${month}-${day}`;
  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** `aaaa-mm-dd` → `dd/mm/aaaa`; vazio continua vazio. */
export function dateToInput(date: string | null | undefined): string {
  return date ? maskDate(date) : '';
}

/** Só dígitos, para quantidades e dias (o `type="number"` traz setas e aceita `e`). */
export function maskInteger(value: string): string {
  return digitsOf(value);
}

/**
 * Percentual enquanto se digita (taxas do Super): `4,5` → `4,5`, até `100` e 2 casas. Ponto no fim
 * vira vírgula, como em `maskMoney` (teclado numérico sem vírgula).
 */
export function maskPercent(value: string): string {
  const text = value.replace(/[^\d,.]/g, '').replace(/\./g, ',');
  const comma = text.indexOf(',');
  const whole = digitsOf(comma < 0 ? text : text.slice(0, comma))
    .replace(/^0+(?=\d)/, '')
    .slice(0, 3);
  if (comma < 0) return whole;
  return `${whole || '0'},${digitsOf(text.slice(comma + 1)).slice(0, 2)}`;
}

/**
 * Percentual digitado → pontos-base inteiros (`4,5` → 450; `6` → 600; `0,99` → 99), por texto e
 * sem ponto flutuante; `null` se inválido ou acima de 100%.
 */
export function parsePercentToBps(input: string): number | null {
  const match = /^(\d{1,3})(?:[,.](\d{0,2}))?%?$/.exec(input.trim().replace(/\s/g, ''));
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** Pontos-base → texto de campo (`450` → `"4,5"`, `400` → `"4"`, `99` → `"0,99"`). */
export function bpsToInput(bps: number | null | undefined): string {
  if (bps == null) return '';
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : String(whole);
}

/** Pontos-base para exibição: `450` → `"4,5%"`. */
export function formatBpsPercent(bps: number): string {
  return `${bpsToInput(bps)}%`;
}

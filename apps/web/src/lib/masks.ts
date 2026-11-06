import {
  centsToInput,
  maskCep,
  maskCnpj,
  maskCpf,
  maskDate,
  maskInteger,
  maskMoney,
  maskPercent,
  maskPhone,
  maskTime,
  parseMoneyToCents,
} from '@space-sports/shared';

type MaskConfig = {
  format: (value: string) => string;
  /** Caracteres que o usuário digitou, em oposição aos que a máscara acrescenta. */
  typed: RegExp;
  inputMode: 'numeric' | 'decimal' | 'tel' | 'text';
  type?: 'tel';
  placeholder?: string;
  /** Texto colado, quando a leitura difere da digitação (ex.: `150.5` é decimal, não milhar). */
  paste?: (value: string) => string | null;
  /** Completa o valor ao sair do campo (ex.: `150` → `150,00`). */
  finish?: (value: string) => string;
};

const moneyToInput = (value: string) => {
  const cents = parseMoneyToCents(value);
  return cents === null ? null : centsToInput(cents);
};

export const MASKS = {
  cep: { format: maskCep, typed: /\d/, inputMode: 'numeric', placeholder: '00000-000' },
  phone: {
    format: maskPhone,
    typed: /\d/,
    inputMode: 'tel',
    type: 'tel',
    placeholder: '(31) 99999-8888',
  },
  cpf: { format: maskCpf, typed: /\d/, inputMode: 'numeric', placeholder: '000.000.000-00' },
  // Desde 2026 o CNPJ pode ter letras, então o teclado não pode ser só numérico.
  cnpj: {
    format: maskCnpj,
    typed: /[0-9a-z]/i,
    inputMode: 'text',
    placeholder: '00.000.000/0000-00',
  },
  money: {
    format: maskMoney,
    typed: /[\d,]/,
    inputMode: 'decimal',
    placeholder: '0,00',
    paste: moneyToInput,
    finish: (value) => moneyToInput(value) ?? value,
  },
  time: { format: maskTime, typed: /\d/, inputMode: 'numeric', placeholder: '00:00' },
  date: { format: maskDate, typed: /\d/, inputMode: 'numeric', placeholder: 'dd/mm/aaaa' },
  integer: { format: maskInteger, typed: /\d/, inputMode: 'numeric' },
  // Taxas do Super: até 100 e 2 casas (`4,5`), gravadas em pontos-base.
  percent: { format: maskPercent, typed: /[\d,]/, inputMode: 'decimal', placeholder: '0,00' },
} satisfies Record<string, MaskConfig>;

export type MaskName = keyof typeof MASKS;

/** Quantos caracteres digitados há antes do cursor. */
export function typedBefore(text: string, caret: number, typed: RegExp): number {
  return [...text.slice(0, caret)].filter((char) => typed.test(char)).length;
}

/** Posição do cursor no texto mascarado, logo depois do n-ésimo caractere digitado. */
export function caretAfterTyped(masked: string, count: number, typed: RegExp): number {
  let seen = 0;
  for (let index = 0; index < masked.length; index++) {
    if (seen === count) return index;
    if (typed.test(masked[index] as string)) seen++;
  }
  return masked.length;
}

/** Aplica a máscara mantendo o cursor no mesmo caractere digitado, e no fim se já estava no fim. */
export function applyMask(
  name: MaskName,
  raw: string,
  caret: number,
  pasted: boolean,
): { value: string; caret: number } {
  const config: MaskConfig = MASKS[name];
  const value = (pasted ? config.paste?.(raw) : null) ?? config.format(raw);
  if (caret >= raw.length) return { value, caret: value.length };
  return {
    value,
    caret: caretAfterTyped(value, typedBefore(raw, caret, config.typed), config.typed),
  };
}

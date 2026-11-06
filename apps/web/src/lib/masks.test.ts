import { describe, expect, it } from 'vitest';
import { applyMask, caretAfterTyped, MASKS, typedBefore } from './masks';

describe('applyMask', () => {
  it('digitando no fim, o cursor acompanha o que a máscara acrescenta', () => {
    expect(applyMask('phone', '319', 3, false)).toEqual({ value: '(31) 9', caret: 6 });
    expect(applyMask('cep', '301300', 6, false)).toEqual({ value: '30130-0', caret: 7 });
    expect(applyMask('money', '1500', 4, false)).toEqual({ value: '1.500', caret: 5 });
    expect(applyMask('time', '8', 1, false)).toEqual({ value: '08', caret: 2 });
  });

  it('editando no meio, o cursor fica no mesmo dígito', () => {
    // "(31) 99999-8888" com um 7 inserido depois do DDD: "(31) 799999-8888".
    expect(applyMask('phone', '(31) 799999-8888', 6, false)).toEqual({
      value: '(31) 79999-9888',
      caret: 6,
    });
    // Apagar no milhar não pula para o fim: "1.234.567" sem o 3 vira "124.567".
    expect(applyMask('money', '1.24.567', 3, false)).toEqual({ value: '124.567', caret: 2 });
  });

  it('apagar o separador da máscara não prende o cursor', () => {
    // Backspace logo depois do espaço em "(31) 9": o cursor volta para trás do DDD.
    const { value, caret } = applyMask('phone', '(31)9', 4, false);
    expect(value).toBe('(31) 9');
    expect(caret).toBe(3);
  });

  it('caractere fora da máscara não entra e o cursor não anda', () => {
    expect(applyMask('cep', '301a30', 4, false)).toEqual({ value: '30130', caret: 3 });
    expect(applyMask('integer', '1e5', 2, false)).toEqual({ value: '15', caret: 1 });
  });

  it('dinheiro colado com ponto decimal não vira milhar', () => {
    expect(applyMask('money', '150.5', 5, true).value).toBe('150,50');
    expect(applyMask('money', 'R$ 1.500,00', 11, true).value).toBe('1.500,00');
    expect(applyMask('money', '150.5', 5, false).value).toBe('1.505');
  });
});

describe('fim da digitação', () => {
  it('dinheiro ganha os centavos ao sair do campo', () => {
    expect(MASKS.money.finish('150')).toBe('150,00');
    expect(MASKS.money.finish('1.500,5')).toBe('1.500,50');
    expect(MASKS.money.finish('')).toBe('');
  });
});

describe('cursor', () => {
  it('conta só o que foi digitado', () => {
    expect(typedBefore('(31) 9', 4, /\d/)).toBe(2);
    expect(caretAfterTyped('(31) 99999-8888', 2, /\d/)).toBe(3);
    expect(caretAfterTyped('(31) 9', 0, /\d/)).toBe(0);
    expect(caretAfterTyped('123', 9, /\d/)).toBe(3);
  });
});

describe('teclado', () => {
  it('cada máscara pede o teclado certo', () => {
    expect(MASKS.cep.inputMode).toBe('numeric');
    expect(MASKS.phone.inputMode).toBe('tel');
    expect(MASKS.money.inputMode).toBe('decimal');
    expect(MASKS.time.inputMode).toBe('numeric');
  });
});

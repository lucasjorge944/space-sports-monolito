import { formatBirthDate, maskBirthDate, parseBirthDate, validateBirthDate } from './birth-date';

describe('data de nascimento (decisão 68)', () => {
  it('máscara dd/mm/aaaa enquanto se digita', () => {
    expect(maskBirthDate('0')).toBe('0');
    expect(maskBirthDate('0102')).toBe('01/02');
    expect(maskBirthDate('01021990')).toBe('01/02/1990');
    expect(maskBirthDate('01/02/19901')).toBe('01/02/1990');
  });

  it('converte para a data civil da API e volta', () => {
    expect(parseBirthDate('01/02/1990')).toBe('1990-02-01');
    expect(formatBirthDate('1990-02-01')).toBe('01/02/1990');
    expect(formatBirthDate(null)).toBe('');
  });

  it('é opcional, mas preenchida precisa ser válida', () => {
    expect(validateBirthDate('')).toBeNull();
    expect(validateBirthDate('01/02/1990')).toBeNull();
    expect(validateBirthDate('01/02')).toBe('Use o formato dd/mm/aaaa');
    expect(validateBirthDate('31/02/1990')).toBe('Confira a data');
    expect(validateBirthDate('31/12/1899')).toBe('Use uma data a partir de 1900');
    expect(validateBirthDate('01/01/2999')).toBe('A data não pode ser no futuro');
    expect(parseBirthDate('31/02/1990')).toBeNull();
  });
});

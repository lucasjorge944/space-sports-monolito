import { describe, expect, it } from 'vitest';
import { normalizeCep } from './address';
import {
  bpsToInput,
  centsToInput,
  dateToInput,
  formatBpsPercent,
  maskCep,
  maskCnpj,
  maskCpf,
  maskDate,
  maskInteger,
  maskMoney,
  maskPercent,
  maskPhone,
  maskTime,
  normalizeCnpj,
  normalizeCpf,
  normalizePhone,
  normalizeTime,
  parseDateInput,
  parseMoneyToCents,
  parsePercentToBps,
} from './masks';

describe('CEP', () => {
  it('formata enquanto digita e corta no oitavo dígito', () => {
    expect(maskCep('')).toBe('');
    expect(maskCep('30130')).toBe('30130');
    expect(maskCep('301300')).toBe('30130-0');
    expect(maskCep('30130010')).toBe('30130-010');
    expect(maskCep('30130-0109999')).toBe('30130-010');
    expect(maskCep('abc')).toBe('');
  });

  it('o valor mascarado normaliza para os 8 dígitos', () => {
    expect(normalizeCep(maskCep('30130010'))).toBe('30130010');
    expect(normalizeCep(maskCep('3013'))).toBeNull();
  });
});

describe('telefone', () => {
  it('formata fixo e celular enquanto digita', () => {
    expect(maskPhone('3')).toBe('(3');
    expect(maskPhone('31')).toBe('(31');
    expect(maskPhone('319')).toBe('(31) 9');
    expect(maskPhone('313333')).toBe('(31) 3333');
    expect(maskPhone('3133334')).toBe('(31) 3333-4');
    expect(maskPhone('3133334444')).toBe('(31) 3333-4444');
    expect(maskPhone('31999998888')).toBe('(31) 99999-8888');
    expect(maskPhone('319999988881')).toBe('(31) 99999-8888');
  });

  it('o celular muda de formato ao entrar o 11º dígito', () => {
    expect(maskPhone('(31) 9999-9888')).toBe('(31) 9999-9888');
    expect(maskPhone('(31) 9999-98888')).toBe('(31) 99999-8888');
  });

  it('aceita E.164 e preserva número de outro país', () => {
    expect(maskPhone('+5531999998888')).toBe('(31) 99999-8888');
    expect(maskPhone('5531999998888')).toBe('(31) 99999-8888');
    expect(maskPhone('+55')).toBe('+55');
    expect(maskPhone('+14155552671')).toBe('+14155552671');
  });

  it('apagar não trava no hífen nem no parêntese', () => {
    expect(maskPhone('(31) 9999-')).toBe('(31) 9999');
    expect(maskPhone('(31) ')).toBe('(31');
    expect(maskPhone('(')).toBe('');
  });

  it('DDD 55 sem DDI continua sendo DDD', () => {
    expect(maskPhone('55999998888')).toBe('(55) 99999-8888');
    expect(maskPhone('553132221234')).toBe('(31) 3222-1234');
  });

  it('digitando o DDI com +', () => {
    expect(maskPhone('+')).toBe('+');
    expect(maskPhone('+553')).toBe('(3');
    expect(maskPhone('+1 415 555 0132')).toBe('+14155550132');
  });

  it('normaliza para E.164', () => {
    expect(normalizePhone('(31) 99999-8888')).toBe('+5531999998888');
    expect(normalizePhone('(31) 3333-4444')).toBe('+553133334444');
    expect(normalizePhone('+55 31 99999-8888')).toBe('+5531999998888');
    expect(normalizePhone('5531999998888')).toBe('+5531999998888');
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  it('recusa número incompleto ou impossível', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('(31) 9999-888')).toBeNull();
    expect(normalizePhone('(31) 89999-8888')).toBeNull();
    expect(normalizePhone('(31) 1333-4444')).toBeNull();
    expect(normalizePhone('(01) 99999-8888')).toBeNull();
    expect(normalizePhone('+1')).toBeNull();
  });
});

describe('CPF', () => {
  it('formata enquanto digita', () => {
    expect(maskCpf('123')).toBe('123');
    expect(maskCpf('1234')).toBe('123.4');
    expect(maskCpf('1234567')).toBe('123.456.7');
    expect(maskCpf('1234567890')).toBe('123.456.789-0');
    expect(maskCpf('123456789099')).toBe('123.456.789-09');
  });

  it('confere os dígitos verificadores', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf('529.982.247-24')).toBeNull();
    expect(normalizeCpf('111.111.111-11')).toBeNull();
    expect(normalizeCpf('529.982')).toBeNull();
  });
});

describe('CNPJ', () => {
  it('formata enquanto digita', () => {
    expect(maskCnpj('11')).toBe('11');
    expect(maskCnpj('11222')).toBe('11.222');
    expect(maskCnpj('11222333')).toBe('11.222.333');
    expect(maskCnpj('112223330001')).toBe('11.222.333/0001');
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('aceita letras na base, em maiúsculas, mas não nos verificadores', () => {
    expect(maskCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(maskCnpj('12abc34501dex5')).toBe('12.ABC.345/01DE-5');
  });

  it('confere os dígitos verificadores', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCnpj('11.222.333/0001-82')).toBeNull();
    expect(normalizeCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(normalizeCnpj('12.ABC.345/01DE-36')).toBeNull();
    expect(normalizeCnpj('00.000.000/0000-00')).toBeNull();
    expect(normalizeCnpj('11.222')).toBeNull();
  });
});

describe('dinheiro', () => {
  it('agrupa o milhar enquanto digita, sem mudar o que foi digitado', () => {
    expect(maskMoney('')).toBe('');
    expect(maskMoney('5')).toBe('5');
    expect(maskMoney('1500')).toBe('1.500');
    expect(maskMoney('1.5000')).toBe('15.000');
    expect(maskMoney('1234567,8')).toBe('1.234.567,8');
    expect(maskMoney('150,505')).toBe('150,50');
  });

  it('apagar um dígito reagrupa em vez de virar decimal', () => {
    expect(maskMoney('1.50')).toBe('150');
  });

  it('o ponto no fim vale como vírgula', () => {
    expect(maskMoney('150.')).toBe('150,');
    expect(maskMoney(',5')).toBe('0,5');
    expect(maskMoney('007')).toBe('7');
    expect(maskMoney('R$ 12a')).toBe('12');
  });

  it('converte reais digitados em centavos', () => {
    expect(parseMoneyToCents('150')).toBe(15000);
    expect(parseMoneyToCents('150,50')).toBe(15050);
    expect(parseMoneyToCents('1.500,00')).toBe(150000);
    expect(parseMoneyToCents('R$ 99,9')).toBe(9990);
    expect(parseMoneyToCents('')).toBeNull();
    // Ponto sem vírgula: grupos de 3 dígitos são milhar, não decimal.
    expect(parseMoneyToCents('1.500')).toBe(150000);
    expect(parseMoneyToCents('1.500,5')).toBe(150050);
    expect(parseMoneyToCents('1.250')).toBe(125000);
    expect(parseMoneyToCents('0,07')).toBe(7);
    expect(parseMoneyToCents('150.5')).toBe(15050);
    expect(parseMoneyToCents('19,99')).toBe(1999);
    expect(parseMoneyToCents('1,234')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
  });

  it('centavos voltam para o campo, sem ponto flutuante', () => {
    expect(centsToInput(15050)).toBe('150,50');
    expect(centsToInput(150050)).toBe('1.500,50');
    expect(centsToInput(7)).toBe('0,07');
    expect(centsToInput(0)).toBe('0,00');
    expect(centsToInput(null)).toBe('');
    expect(parseMoneyToCents(centsToInput(123456))).toBe(123456);
  });
});

describe('hora', () => {
  it('formata enquanto digita', () => {
    expect(maskTime('1')).toBe('1');
    expect(maskTime('14')).toBe('14');
    expect(maskTime('143')).toBe('14:3');
    expect(maskTime('1430')).toBe('14:30');
    expect(maskTime('14305')).toBe('14:30');
    expect(maskTime('8')).toBe('08');
    expect(maskTime('830')).toBe('08:30');
  });

  it('normaliza e completa o que faltou', () => {
    expect(normalizeTime('14:30')).toBe('14:30');
    expect(normalizeTime('14:3')).toBe('14:30');
    expect(normalizeTime('14')).toBe('14:00');
    expect(normalizeTime('8')).toBe('08:00');
    expect(normalizeTime('1')).toBe('01:00');
    expect(normalizeTime('00:00')).toBe('00:00');
    expect(normalizeTime('23:59')).toBe('23:59');
  });

  it('recusa hora que não existe', () => {
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('12:60')).toBeNull();
  });
});

describe('data', () => {
  it('formata enquanto digita e aceita colar o formato da API', () => {
    expect(maskDate('2')).toBe('2');
    expect(maskDate('281')).toBe('28/1');
    expect(maskDate('28102')).toBe('28/10/2');
    expect(maskDate('28102026')).toBe('28/10/2026');
    expect(maskDate('281020269')).toBe('28/10/2026');
    expect(maskDate('2026-10-28')).toBe('28/10/2026');
  });

  it('converte para o formato da API e volta', () => {
    expect(parseDateInput('28/10/2026')).toBe('2026-10-28');
    expect(dateToInput('2026-10-28')).toBe('28/10/2026');
    expect(dateToInput('')).toBe('');
    expect(dateToInput(null)).toBe('');
  });

  it('recusa dia que não existe e data incompleta', () => {
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('29/02/2026')).toBeNull();
    expect(parseDateInput('29/02/2028')).toBe('2028-02-29');
    expect(parseDateInput('10/13/2026')).toBeNull();
    expect(parseDateInput('28/10')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});

describe('número inteiro', () => {
  it('só dígitos', () => {
    expect(maskInteger('12a-3')).toBe('123');
    expect(maskInteger('1e5')).toBe('15');
    expect(maskInteger('')).toBe('');
  });
});

describe('percentual (taxas em pontos-base)', () => {
  it('formata enquanto digita', () => {
    expect(maskPercent('4')).toBe('4');
    expect(maskPercent('4,')).toBe('4,');
    expect(maskPercent('4.5')).toBe('4,5');
    expect(maskPercent('4,567')).toBe('4,56');
    expect(maskPercent('1234')).toBe('123');
    expect(maskPercent(',5')).toBe('0,5');
  });

  it('converte para pontos-base inteiros', () => {
    expect(parsePercentToBps('4')).toBe(400);
    expect(parsePercentToBps('4,5')).toBe(450);
    expect(parsePercentToBps('0,99')).toBe(99);
    expect(parsePercentToBps('3.49')).toBe(349);
    expect(parsePercentToBps('100')).toBe(10_000);
    expect(parsePercentToBps('6%')).toBe(600);
  });

  it('recusa acima de 100% e texto inválido', () => {
    expect(parsePercentToBps('100,01')).toBeNull();
    expect(parsePercentToBps('4,555')).toBeNull();
    expect(parsePercentToBps('abc')).toBeNull();
    expect(parsePercentToBps('')).toBeNull();
  });

  it('volta para o campo e para a tela', () => {
    expect(bpsToInput(450)).toBe('4,5');
    expect(bpsToInput(400)).toBe('4');
    expect(bpsToInput(99)).toBe('0,99');
    expect(bpsToInput(null)).toBe('');
    expect(formatBpsPercent(349)).toBe('3,49%');
  });
});

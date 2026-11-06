import { describe, expect, it } from 'vitest';
import {
  attendanceCancelSummary,
  attendanceWindowSummary,
  formatSpan,
  spanToMinutes,
  splitMinutes,
} from './time-span';

describe('splitMinutes', () => {
  it('escolhe a maior unidade sem fração', () => {
    expect(splitMinutes('2880')).toEqual({ amount: '2', unit: 'DAYS' });
    expect(splitMinutes('180')).toEqual({ amount: '3', unit: 'HOURS' });
    expect(splitMinutes('90')).toEqual({ amount: '90', unit: 'MINUTES' });
    expect(splitMinutes('0')).toEqual({ amount: '0', unit: 'MINUTES' });
  });

  it('valor vazio ou inválido deixa o campo vazio', () => {
    expect(splitMinutes('')).toEqual({ amount: '', unit: 'MINUTES' });
    expect(splitMinutes('abc')).toEqual({ amount: '', unit: 'MINUTES' });
  });
});

describe('spanToMinutes', () => {
  it('converte para os minutos da API', () => {
    expect(spanToMinutes({ amount: '2', unit: 'DAYS' })).toBe('2880');
    expect(spanToMinutes({ amount: '12', unit: 'HOURS' })).toBe('720');
    expect(spanToMinutes({ amount: '45', unit: 'MINUTES' })).toBe('45');
  });

  it('volta ao mesmo valor que veio da API', () => {
    for (const minutes of ['0', '30', '60', '90', '1440', '1500', '43200']) {
      expect(spanToMinutes(splitMinutes(minutes))).toBe(minutes);
    }
  });

  it('sem número, fica vazio para o formulário acusar', () => {
    expect(spanToMinutes({ amount: '', unit: 'HOURS' })).toBe('');
  });
});

describe('formatSpan', () => {
  it('escreve no singular e no plural', () => {
    expect(formatSpan(60)).toBe('1 hora');
    expect(formatSpan(2880)).toBe('2 dias');
    expect(formatSpan(1)).toBe('1 minuto');
    expect(formatSpan(0)).toBe('0 minutos');
  });

  it('combina as unidades', () => {
    expect(formatSpan(90)).toBe('1 hora e 30 minutos');
    expect(formatSpan(1500)).toBe('1 dia e 1 hora');
    expect(formatSpan(1530)).toBe('1 dia, 1 hora e 30 minutos');
  });
});

describe('resumo da lista de presença', () => {
  it('monta a frase em linguagem natural', () => {
    expect(attendanceWindowSummary('2880', '60')).toBe(
      'A lista abre 2 dias antes da aula e fecha 1 hora antes',
    );
  });

  it('zero é a hora da aula', () => {
    expect(attendanceWindowSummary('1440', '0')).toBe(
      'A lista abre 1 dia antes da aula e fecha na hora da aula',
    );
    expect(attendanceWindowSummary('0', '0')).toBe('A lista abre e fecha na hora da aula');
  });

  it('sem um dos tempos não há frase', () => {
    expect(attendanceWindowSummary('', '60')).toBeNull();
  });

  it('descreve o prazo de desistência', () => {
    expect(attendanceCancelSummary('180')).toBe('O aluno pode desistir até 3 horas antes da aula');
    expect(attendanceCancelSummary('0')).toBe('O aluno pode desistir até a hora da aula');
    expect(attendanceCancelSummary('')).toBeNull();
  });
});

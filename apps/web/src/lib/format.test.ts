import { describe, expect, it } from 'vitest';
import {
  formatCsvMoney,
  formatDate,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatLocalDate,
  formatPhone,
  formatTime,
  startOfMonthLocal,
  todayLocal,
} from './format';

describe('format', () => {
  it('exibe instantes UTC em America/Sao_Paulo, com o ano em quatro dígitos', () => {
    // 02:30 UTC = 23:30 do dia anterior em Brasília (UTC-3).
    expect(formatDateTime('2026-10-28T02:30:00.000Z')).toBe('27/10/2026, 23:30');
    expect(formatDate('2026-10-28T02:30:00.000Z')).toBe('27/10/2026');
    expect(formatTime('2026-10-28T17:30:00Z')).toBe('14:30');
  });

  it('formata dia local sem aplicar fuso', () => {
    expect(formatLocalDate('2026-10-01')).toBe('01/10/2026');
  });

  it('usa o dia local para o padrão do período', () => {
    const now = new Date('2026-11-01T01:00:00.000Z'); // ainda 31/10 em Brasília
    expect(todayLocal(now)).toBe('2026-10-31');
    expect(startOfMonthLocal(now)).toBe('2026-10-01');
    expect(todayLocal(new Date('2026-10-29T12:00:00Z'))).toBe('2026-10-29');
  });

  it('mostra traço quando não há data', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('formata dia da semana e duração', () => {
    expect(formatDayLabel('2026-10-28')).toBe('Qua, 28/10/2026');
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(30)).toBe('30min');
  });

  it('formata valor de CSV e telefone', () => {
    expect(formatCsvMoney(15050)).toBe('150,50');
    expect(formatPhone('+5531999998888')).toBe('(31) 99999-8888');
    expect(formatPhone('+553133334444')).toBe('(31) 3333-4444');
    expect(formatPhone(null)).toBe('');
  });
});

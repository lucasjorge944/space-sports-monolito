import { describe, expect, it } from 'vitest';
import { formatWhen } from './booking-notifier.js';

describe('formatWhen', () => {
  it('mostra dia da semana, data e hora no fuso do espaço', () => {
    // 2030-05-09 01:30 UTC = quarta, 08/05, 22:30 em São Paulo.
    expect(formatWhen(new Date('2030-05-09T01:30:00Z'), 'America/Sao_Paulo')).toBe(
      'qua., 08/05/2030 às 22:30',
    );
    expect(formatWhen(new Date('2030-05-09T01:30:00Z'), 'America/Manaus')).toBe(
      'qua., 08/05/2030 às 21:30',
    );
  });
});

import type { StatementEntry } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import {
  defaultStatementRange,
  splitReversed,
  statementBounds,
  statementCsvFilename,
  statementEntryLabel,
  withBom,
} from './statement';

const entry = (over: Partial<StatementEntry>) =>
  ({
    id: 'e',
    payableType: 'BOOKING',
    service: 'RENTAL',
    reversedAt: null,
    bookingStartsAt: null,
    chargePeriodStart: null,
    courtName: null,
    ...over,
  }) as StatementEntry;

describe('statementBounds', () => {
  it('converte datas locais (inclusivas) em [from, to) UTC de São Paulo', () => {
    expect(statementBounds('2026-10-01', '2026-10-31')).toEqual({
      from: '2026-10-01T03:00:00.000Z',
      to: '2026-11-01T03:00:00.000Z',
    });
  });

  it('um único dia cobre 24h', () => {
    expect(statementBounds('2026-10-28', '2026-10-28')).toEqual({
      from: '2026-10-28T03:00:00.000Z',
      to: '2026-10-29T03:00:00.000Z',
    });
  });

  it('rejeita intervalo invertido ou vazio', () => {
    expect(statementBounds('2026-10-29', '2026-10-28')).toBeNull();
    expect(statementBounds('', '2026-10-28')).toBeNull();
  });
});

describe('defaultStatementRange', () => {
  it('vai do dia 1º do mês até hoje no fuso de São Paulo', () => {
    // 29/10 01:00 UTC ainda é 28/10 em São Paulo.
    expect(defaultStatementRange(new Date('2026-10-29T01:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-28',
    });
  });
});

describe('statementEntryLabel', () => {
  it('descreve mensalidade com mês e quadra', () => {
    expect(
      statementEntryLabel(
        entry({
          service: 'RECURRING',
          payableType: 'RECURRING_BOOKING_CHARGE',
          chargePeriodStart: '2026-10-01',
          courtName: 'Quadra 1',
        }),
      ),
    ).toBe('Mensalidade 10/2026 · Quadra 1');
  });

  it('descreve a mensalidade de aula com mês e plano', () => {
    expect(
      statementEntryLabel(
        entry({
          service: 'CLASS',
          payableType: 'SUBSCRIPTION_CHARGE',
          chargePeriodStart: '2026-10-01',
          planName: 'Futevôlei 2x por semana',
        }),
      ),
    ).toBe('Mensalidade 10/2026 · Futevôlei 2x por semana');
    expect(statementEntryLabel(entry({ service: 'CLASS' }))).toBe('Mensalidade');
  });

  it('descreve reserva e parte da conta', () => {
    expect(
      statementEntryLabel(
        entry({ bookingStartsAt: '2026-10-28T15:00:00Z', courtName: 'Quadra 2' }),
      ),
    ).toBe('Reserva 28/10/2026, 12:00 · Quadra 2');
    expect(statementEntryLabel(entry({ payableType: 'BOOKING_PARTICIPANT' }))).toBe(
      'Parte da reserva',
    );
  });
});

describe('splitReversed / withBom / filename', () => {
  it('separa estornados', () => {
    const a = entry({ id: 'a' });
    const b = entry({ id: 'b', reversedAt: '2026-10-28T12:00:00Z' });
    expect(splitReversed([a, b])).toEqual({ active: [a], reversed: [b] });
  });

  it('acrescenta o BOM uma única vez', () => {
    expect(withBom('a')).toBe('﻿a');
    expect(withBom('﻿a')).toBe('﻿a');
  });

  it('nomeia o arquivo pelo período', () => {
    expect(statementCsvFilename('2026-10-01', '2026-10-28')).toBe(
      'extrato-2026-10-01-a-2026-10-28.csv',
    );
  });
});

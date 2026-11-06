import { describe, expect, it } from 'vitest';
import {
  type AttendanceSettings,
  type EnrollmentState,
  enrollmentBlock,
} from './attendance-rules.js';

const settings = (timeZone = 'America/Sao_Paulo'): AttendanceSettings => ({
  timeZone,
  mode: 'AUTOMATIC',
  openBeforeMin: 1440,
  closeBeforeMin: 60,
  cancelDeadlineMin: 120,
  pastDueBlockEnabled: true,
  pastDueBlockDays: 7,
});

const state = (overrides: Partial<EnrollmentState> = {}): EnrollmentState => ({
  userId: 'u',
  classGroupId: 'g',
  subscriptionId: 's',
  subscriptionStatus: 'ACTIVE',
  endsOn: null,
  oldestUnpaidDue: null,
  ...overrides,
});

describe('enrollmentBlock', () => {
  // Aula de 06/11 às 07:00 em BH; agora é 05/11 às 07:00 (lista aberta 24 h antes).
  const startsAt = new Date('2026-11-06T10:00:00Z');
  const now = new Date('2026-11-05T10:00:00Z');

  it('RN-CLASS-08: bloqueia só a aula depois do último dia de acesso', () => {
    const ending = (endsOn: string | null) =>
      enrollmentBlock([state({ endsOn })], startsAt, now, settings());
    expect(ending(null)).toBeNull();
    expect(ending('2026-11-06')).toBeNull();
    expect(ending('2026-11-05')).toBe('SUBSCRIPTION_ACCESS_ENDED');
  });

  it('datas no fuso do espaço: 23:50 de 10/11 em Manaus é 00:50 de 11/11 em BH', () => {
    const late = new Date('2026-11-11T03:50:00Z');
    const lateNow = new Date('2026-11-11T03:30:00Z');
    const ending = [state({ endsOn: '2026-11-10' })];
    expect(enrollmentBlock(ending, late, lateNow, settings('America/Manaus'))).toBeNull();
    expect(enrollmentBlock(ending, late, lateNow, settings())).toBe('SUBSCRIPTION_ACCESS_ENDED');
    // Vencida em 03/11: 7º dia em Manaus (libera), 8º em BH (bloqueia).
    const overdue = [state({ oldestUnpaidDue: '2026-11-03' })];
    expect(enrollmentBlock(overdue, late, lateNow, settings('America/Manaus'))).toBeNull();
    expect(enrollmentBlock(overdue, late, lateNow, settings())).toBe('SUBSCRIPTION_PAST_DUE');
  });
});

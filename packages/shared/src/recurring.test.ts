import { describe, expect, it } from 'vitest';
import {
  createDeskRecurringBookingSchema,
  requestRecurringBookingSchema,
  weekdayDates,
} from './recurring';

const uuid = '0198f3a0-0000-7000-8000-000000000001';
const slot = {
  courtId: uuid,
  sportId: uuid,
  weekday: 2,
  startTime: '19:30',
  durationMin: 90,
  peopleCount: 4,
};

describe('weekdayDates', () => {
  it('lista as datas do dia da semana no intervalo, inclusive', () => {
    // 2026-11-02 é segunda; terça = 2.
    expect(weekdayDates(2, '2026-11-02', '2026-11-24')).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
  });

  it('inclui a própria data de início quando ela cai no dia', () => {
    expect(weekdayDates(1, '2026-11-02', '2026-11-02')).toEqual(['2026-11-02']);
  });

  it('intervalo sem o dia da semana ou invertido devolve vazio', () => {
    expect(weekdayDates(5, '2026-11-02', '2026-11-05')).toEqual([]);
    expect(weekdayDates(1, '2026-11-10', '2026-11-02')).toEqual([]);
  });
});

describe('schemas de entrada', () => {
  it('aceita horário em hora cheia ou meia hora e rejeita o resto', () => {
    const ok = requestRecurringBookingSchema.safeParse({ spaceId: uuid, ...slot });
    expect(ok.success).toBe(true);
    for (const startTime of ['19:15', '7:30', '24:00', '19:30:00']) {
      expect(
        requestRecurringBookingSchema.safeParse({ spaceId: uuid, ...slot, startTime }).success,
      ).toBe(false);
    }
  });

  it('duração tem de ser múltipla de 30 e o dia da semana, de 0 a 6', () => {
    expect(
      requestRecurringBookingSchema.safeParse({ spaceId: uuid, ...slot, durationMin: 45 }).success,
    ).toBe(false);
    expect(
      requestRecurringBookingSchema.safeParse({ spaceId: uuid, ...slot, weekday: 7 }).success,
    ).toBe(false);
  });

  it('cadastro direto: cliente com app ou nome + telefone, não os dois', () => {
    const desk = (extra: object) =>
      createDeskRecurringBookingSchema.safeParse({ ...slot, ...extra }).success;
    expect(desk({ customerUserId: uuid })).toBe(true);
    expect(desk({ guestName: 'Ana', guestPhone: '+5531988887777' })).toBe(true);
    expect(desk({})).toBe(false);
    expect(desk({ customerUserId: uuid, guestName: 'Ana', guestPhone: '+5531988887777' })).toBe(
      false,
    );
    expect(desk({ guestName: 'Ana' })).toBe(false);
  });
});

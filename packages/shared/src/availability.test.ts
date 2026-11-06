import { describe, expect, it } from 'vitest';
import {
  BOOKING_EDIT_BLOCK_CODES,
  BOOKING_EDIT_BLOCK_MESSAGES,
  type BookingEditState,
  type BookingRules,
  bookingEditBlocks,
  bookingPaymentStatus,
  buildAvailability,
  candidateSlots,
  checkBookingTime,
  DEFAULT_BOOKING_RULES,
  openingIntervals,
} from './availability';
import type { OpeningHour } from './spaces';
import { addDays, utcToZoned, weekdayOf, zonedToUtc } from './time';

const TZ = 'America/Sao_Paulo';
// 2026-11-02 é segunda-feira; São Paulo é UTC−3 (sem horário de verão).
const MONDAY = '2026-11-02';
const everyDay = (opensAt: string, closesAt: string): OpeningHour[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt, closesAt }));
const local = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, TZ);
};
const hhmm = (d: Date) => {
  const { minuteOfDay } = utcToZoned(d, TZ);
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const rules: BookingRules = DEFAULT_BOOKING_RULES;

describe('fuso', () => {
  it('converte hora local de São Paulo para UTC e de volta', () => {
    expect(local(MONDAY, '10:00').toISOString()).toBe('2026-11-02T13:00:00.000Z');
    expect(utcToZoned(new Date('2026-11-03T02:30:00Z'), TZ)).toEqual({
      date: MONDAY,
      minuteOfDay: 23 * 60 + 30,
      weekday: 1,
    });
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('openingIntervals / candidateSlots (RN-BOOK-02)', () => {
  it('slots de 30 em 30 min em que a duração inteira cabe no funcionamento', () => {
    const slots = candidateSlots(MONDAY, 60, everyDay('08:00', '12:00'), TZ);
    expect(slots.map((s) => hhmm(s.start))).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
    expect(
      candidateSlots(MONDAY, 90, everyDay('08:00', '10:00'), TZ).map((s) => hhmm(s.start)),
    ).toEqual(['08:00', '08:30']);
  });

  it('respeita o dia da semana e une intervalos que se encostam', () => {
    const hours: OpeningHour[] = [
      { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
      { weekday: 1, opensAt: '12:00', closesAt: '14:00' },
      { weekday: 2, opensAt: '06:00', closesAt: '22:00' },
    ];
    expect(openingIntervals(MONDAY, hours, TZ)).toEqual([
      { start: local(MONDAY, '08:00'), end: local(MONDAY, '14:00') },
      { start: local('2026-11-03', '06:00'), end: local('2026-11-03', '22:00') },
    ]);
    // 11:30–13:30 atravessa a junção dos dois intervalos.
    expect(candidateSlots(MONDAY, 120, hours, TZ).map((s) => hhmm(s.start))).toContain('11:30');
    expect(candidateSlots('2026-11-01', 60, hours, TZ)).toEqual([]); // domingo fechado
  });

  it('intervalo que passa da meia-noite: começa num dia e cobre a madrugada do seguinte', () => {
    const hours: OpeningHour[] = [{ weekday: 1, opensAt: '18:00', closesAt: '01:00' }];
    expect(
      candidateSlots(MONDAY, 60, hours, TZ)
        .map((s) => hhmm(s.start))
        .slice(-2),
    ).toEqual(['23:00', '23:30']);
    // A madrugada de terça (00:00–01:00) é listada na data de terça.
    expect(candidateSlots('2026-11-03', 60, hours, TZ).map((s) => hhmm(s.start))).toEqual([
      '00:00',
    ]);
  });

  it('aberto 24h: reserva que começa às 23h30 e passa da meia-noite cabe no funcionamento', () => {
    const slots = candidateSlots(MONDAY, 90, everyDay('00:00', '00:00'), TZ);
    expect(slots).toHaveLength(48);
    expect(hhmm(slots.at(-1)?.start ?? new Date(0))).toBe('23:30');
  });
});

describe('checkBookingTime (RN-BOOK-02, RN-BOOK-06)', () => {
  const hours = everyDay('06:00', '23:00');
  const now = local(MONDAY, '09:10');
  const check = (startsAt: Date, durationMin = 60, actor: 'PLAYER' | 'STAFF' = 'PLAYER') =>
    checkBookingTime({
      startsAt,
      durationMin,
      openingHours: hours,
      timeZone: TZ,
      rules,
      now,
      actor,
    });

  it('aceita um horário válido', () => {
    expect(check(local(MONDAY, '18:00'), 90)).toBeNull();
  });

  it('duração fora da fração ou dos limites do espaço', () => {
    expect(check(local(MONDAY, '18:00'), 45)).toBe('INVALID_DURATION');
    expect(check(local(MONDAY, '18:00'), 30)).toBe('DURATION_OUT_OF_RANGE');
    expect(check(local(MONDAY, '18:00'), 210)).toBe('DURATION_OUT_OF_RANGE');
  });

  it('início fora da grade de 30 min', () => {
    expect(check(local(MONDAY, '18:15'))).toBe('MISALIGNED_START');
  });

  it('fora do funcionamento (inclusive terminando depois do fechamento)', () => {
    expect(check(local(MONDAY, '05:30'))).toBe('OUTSIDE_OPENING_HOURS');
    expect(check(local(MONDAY, '22:30'))).toBe('OUTSIDE_OPENING_HOURS');
  });

  it('antecedência mínima e janela', () => {
    expect(check(local(MONDAY, '09:00'))).toBe('BOOKING_IN_THE_PAST');
    expect(check(local(MONDAY, '10:00'))).toBe('BOOKING_TOO_SOON'); // 50 min < 60
    expect(check(local(MONDAY, '10:30'))).toBeNull();
    expect(check(local(addDays(MONDAY, 30), '22:00'))).toBeNull();
    expect(check(local(addDays(MONDAY, 31), '06:00'))).toBe('BOOKING_BEYOND_WINDOW');
  });

  it('balcão dispensa antecedência, janela e limites de duração, mas não o funcionamento', () => {
    expect(check(local(MONDAY, '09:00'), 30, 'STAFF')).toBeNull(); // em andamento
    expect(check(local(MONDAY, '08:00'), 60, 'STAFF')).toBe('BOOKING_IN_THE_PAST');
    expect(check(local(addDays(MONDAY, 90), '10:00'), 240, 'STAFF')).toBeNull();
    expect(check(local(MONDAY, '22:30'), 60, 'STAFF')).toBe('OUTSIDE_OPENING_HOURS');
  });
});

describe('buildAvailability (RF-BOOK-02)', () => {
  it('marca ocupados e horários antes da antecedência mínima', () => {
    const [court] = buildAvailability({
      date: MONDAY,
      durationMin: 60,
      openingHours: everyDay('08:00', '12:00'),
      timeZone: TZ,
      rules,
      now: local(MONDAY, '08:00'),
      courts: [
        {
          courtId: 'c1',
          occupied: [{ start: local(MONDAY, '10:00'), end: local(MONDAY, '11:00') }],
        },
      ],
    });
    expect(court?.slots.map((s) => `${hhmm(s.startsAt)}:${s.available ? 'livre' : 'x'}`)).toEqual([
      '08:00:x', // antecedência
      '08:30:x', // antecedência (30 min)
      '09:00:livre',
      '09:30:x', // 09:30–10:30 conflita com 10:00–11:00
      '10:00:x',
      '10:30:x',
      '11:00:livre', // adjacente ao fim da ocupação
    ]);
  });
});

describe('bookingPaymentStatus', () => {
  it('PENDING → PARTIALLY_PAID → PAID', () => {
    expect(bookingPaymentStatus(10_000, 0)).toBe('PENDING');
    expect(bookingPaymentStatus(10_000, 2_500)).toBe('PARTIALLY_PAID');
    expect(bookingPaymentStatus(10_000, 10_000)).toBe('PAID');
    expect(bookingPaymentStatus(0, 0)).toBe('PAID');
  });
});

describe('bookingEditBlocks (RN-BOOK-10 a RN-BOOK-12)', () => {
  const startsAt = local(MONDAY, '18:00');
  const open: BookingEditState = {
    isOrganizer: true,
    spaceActive: true,
    status: 'CONFIRMED',
    source: 'APP',
    recurring: false,
    courtActive: true,
    sportOffered: true,
    startsAt,
    endsAt: local(MONDAY, '19:00'),
    paidCents: 0,
    deadline: local(MONDAY, '17:00'),
    now: local(MONDAY, '10:00'),
  };

  it('libera tudo para o organizador antes do prazo', () => {
    expect(bookingEditBlocks(open)).toEqual({ people: null, schedule: null });
  });

  it('o horário vale até o limite exato, e as pessoas até o início', () => {
    expect(bookingEditBlocks({ ...open, now: open.deadline }).schedule).toBeNull();
    expect(bookingEditBlocks({ ...open, now: local(MONDAY, '17:01') })).toEqual({
      people: null,
      schedule: 'BOOKING_EDIT_DEADLINE_PASSED',
    });
    expect(bookingEditBlocks({ ...open, now: startsAt }).people).toBe('BOOKING_STARTED');
  });

  it('pagamento só trava o horário', () => {
    expect(bookingEditBlocks({ ...open, paidCents: 1 })).toEqual({
      people: null,
      schedule: 'BOOKING_HAS_PAYMENT',
    });
  });

  it.each([
    [{ isOrganizer: false }, 'NOT_BOOKING_ORGANIZER'],
    [{ spaceActive: false }, 'SPACE_READ_ONLY'],
    [{ status: 'CANCELLED' }, 'INVALID_BOOKING_STATUS'],
    [{ now: open.endsAt }, 'BOOKING_ENDED'],
    [{ source: 'DESK' }, 'BOOKING_NOT_EDITABLE'],
    [{ recurring: true }, 'BOOKING_NOT_EDITABLE'],
    [{ courtActive: false }, 'COURT_UNAVAILABLE'],
    [{ sportOffered: false }, 'SPORT_NOT_OFFERED'],
  ] as const)('%o trava as duas edições com %s', (change, code) => {
    expect(bookingEditBlocks({ ...open, ...change })).toEqual({ people: code, schedule: code });
  });

  it('todo código tem mensagem', () => {
    for (const code of BOOKING_EDIT_BLOCK_CODES) {
      expect(BOOKING_EDIT_BLOCK_MESSAGES[code]).toBeTruthy();
    }
  });
});

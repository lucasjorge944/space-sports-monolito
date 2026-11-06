import type { OpeningHour } from './spaces';
import {
  addDays,
  addMinutes,
  type Interval,
  overlaps,
  timeToMinutes,
  utcToZoned,
  weekdayOf,
  zonedToUtc,
} from './time';

/** RN-BOOK-02: fração de 30 minutos (início e duração). */
export const SLOT_MINUTES = 30;

/** Regras de reserva do espaço (space_settings), com os padrões da seção 2.1 aplicados. */
export interface BookingRules {
  minDurationMin: number;
  maxDurationMin: number;
  minAdvanceMin: number;
  windowDays: number;
  cancellationDeadlineMin: number;
}

/** Padrões de docs/02 (seção 2.1) para configurações ainda não definidas pelo espaço. */
export const DEFAULT_BOOKING_RULES: BookingRules = {
  minDurationMin: 60,
  maxDurationMin: 180,
  minAdvanceMin: 60,
  windowDays: 30,
  cancellationDeadlineMin: 60,
};

/** Motivo pelo qual um horário não pode ser reservado (vira o código de erro da API). */
export type BookingTimeViolation =
  | 'INVALID_DURATION'
  | 'DURATION_OUT_OF_RANGE'
  | 'MISALIGNED_START'
  | 'OUTSIDE_OPENING_HOURS'
  | 'BOOKING_IN_THE_PAST'
  | 'BOOKING_TOO_SOON'
  | 'BOOKING_BEYOND_WINDOW';

/**
 * Períodos de funcionamento em torno da data local (véspera que passa da meia-noite, o dia e o
 * dia seguinte), unidos quando se sobrepõem ou encostam.
 */
export function openingIntervals(
  date: string,
  openingHours: readonly OpeningHour[],
  timeZone: string,
): Interval[] {
  const intervals: Interval[] = [];
  // A véspera entra pelo intervalo que passa da meia-noite; o dia seguinte, para reservas que
  // começam na data e terminam depois da meia-noite.
  for (const offset of [-1, 0, 1]) {
    const day = addDays(date, offset);
    const weekday = weekdayOf(day);
    for (const hour of openingHours) {
      if (hour.weekday !== weekday) continue;
      const opens = timeToMinutes(hour.opensAt);
      const closes = timeToMinutes(hour.closesAt);
      const overnight = closes <= opens;
      if (offset === -1 && !overnight) continue;
      intervals.push({
        start: zonedToUtc(day, opens, timeZone),
        end: zonedToUtc(overnight ? addDays(day, 1) : day, closes, timeZone),
      });
    }
  }
  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function withinOpening(period: Interval, intervals: readonly Interval[]): boolean {
  return intervals.some((i) => i.start <= period.start && period.end <= i.end);
}

/**
 * Inícios possíveis na data local (de 30 em 30 min) em que a duração inteira cabe no
 * funcionamento. Não considera ocupação nem antecedência.
 */
export function candidateSlots(
  date: string,
  durationMin: number,
  openingHours: readonly OpeningHour[],
  timeZone: string,
): Interval[] {
  const intervals = openingIntervals(date, openingHours, timeZone);
  const slots: Interval[] = [];
  const seen = new Set<number>();
  for (let minute = 0; minute < 24 * 60; minute += SLOT_MINUTES) {
    const start = zonedToUtc(date, minute, timeZone);
    // Em transições de horário de verão dois minutos locais podem cair no mesmo instante.
    if (seen.has(start.getTime()) || utcToZoned(start, timeZone).date !== date) continue;
    seen.add(start.getTime());
    const slot = { start, end: addMinutes(start, durationMin) };
    if (withinOpening(slot, intervals)) slots.push(slot);
  }
  return slots;
}

export interface BookingTimeCheck {
  startsAt: Date;
  durationMin: number;
  openingHours: readonly OpeningHour[];
  timeZone: string;
  rules: BookingRules;
  now: Date;
  /**
   * `PLAYER` aplica todas as regras (RN-BOOK-02, RN-BOOK-06). `STAFF` (balcão) dispensa a
   * duração mínima/máxima, a antecedência e a janela, mas mantém a fração de 30 min, o
   * funcionamento e exige que a reserva ainda não tenha terminado.
   */
  actor: 'PLAYER' | 'STAFF';
}

/** Valida o horário de uma reserva; devolve a primeira regra violada ou `null`. */
export function checkBookingTime(check: BookingTimeCheck): BookingTimeViolation | null {
  const { startsAt, durationMin, rules, now, timeZone } = check;
  if (!Number.isInteger(durationMin) || durationMin <= 0 || durationMin % SLOT_MINUTES !== 0) {
    return 'INVALID_DURATION';
  }
  if (
    check.actor === 'PLAYER' &&
    (durationMin < rules.minDurationMin || durationMin > rules.maxDurationMin)
  ) {
    return 'DURATION_OUT_OF_RANGE';
  }
  const local = utcToZoned(startsAt, timeZone);
  if (
    startsAt.getUTCSeconds() !== 0 ||
    startsAt.getUTCMilliseconds() !== 0 ||
    local.minuteOfDay % SLOT_MINUTES !== 0
  ) {
    return 'MISALIGNED_START';
  }
  const period = { start: startsAt, end: addMinutes(startsAt, durationMin) };
  if (!withinOpening(period, openingIntervals(local.date, check.openingHours, timeZone))) {
    return 'OUTSIDE_OPENING_HOURS';
  }
  if (check.actor === 'STAFF') return period.end <= now ? 'BOOKING_IN_THE_PAST' : null;
  if (startsAt <= now) return 'BOOKING_IN_THE_PAST';
  if (startsAt < addMinutes(now, rules.minAdvanceMin)) return 'BOOKING_TOO_SOON';
  const lastDate = addDays(utcToZoned(now, timeZone).date, rules.windowDays);
  if (local.date > lastDate) return 'BOOKING_BEYOND_WINDOW';
  return null;
}

export interface CourtSlots {
  courtId: string;
  slots: { startsAt: Date; endsAt: Date; available: boolean }[];
}

/**
 * RF-BOOK-02: grade de horários da data por quadra. Um slot fica indisponível se conflita com
 * uma ocupação ativa da quadra ou se viola a antecedência/janela/duração para o jogador.
 */
export function buildAvailability(input: {
  date: string;
  durationMin: number;
  openingHours: readonly OpeningHour[];
  timeZone: string;
  rules: BookingRules;
  now: Date;
  courts: readonly { courtId: string; occupied: readonly Interval[] }[];
}): CourtSlots[] {
  const candidates = candidateSlots(
    input.date,
    input.durationMin,
    input.openingHours,
    input.timeZone,
  );
  const bookable = candidates.map(
    (slot) =>
      checkBookingTime({
        startsAt: slot.start,
        durationMin: input.durationMin,
        openingHours: input.openingHours,
        timeZone: input.timeZone,
        rules: input.rules,
        now: input.now,
        actor: 'PLAYER',
      }) === null,
  );
  return input.courts.map((court) => ({
    courtId: court.courtId,
    slots: candidates.map((slot, i) => ({
      startsAt: slot.start,
      endsAt: slot.end,
      available: Boolean(bookable[i]) && !court.occupied.some((o) => overlaps(o, slot)),
    })),
  }));
}

/** RN-BOOK-05: o jogador pode cancelar até `cancellationDeadlineMin` antes do início. */
export function playerCancellationDeadline(startsAt: Date, cancellationDeadlineMin: number): Date {
  return addMinutes(startsAt, -cancellationDeadlineMin);
}

/**
 * Por que o jogador não pode editar a reserva agora (RN-BOOK-10 a RN-BOOK-12). É o motivo das
 * flags do detalhe da reserva e o código do erro de `PATCH /v1/bookings/:bookingId`.
 */
export const BOOKING_EDIT_BLOCK_CODES = [
  'NOT_BOOKING_ORGANIZER',
  'SPACE_READ_ONLY',
  'INVALID_BOOKING_STATUS',
  'BOOKING_ENDED',
  'BOOKING_NOT_EDITABLE',
  'COURT_UNAVAILABLE',
  'SPORT_NOT_OFFERED',
  'BOOKING_STARTED',
  'BOOKING_EDIT_DEADLINE_PASSED',
  'BOOKING_HAS_PAYMENT',
] as const;
export type BookingEditBlockCode = (typeof BOOKING_EDIT_BLOCK_CODES)[number];

export const BOOKING_EDIT_BLOCK_MESSAGES: Record<BookingEditBlockCode, string> = {
  NOT_BOOKING_ORGANIZER: 'Só quem fez a reserva pode alterá-la.',
  SPACE_READ_ONLY: 'Este espaço não está aceitando alterações no momento.',
  INVALID_BOOKING_STATUS: 'Esta reserva não está mais ativa.',
  BOOKING_ENDED: 'Esta reserva já terminou.',
  BOOKING_NOT_EDITABLE: 'Esta reserva não pode ser alterada pelo app. Fale com o espaço.',
  COURT_UNAVAILABLE: 'A quadra desta reserva não está ativa. Fale com o espaço.',
  SPORT_NOT_OFFERED: 'A quadra não oferece mais este esporte. Fale com o espaço.',
  BOOKING_STARTED: 'A reserva já começou. Fale com o espaço.',
  BOOKING_EDIT_DEADLINE_PASSED:
    'O prazo para alterar data, horário ou duração pelo app terminou. Fale com o espaço.',
  BOOKING_HAS_PAYMENT:
    'Esta reserva já tem pagamento registrado. Para alterar data, horário ou duração, fale com o espaço.',
};

export interface BookingEditState {
  isOrganizer: boolean;
  spaceActive: boolean;
  status: string;
  source: string;
  recurring: boolean;
  courtActive: boolean;
  /** A quadra ainda oferece o esporte da reserva. */
  sportOffered: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Pagamentos não estornados da reserva e das partes. */
  paidCents: number;
  /** Mesmo limite do cancelamento (`playerCancellationDeadline`). */
  deadline: Date;
  now: Date;
}

/** O que impede editar o nº de pessoas e o horário; `null` = pode. */
export function bookingEditBlocks(state: BookingEditState): {
  people: BookingEditBlockCode | null;
  schedule: BookingEditBlockCode | null;
} {
  const { startsAt, deadline, now, paidCents } = state;
  const blocked = (code: BookingEditBlockCode) => ({ people: code, schedule: code });
  if (!state.isOrganizer) return blocked('NOT_BOOKING_ORGANIZER');
  if (!state.spaceActive) return blocked('SPACE_READ_ONLY');
  if (state.status !== 'CONFIRMED') return blocked('INVALID_BOOKING_STATUS');
  if (state.endsAt <= now) return blocked('BOOKING_ENDED');
  if (state.source !== 'APP' || state.recurring) return blocked('BOOKING_NOT_EDITABLE');
  if (!state.courtActive) return blocked('COURT_UNAVAILABLE');
  if (!state.sportOffered) return blocked('SPORT_NOT_OFFERED');
  return {
    people: now >= startsAt ? 'BOOKING_STARTED' : null,
    schedule:
      now > deadline
        ? 'BOOKING_EDIT_DEADLINE_PASSED'
        : paidCents > 0
          ? 'BOOKING_HAS_PAYMENT'
          : null,
  };
}

/** Status de pagamento da reserva a partir do valor pago (registros não estornados). */
export function bookingPaymentStatus(
  priceCents: number,
  paidCents: number,
): 'PENDING' | 'PARTIALLY_PAID' | 'PAID' {
  if (paidCents >= priceCents) return 'PAID';
  return paidCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';
}

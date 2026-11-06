import type {
  BookingEditBlockCode,
  PlayerBookingDetailDto,
  UpdateBookingDto,
} from '@space-sports/api-client';
import { calculateBookingPriceCents, splitBookingPrice, utcToZoned } from '@space-sports/shared';
import { activeInviteCount } from './invites';
import type { TimeOption } from './slots';

type EditableBooking = Pick<
  PlayerBookingDetailDto,
  | 'status'
  | 'canEditPeople'
  | 'canEditSchedule'
  | 'peopleEditBlock'
  | 'scheduleEditBlock'
  | 'startsAt'
  | 'endsAt'
  | 'durationMin'
  | 'peopleCount'
  | 'priceCents'
  | 'pricePerHourCents'
>;

export interface EditDraft {
  peopleCount: number;
  /** Nulo enquanto o novo horário não foi escolhido. */
  startsAt: string | null;
  durationMin: number;
}

/** Motivos em que vale procurar o espaço; nos demais, falar com ele não destrava nada. */
const TALK_TO_SPACE: readonly BookingEditBlockCode[] = [
  'BOOKING_NOT_EDITABLE',
  'COURT_UNAVAILABLE',
  'SPORT_NOT_OFFERED',
  'BOOKING_STARTED',
  'BOOKING_EDIT_DEADLINE_PASSED',
  'BOOKING_HAS_PAYMENT',
];

/** Sem explicação nenhuma: a reserva acabou, ou quem olha é convidado e nem teria o que editar. */
const SILENT: readonly BookingEditBlockCode[] = [
  'NOT_BOOKING_ORGANIZER',
  'INVALID_BOOKING_STATUS',
  'BOOKING_ENDED',
];

export function shouldTalkToSpace(code: BookingEditBlockCode): boolean {
  return TALK_TO_SPACE.includes(code);
}

/**
 * Por que a reserva não pode ser editada: o motivo vem da API. O nº de pessoas é o que fica aberto
 * por mais tempo, então o bloqueio dele é o que explica a reserva inteira.
 */
export function editBlockNotice(booking: EditableBooking) {
  if (booking.status !== 'CONFIRMED' || booking.canEditPeople || booking.canEditSchedule) {
    return null;
  }
  const block = booking.peopleEditBlock ?? booking.scheduleEditBlock;
  return block && !SILENT.includes(block.code) ? block : null;
}

/** Datas do seletor: a janela do espaço, sem perder a data atual se ela já ficou fora dela. */
export function editDates(windowDates: string[], currentDate: string): string[] {
  return windowDates.includes(currentDate)
    ? windowDates
    : [...windowDates, currentDate].sort((a, b) => a.localeCompare(b));
}

/**
 * Horários da edição. O horário atual fica sempre na lista enquanto a data e a duração não mudam:
 * ele pode já não ser oferecido (antecedência mínima) e isso não impede mudar só as pessoas.
 */
export function editTimeOptions(
  options: TimeOption[],
  booking: Pick<EditableBooking, 'startsAt' | 'endsAt' | 'durationMin'>,
  date: string,
  durationMin: number,
  timeZone: string,
): TimeOption[] {
  const sameDay = utcToZoned(new Date(booking.startsAt), timeZone).date === date;
  if (!sameDay || durationMin !== booking.durationMin) return options;
  if (options.some((option) => option.startsAt === booking.startsAt)) return options;
  return [...options, { startsAt: booking.startsAt, endsAt: booking.endsAt, courts: [] }].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt),
  );
}

/** O PATCH só com o que mudou. */
export function editChanges(
  booking: Pick<EditableBooking, 'peopleCount' | 'startsAt' | 'durationMin'>,
  draft: EditDraft,
): UpdateBookingDto {
  const changes: UpdateBookingDto = {};
  if (draft.peopleCount !== booking.peopleCount) changes.peopleCount = draft.peopleCount;
  if (draft.startsAt && draft.startsAt !== booking.startsAt) changes.startsAt = draft.startsAt;
  if (draft.durationMin !== booking.durationMin) changes.durationMin = draft.durationMin;
  return changes;
}

export interface EditPreview {
  priceCents: number;
  /** Novo total menos o atual. */
  differenceCents: number;
  /** Parte de cada um (RN-BOOK-09); a diferença do arredondamento fica com o organizador. */
  shareCents: number;
  organizerShareCents: number;
}

/** Mesma conta da API: valor/hora guardado na reserva (decisão 49) e divisão por RN-BOOK-09. */
export function editPreview(
  booking: Pick<EditableBooking, 'priceCents' | 'pricePerHourCents'>,
  peopleCount: number,
  durationMin: number,
): EditPreview {
  const priceCents = calculateBookingPriceCents(booking.pricePerHourCents, durationMin);
  const [organizer, other] = splitBookingPrice(priceCents, peopleCount);
  const organizerShareCents = organizer?.amountCents ?? priceCents;
  return {
    priceCents,
    differenceCents: priceCents - booking.priceCents,
    shareCents: other?.amountCents ?? organizerShareCents,
    organizerShareCents,
  };
}

/** O organizador mais os convidados que não recusaram (RN-BOOK-11). */
export function minPeople(participants: PlayerBookingDetailDto['participants']): number {
  return 1 + activeInviteCount(participants);
}

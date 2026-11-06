import type { PlayerBooking } from '@space-sports/api-client';
import { createEventInCalendarAsync } from 'expo-calendar/legacy';

/** Só reservas confirmadas que ainda não terminaram entram no calendário. */
export function canAddToCalendar(
  booking: Pick<PlayerBooking, 'status' | 'endsAt'>,
  now = new Date(),
): boolean {
  return booking.status === 'CONFIRMED' && now.getTime() < new Date(booking.endsAt).getTime();
}

/** O título do evento: "Futevôlei · Arena 7". */
export function calendarTitle(booking: Pick<PlayerBooking, 'sport' | 'space'>): string {
  return `${booking.sport.name} · ${booking.space.name}`;
}

/**
 * Abre a tela do sistema para criar o evento (RF-BOOK-03). O usuário confirma lá, então o app
 * não pede nem declara permissão de leitura/escrita do calendário (veja `app.config.ts`: iOS
 * `writeOnlyAccess` e Android `blockedPermissions`).
 */
export async function addBookingToCalendar(
  booking: Pick<PlayerBooking, 'sport' | 'space' | 'court' | 'startsAt' | 'endsAt'>,
  location: string | null,
): Promise<void> {
  await createEventInCalendarAsync({
    title: calendarTitle(booking),
    startDate: new Date(booking.startsAt),
    endDate: new Date(booking.endsAt),
    timeZone: booking.space.timeZone,
    notes: `Quadra: ${booking.court.name}`,
    ...(location ? { location } : {}),
  });
}

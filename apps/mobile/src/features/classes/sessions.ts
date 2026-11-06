import { addDays, utcToZoned } from '@space-sports/shared';

/** Janela de uma semana (7 dias) a partir de hoje, deslocada `offset` semanas (0 = esta). */
export function weekRange(today: string, offset: number): { from: string; to: string } {
  const from = addDays(today, offset * 7);
  return { from, to: addDays(from, 6) };
}

export interface DayGroup<T> {
  date: string;
  items: T[];
}

/** Agrupa as aulas por dia local do espaço, na ordem do horário. */
export function groupSessionsByDay<T extends { startsAt: string; space: { timeZone: string } }>(
  sessions: T[],
): DayGroup<T>[] {
  const sorted = [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const groups: DayGroup<T>[] = [];
  for (const session of sorted) {
    const date = utcToZoned(new Date(session.startsAt), session.space.timeZone).date;
    const last = groups[groups.length - 1];
    if (last?.date === date) last.items.push(session);
    else groups.push({ date, items: [session] });
  }
  return groups;
}

/** Texto curto da minha situação na aula: "Confirmado", "Na espera (2º)" ou `null`. */
export function myAttendanceLabel(
  attendance: { status: string; waitlistPosition: number | null } | null,
  sessionStatus?: string,
): string | null {
  if (!attendance) return null;
  // Aula cancelada: a confirmação não vale mais.
  if (sessionStatus === 'CANCELLED') return 'Aula cancelada';
  switch (attendance.status) {
    case 'CONFIRMED':
      return 'Presença confirmada';
    case 'WAITLIST':
      return attendance.waitlistPosition
        ? `Na espera (${attendance.waitlistPosition}º)`
        : 'Na espera';
    case 'PRESENT':
      return 'Você esteve presente';
    case 'ABSENT':
      return 'Você faltou';
    default:
      return null;
  }
}

/** Vagas ocupadas: "8/10 confirmados". `confirmedCount` já conta presença e falta (2.5). */
export function occupancyLabel(session: { confirmedCount: number; capacity: number }): string {
  return `${session.confirmedCount}/${session.capacity} confirmados`;
}

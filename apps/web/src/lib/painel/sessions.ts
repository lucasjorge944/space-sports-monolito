import type {
  ClassSessionDetailAttendancesItemStatus,
  ClassSessionStatus,
  SpaceRole,
} from '@space-sports/api-client';
import { addDays, utcToZoned } from '@space-sports/shared';
import { DISPLAY_TIME_ZONE } from '@/lib/format';
import type { BadgeTone } from './labels';

type Label = { label: string; tone: BadgeTone };

export const SESSION_STATUS: Record<ClassSessionStatus, Label> = {
  SCHEDULED: { label: 'Agendada', tone: 'info' },
  OPEN: { label: 'Lista aberta', tone: 'success' },
  CLOSED: { label: 'Lista fechada', tone: 'warning' },
  DONE: { label: 'Realizada', tone: 'muted' },
  CANCELLED: { label: 'Cancelada', tone: 'destructive' },
};

export const ATTENDEE_STATUS: Record<ClassSessionDetailAttendancesItemStatus, Label> = {
  CONFIRMED: { label: 'Confirmado', tone: 'success' },
  WAITLIST: { label: 'Na espera', tone: 'warning' },
  CANCELLED: { label: 'Desistiu', tone: 'muted' },
  PRESENT: { label: 'Presente', tone: 'success' },
  ABSENT: { label: 'Faltou', tone: 'destructive' },
};

type SessionLike = {
  status: ClassSessionStatus;
  startsAt: string;
  endsAt: string;
  teachers: readonly { userId: string }[];
};

/**
 * A API é a regra de verdade; isto só esconde o que ela recusaria: Dono e Admin operam qualquer
 * sessão, o Professor só aquelas em que está na lista (decisão 47).
 */
export function canOperateSession(
  roles: readonly SpaceRole[],
  userId: string | undefined,
  session: Pick<SessionLike, 'teachers'>,
): boolean {
  if (roles.includes('OWNER') || roles.includes('ADMIN')) return true;
  return roles.includes('TEACHER') && session.teachers.some((t) => t.userId === userId);
}

/** Cancelar a sessão e mudar os professores dela: só Dono e Admin (decisão 32). */
export function canManageSession(roles: readonly SpaceRole[]): boolean {
  return roles.includes('OWNER') || roles.includes('ADMIN');
}

export type SessionActions = {
  /** `SCHEDULED` abre; `CLOSED` reabre (até o fim da aula). */
  open: 'open' | 'reopen' | null;
  close: boolean;
  cancel: boolean;
  changeTeachers: boolean;
  addAttendee: boolean;
  /** A presença real vale a partir do início da aula, também depois de encerrada. */
  markPresence: boolean;
};

const LIVE: readonly ClassSessionStatus[] = ['SCHEDULED', 'OPEN', 'CLOSED'];

/**
 * Ações possíveis pelo ciclo da sessão (RN-CLASS-04). `operate`/`manage` vêm do papel; o instante
 * `now` é injetado para o teste ser determinístico.
 */
export function sessionActions(
  session: SessionLike,
  perms: { operate: boolean; manage: boolean },
  now: Date = new Date(),
): SessionActions {
  const live = LIVE.includes(session.status);
  const notEnded = now.getTime() < new Date(session.endsAt).getTime();
  const started = now.getTime() >= new Date(session.startsAt).getTime();
  const open: SessionActions['open'] =
    !perms.operate || !notEnded
      ? null
      : session.status === 'SCHEDULED'
        ? 'open'
        : session.status === 'CLOSED'
          ? 'reopen'
          : null;
  return {
    open,
    close: perms.operate && session.status === 'OPEN',
    cancel: perms.manage && live,
    changeTeachers: perms.manage && live,
    addAttendee: perms.operate && live,
    markPresence: perms.operate && session.status !== 'CANCELLED' && started,
  };
}

/** `confirmedCount` já é "vagas ocupadas" (confirmados + presentes + faltosos, 2.5). */
export function occupancyLabel(session: { confirmedCount: number; capacity: number }): string {
  return `${session.confirmedCount}/${session.capacity}`;
}

export function isFull(session: { confirmedCount: number; capacity: number }): boolean {
  return session.confirmedCount >= session.capacity;
}

/** Data local (`YYYY-MM-DD`, America/Sao_Paulo) do início da sessão. */
export function sessionDate(startsAt: string): string {
  return utcToZoned(new Date(startsAt), DISPLAY_TIME_ZONE).date;
}

/** Agrupa por dia local, com os horários em ordem; dias sem aula ficam de fora. */
export function groupByDay<T extends { startsAt: string }>(items: readonly T[]): Map<string, T[]> {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = new Map<string, T[]>();
  for (const item of sorted) {
    const day = sessionDate(item.startsAt);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  return byDay;
}

type Attendee = {
  userId: string;
  status: ClassSessionDetailAttendancesItemStatus;
  waitlistPosition: number | null;
};

/** Quem ocupa vaga: confirmados, presentes e faltosos (nessa ordem da API). */
export function occupying<T extends Attendee>(attendees: readonly T[]): T[] {
  return attendees.filter(
    (a) => a.status === 'CONFIRMED' || a.status === 'PRESENT' || a.status === 'ABSENT',
  );
}

/** Fila de espera na ordem da posição. */
export function waitlist<T extends Attendee>(attendees: readonly T[]): T[] {
  return attendees
    .filter((a) => a.status === 'WAITLIST')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
}

/** Presença marcada não permite remover da aula (409 `PRESENCE_ALREADY_MARKED`). */
export function canRemoveAttendee(status: ClassSessionDetailAttendancesItemStatus): boolean {
  return status === 'CONFIRMED' || status === 'WAITLIST';
}

/** Matriculados que ainda não estão na lista (candidatos a inclusão e a chamada). */
export function studentsOutsideList<T extends { userId: string }>(
  enrolled: readonly T[],
  attendees: readonly { userId: string }[],
): T[] {
  const inList = new Set(attendees.map((a) => a.userId));
  return enrolled.filter((s) => !inList.has(s.userId));
}

/** Busca por nome sem diferenciar maiúsculas e acentos. */
export function matchesName(name: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  return norm(name).includes(norm(query));
}

/** `0.8333` → `83%`; sem aulas dadas (`null`) → `—`. */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * Situação de um registro do histórico: confirmado em aula já dada e sem marcação aparece como
 * "Sem marcação" (a API conta assim em `unmarked`).
 */
export function historyStatus(
  status: ClassSessionDetailAttendancesItemStatus,
  sessionStatus: ClassSessionStatus,
): Label {
  if (status === 'CONFIRMED' && sessionStatus === 'DONE') {
    return { label: 'Sem marcação', tone: 'warning' };
  }
  return ATTENDEE_STATUS[status];
}

/** Período padrão dos relatórios de presença: os últimos 30 dias, hoje inclusive. */
export function defaultPeriod(today: string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}

const MAX_REPORT_DAYS = 366;

/** Valida o período dos relatórios antes de chamar a API (422 `ATTENDANCE_RANGE_TOO_LONG`). */
export function periodError(from: string, to: string): string | null {
  if (from > to) return 'A data inicial não pode ser depois da final.';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return days > MAX_REPORT_DAYS ? 'O período é longo demais. Escolha no máximo 366 dias.' : null;
}

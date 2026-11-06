import { describe, expect, it } from 'vitest';
import {
  canOperateSession,
  canRemoveAttendee,
  defaultPeriod,
  formatRate,
  groupByDay,
  historyStatus,
  isFull,
  matchesName,
  occupancyLabel,
  occupying,
  periodError,
  type SessionActions,
  sessionActions,
  sessionDate,
  studentsOutsideList,
  waitlist,
} from './sessions';

const session = (status: Parameters<typeof sessionActions>[0]['status']) => ({
  status,
  // 10:00–11:00 em São Paulo (UTC-3).
  startsAt: '2026-10-28T13:00:00.000Z',
  endsAt: '2026-10-28T14:00:00.000Z',
  teachers: [{ userId: 'prof-1' }, { userId: 'prof-2' }],
});
const before = new Date('2026-10-28T12:00:00.000Z');
const during = new Date('2026-10-28T13:30:00.000Z');
const after = new Date('2026-10-28T15:00:00.000Z');
const staff = { operate: true, manage: true };
const teacher = { operate: true, manage: false };
const reader = { operate: false, manage: false };

describe('canOperateSession', () => {
  it('Dono e Admin operam qualquer sessão', () => {
    expect(canOperateSession(['OWNER'], 'u1', session('OPEN'))).toBe(true);
    expect(canOperateSession(['ADMIN'], 'u1', session('OPEN'))).toBe(true);
  });

  it('Professor só opera as próprias', () => {
    expect(canOperateSession(['TEACHER'], 'prof-1', session('OPEN'))).toBe(true);
    expect(canOperateSession(['TEACHER'], 'outro', session('OPEN'))).toBe(false);
    expect(canOperateSession(['TEACHER'], undefined, session('OPEN'))).toBe(false);
  });
});

describe('sessionActions', () => {
  it('SCHEDULED abre; OPEN fecha; CLOSED reabre', () => {
    expect(sessionActions(session('SCHEDULED'), staff, before).open).toBe('open');
    expect(sessionActions(session('OPEN'), staff, before)).toMatchObject({
      open: null,
      close: true,
    });
    expect(sessionActions(session('CLOSED'), staff, before).open).toBe('reopen');
  });

  it('não reabre nem abre depois do fim da aula', () => {
    expect(sessionActions(session('CLOSED'), staff, after).open).toBeNull();
    expect(sessionActions(session('SCHEDULED'), staff, after).open).toBeNull();
  });

  it('presença só a partir do início da aula e nunca em aula cancelada', () => {
    expect(sessionActions(session('CLOSED'), staff, before).markPresence).toBe(false);
    expect(sessionActions(session('CLOSED'), staff, during).markPresence).toBe(true);
    expect(sessionActions(session('DONE'), staff, after).markPresence).toBe(true);
    expect(sessionActions(session('CANCELLED'), staff, after).markPresence).toBe(false);
  });

  it('cancelar e trocar professor: só quem gere e só em aula viva', () => {
    const live = sessionActions(session('OPEN'), staff, before);
    expect(live).toMatchObject({ cancel: true, changeTeachers: true });
    const asTeacher = sessionActions(session('OPEN'), teacher, before);
    expect(asTeacher).toMatchObject({ cancel: false, changeTeachers: false, close: true });
    expect(sessionActions(session('DONE'), staff, after)).toMatchObject({
      cancel: false,
      changeTeachers: false,
      addAttendee: false,
    });
    expect(sessionActions(session('CANCELLED'), staff, before).cancel).toBe(false);
  });

  it('leitura esconde todas as ações', () => {
    const none: SessionActions = {
      open: null,
      close: false,
      cancel: false,
      changeTeachers: false,
      addAttendee: false,
      markPresence: false,
    };
    expect(sessionActions(session('OPEN'), reader, during)).toEqual(none);
  });
});

describe('ocupação', () => {
  it('lê confirmedCount como vagas ocupadas', () => {
    expect(occupancyLabel({ confirmedCount: 7, capacity: 10 })).toBe('7/10');
    expect(isFull({ confirmedCount: 10, capacity: 10 })).toBe(true);
    expect(isFull({ confirmedCount: 9, capacity: 10 })).toBe(false);
  });
});

describe('agrupamento por dia', () => {
  it('usa o dia local de São Paulo e ordena por horário', () => {
    // 01:30Z de 29/10 ainda é 22:30 de 28/10 em São Paulo.
    expect(sessionDate('2026-10-29T01:30:00.000Z')).toBe('2026-10-28');
    const grouped = groupByDay([
      { id: 'c', startsAt: '2026-10-29T13:00:00.000Z' },
      { id: 'b', startsAt: '2026-10-29T01:30:00.000Z' },
      { id: 'a', startsAt: '2026-10-28T10:00:00.000Z' },
    ]);
    expect([...grouped.keys()]).toEqual(['2026-10-28', '2026-10-29']);
    expect(grouped.get('2026-10-28')?.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('lista de presença', () => {
  const attendees = [
    { userId: 'a', status: 'CONFIRMED', waitlistPosition: null },
    { userId: 'b', status: 'WAITLIST', waitlistPosition: 2 },
    { userId: 'c', status: 'PRESENT', waitlistPosition: null },
    { userId: 'd', status: 'WAITLIST', waitlistPosition: 1 },
    { userId: 'e', status: 'ABSENT', waitlistPosition: null },
  ] as const;

  it('separa quem ocupa vaga da fila, que vem pela posição', () => {
    expect(occupying(attendees).map((a) => a.userId)).toEqual(['a', 'c', 'e']);
    expect(waitlist(attendees).map((a) => a.userId)).toEqual(['d', 'b']);
  });

  it('só confirmado e espera podem ser removidos', () => {
    expect(canRemoveAttendee('CONFIRMED')).toBe(true);
    expect(canRemoveAttendee('WAITLIST')).toBe(true);
    expect(canRemoveAttendee('PRESENT')).toBe(false);
    expect(canRemoveAttendee('ABSENT')).toBe(false);
  });

  it('matriculados fora da lista', () => {
    const enrolled = [{ userId: 'a' }, { userId: 'x' }, { userId: 'y' }];
    expect(studentsOutsideList(enrolled, attendees).map((s) => s.userId)).toEqual(['x', 'y']);
  });
});

describe('busca e taxa', () => {
  it('ignora acentos e caixa', () => {
    expect(matchesName('João Álvares', 'joao')).toBe(true);
    expect(matchesName('João Álvares', ' ALVA ')).toBe(true);
    expect(matchesName('Maria', 'jo')).toBe(false);
  });

  it('formata a taxa de presença', () => {
    expect(formatRate(0.8333)).toBe('83%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(null)).toBe('—');
  });
});

describe('histórico', () => {
  it('confirmado em aula realizada vira "Sem marcação"', () => {
    expect(historyStatus('CONFIRMED', 'DONE').label).toBe('Sem marcação');
    expect(historyStatus('CONFIRMED', 'OPEN').label).toBe('Confirmado');
    expect(historyStatus('PRESENT', 'DONE').label).toBe('Presente');
  });

  it('período padrão: 30 dias terminando hoje', () => {
    expect(defaultPeriod('2026-10-28')).toEqual({ from: '2026-09-29', to: '2026-10-28' });
  });
});

describe('periodError', () => {
  it('aceita até 366 dias e recusa o resto', () => {
    expect(periodError('2026-01-01', '2026-01-01')).toBeNull();
    expect(periodError('2025-10-28', '2026-10-28')).toBeNull();
    expect(periodError('2025-10-27', '2026-10-28')).toContain('366');
    expect(periodError('2026-10-28', '2026-10-27')).toContain('inicial');
  });
});

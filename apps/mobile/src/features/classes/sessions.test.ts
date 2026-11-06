import { groupSessionsByDay, myAttendanceLabel, occupancyLabel, weekRange } from './sessions';

const space = { timeZone: 'America/Sao_Paulo' };

describe('weekRange', () => {
  it('semanas de 7 dias a partir de hoje', () => {
    expect(weekRange('2026-10-28', 0)).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(weekRange('2026-10-28', 1)).toEqual({ from: '2026-11-04', to: '2026-11-10' });
  });
});

describe('groupSessionsByDay', () => {
  it('agrupa pelo dia local do espaço, não pelo dia em UTC', () => {
    const groups = groupSessionsByDay([
      { id: 'b', startsAt: '2026-11-04T01:30:00.000Z', space },
      { id: 'a', startsAt: '2026-11-03T10:00:00.000Z', space },
      { id: 'c', startsAt: '2026-11-04T10:00:00.000Z', space },
    ]);
    // 01:30Z ainda é 22:30 do dia 3 em São Paulo.
    expect(groups.map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ['2026-11-03', ['a', 'b']],
      ['2026-11-04', ['c']],
    ]);
  });
});

describe('textos da aula', () => {
  it('minha situação', () => {
    expect(myAttendanceLabel(null)).toBeNull();
    expect(myAttendanceLabel({ status: 'CONFIRMED', waitlistPosition: null })).toBe(
      'Presença confirmada',
    );
    expect(myAttendanceLabel({ status: 'WAITLIST', waitlistPosition: 2 })).toBe('Na espera (2º)');
    expect(myAttendanceLabel({ status: 'CANCELLED', waitlistPosition: null })).toBeNull();
  });
  it('aula cancelada não mostra presença confirmada', () => {
    const confirmed = { status: 'CONFIRMED', waitlistPosition: null };
    expect(myAttendanceLabel(confirmed, 'CANCELLED')).toBe('Aula cancelada');
    expect(myAttendanceLabel({ status: 'WAITLIST', waitlistPosition: 2 }, 'CANCELLED')).toBe(
      'Aula cancelada',
    );
    expect(myAttendanceLabel(confirmed, 'OPEN')).toBe('Presença confirmada');
    expect(myAttendanceLabel(null, 'CANCELLED')).toBeNull();
  });
  it('ocupação', () => {
    expect(occupancyLabel({ confirmedCount: 8, capacity: 10 })).toBe('8/10 confirmados');
  });
});

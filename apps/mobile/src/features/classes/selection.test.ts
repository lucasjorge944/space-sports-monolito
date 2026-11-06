import {
  eligibleGroups,
  groupDisabledReason,
  groupsOverlap,
  isSelectionComplete,
  type PublicGroup,
  selectionInstruction,
  selectionProgress,
  spotsLabel,
  toggleGroup,
} from './selection';

const group = (id: string, extra: Partial<PublicGroup> = {}): PublicGroup => ({
  id,
  name: `Turma ${id}`,
  sport: { id: 'sp1', name: 'Futevôlei', slug: 'futevolei' },
  level: null,
  court: { id: 'c1', name: 'Quadra A' },
  weekday: 6,
  startTime: '07:00',
  durationMin: 60,
  capacity: 10,
  enrolledCount: 2,
  availableSpots: 8,
  teachers: [{ name: 'Ana', avatarUrl: null }],
  ...extra,
});

const nx = (n: number) => ({ weeklyFrequency: n });
const unlimited = { weeklyFrequency: null };

describe('eligibleGroups', () => {
  it('mantém só as turmas do esporte do plano', () => {
    const groups = [group('a'), group('b', { sport: { id: 'sp2', name: 'Vôlei', slug: 'volei' } })];
    const plan = { sport: { id: 'sp1', name: 'Futevôlei', slug: 'futevolei' } } as never;
    expect(eligibleGroups(plan, groups).map((g) => g.id)).toEqual(['a']);
  });
});

describe('groupsOverlap', () => {
  it('só conflita no mesmo dia com horários que se cruzam', () => {
    const a = group('a', { startTime: '07:00', durationMin: 60 });
    expect(groupsOverlap(a, group('b', { startTime: '07:30' }))).toBe(true);
    expect(groupsOverlap(a, group('b', { startTime: '08:00' }))).toBe(false);
    expect(groupsOverlap(a, group('b', { startTime: '06:00', durationMin: 60 }))).toBe(false);
    expect(groupsOverlap(a, group('b', { weekday: 2, startTime: '07:00' }))).toBe(false);
  });
});

describe('seleção de turmas (RN-CLASS-01)', () => {
  const groups = [
    group('a', { weekday: 2 }),
    group('b', { weekday: 4 }),
    group('c', { weekday: 6 }),
    group('d', { weekday: 6, startTime: '07:30' }),
    group('full', { weekday: 1, availableSpots: 0 }),
  ];

  it('Nx/semana trava a escolha em exatamente N turmas', () => {
    let ids: string[] = [];
    ids = toggleGroup(nx(2), groups, ids, 'a');
    ids = toggleGroup(nx(2), groups, ids, 'b');
    ids = toggleGroup(nx(2), groups, ids, 'c');
    expect(ids).toEqual(['a', 'b']);
    expect(isSelectionComplete(nx(2), ids.length)).toBe(true);
    expect(isSelectionComplete(nx(2), 1)).toBe(false);
    expect(isSelectionComplete(nx(2), 3)).toBe(false);
  });

  it('desmarcar libera a vaga da escolha', () => {
    const ids = toggleGroup(nx(1), groups, ['a'], 'a');
    expect(ids).toEqual([]);
    expect(toggleGroup(nx(1), groups, ids, 'b')).toEqual(['b']);
  });

  it('ilimitado aceita uma ou mais turmas', () => {
    const ids = ['a', 'b', 'c'].reduce(
      (acc, id) => toggleGroup(unlimited, groups, acc, id),
      [] as string[],
    );
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(isSelectionComplete(unlimited, 0)).toBe(false);
    expect(isSelectionComplete(unlimited, 1)).toBe(true);
    expect(isSelectionComplete(unlimited, 15)).toBe(false);
  });

  it('não deixa marcar turma lotada nem em horário já escolhido', () => {
    const c = groups[2] as PublicGroup;
    const d = groups[3] as PublicGroup;
    const full = groups[4] as PublicGroup;
    expect(groupDisabledReason(unlimited, full, [])).toBe('FULL');
    expect(groupDisabledReason(unlimited, d, [c])).toBe('OVERLAP');
    expect(groupDisabledReason(nx(1), groups[0] as PublicGroup, [c])).toBe('LIMIT');
    expect(groupDisabledReason(nx(1), c, [c])).toBeNull();
    expect(toggleGroup(unlimited, groups, ['c'], 'd')).toEqual(['c']);
    expect(toggleGroup(unlimited, groups, [], 'full')).toEqual([]);
  });
});

describe('textos', () => {
  it('instrução e progresso por frequência', () => {
    expect(selectionInstruction(nx(1))).toBe('Escolha a turma da sua aula da semana.');
    expect(selectionInstruction(nx(2))).toBe(
      'Escolha exatamente 2 turmas, uma para cada aula da semana.',
    );
    expect(selectionInstruction(unlimited)).toMatch(/quantas vezes quiser/);
    expect(selectionProgress(nx(2), 1)).toBe('1 de 2 turmas escolhidas');
    expect(selectionProgress(unlimited, 1)).toBe('1 turma escolhida');
    expect(selectionProgress(unlimited, 3)).toBe('3 turmas escolhidas');
  });

  it('vagas', () => {
    expect(spotsLabel(0)).toBe('Lotada');
    expect(spotsLabel(1)).toBe('1 vaga');
    expect(spotsLabel(5)).toBe('5 vagas');
  });
});

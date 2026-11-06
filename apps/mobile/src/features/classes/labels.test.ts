import { teachersFull, teachersSummary } from './labels';

const people = (...names: string[]) => names.map((name) => ({ name }));

describe('professores de uma aula (decisão 47)', () => {
  it('nas listas, um professor e +N', () => {
    expect(teachersSummary(people('Ana'))).toBe('Prof. Ana');
    expect(teachersSummary(people('Ana', 'Bia', 'Caio'))).toBe('Prof. Ana +2');
    expect(teachersSummary([])).toBeNull();
  });

  it('nos detalhes, todos os nomes', () => {
    expect(teachersFull(people('Ana'))).toBe('Ana');
    expect(teachersFull(people('Ana', 'Bia'))).toBe('Ana e Bia');
    expect(teachersFull(people('Ana', 'Bia', 'Caio'))).toBe('Ana, Bia e Caio');
    expect(teachersFull([])).toBe('');
  });
});

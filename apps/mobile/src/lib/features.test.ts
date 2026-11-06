import { FEATURES, isServiceVisible } from './features';

describe('FEATURES', () => {
  afterEach(() => {
    FEATURES.tournaments = false;
  });

  it('torneios ficam ocultos', () => {
    expect(FEATURES.tournaments).toBe(false);
    expect(['RENTAL', 'CLASSES', 'TOURNAMENTS'].filter(isServiceVisible)).toEqual([
      'RENTAL',
      'CLASSES',
    ]);
  });

  it('voltam ao ligar a constante', () => {
    FEATURES.tournaments = true;
    expect(isServiceVisible('TOURNAMENTS')).toBe(true);
  });
});

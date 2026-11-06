import { cn } from './utils';

describe('cn', () => {
  it('o último peso vence, inclusive entre Inter e Space Grotesk', () => {
    expect(cn('font-display-semibold text-lg', 'font-medium')).toBe('text-lg font-medium');
    expect(cn('font-medium', 'font-display-bold')).toBe('font-display-bold');
  });

  it('família e peso de display convivem com font-sans e tabular-nums', () => {
    expect(cn('font-sans', 'font-display-semibold', 'tabular-nums')).toBe(
      'font-sans font-display-semibold tabular-nums',
    );
  });
});

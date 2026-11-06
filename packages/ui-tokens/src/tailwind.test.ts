import { describe, expect, it } from 'vitest';
import { colorTokens, cssVarName } from './colors';
import { tailwindColors, tailwindPreset } from './tailwind';

describe('tailwindColors', () => {
  it('mapeia cada token para hsl(var(--token))', () => {
    expect(Object.keys(tailwindColors)).toHaveLength(colorTokens.length);
    expect(tailwindColors.primary).toBe('hsl(var(--primary))');
    expect(tailwindColors['sidebar-primary-foreground']).toBe(
      `hsl(var(${cssVarName('sidebarPrimaryForeground')}))`,
    );
    expect(tailwindColors['chart-1']).toBe('hsl(var(--chart-1))');
  });

  it('entra no preset com dark mode por classe', () => {
    expect(tailwindPreset.darkMode).toBe('class');
    expect(tailwindPreset.theme.extend.colors).toMatchObject(tailwindColors);
  });

  it('traz as primitivas da marca, a família display e os estilos de texto', () => {
    expect(tailwindPreset.theme.extend.colors.mar[500]).toBe('#03547D');
    expect(tailwindPreset.theme.extend.colors.sol[100]).toBe('#FEECB3');
    expect(tailwindPreset.theme.extend.fontFamily.display[0]).toBe('Space Grotesk');
    expect(tailwindPreset.theme.extend.fontSize.h1).toEqual([
      '48px',
      { lineHeight: '56px', letterSpacing: '-0.48px' },
    ]);
    expect(tailwindPreset.theme.extend.fontSize.body).toEqual(['16px', { lineHeight: '24px' }]);
  });
});

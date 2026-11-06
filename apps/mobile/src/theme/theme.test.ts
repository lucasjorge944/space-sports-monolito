import { nativewindVars, radiusBase, themes as tokenThemes } from '@space-sports/ui-tokens';
import { color, cssVars, themes } from './theme';

describe('theme', () => {
  it('claro e escuro definem os mesmos tokens', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it('cssVars prefixa os tokens com -- e inclui o raio', () => {
    const vars = cssVars('light');
    expect(vars['--background']).toBe(nativewindVars(tokenThemes.light)['--background']);
    expect(vars['--primary']).toBe(nativewindVars(tokenThemes.light)['--primary']);
    expect(vars['--radius']).toBe(`${radiusBase}px`);
  });

  it('color retorna o valor de cor do token para APIs nativas', () => {
    expect(color('light', 'background')).toBe(tokenThemes.light.background);
  });

  it('usa os valores de cor do tema escuro do pacote', () => {
    expect(color('dark', 'background')).toBe(tokenThemes.dark.background);
    expect(cssVars('dark')['--primary']).toBe(nativewindVars(tokenThemes.dark)['--primary']);
  });
});

describe('fonte mono (token fontFamily.mono)', () => {
  it('usa a família da pilha do token que existe em cada sistema', () => {
    const { monoFontFamily } = require('./theme') as typeof import('./theme');
    expect(monoFontFamily('ios')).toBe('Menlo');
    expect(monoFontFamily('android')).toBe('monospace');
  });
});

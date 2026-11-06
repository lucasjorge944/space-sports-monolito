import {
  type colorTokens,
  type cssVarName,
  fontFamily,
  nativewindVars,
  radiusBase,
  type ThemeColors,
  type ThemeName,
  themes,
} from '@space-sports/ui-tokens';
import { Platform } from 'react-native';

export type { ThemeName };

type ColorToken = (typeof colorTokens)[number];
type CssToken = ReturnType<typeof cssVarName>;
export type ThemeToken = ColorToken | CssToken;

/** Tokens de cor hex, para APIs nativas que não consomem classes Tailwind. */
export { themes };

/** Raio base (`--radius`) exportado pelo pacote, em px. */
export const radius = radiusBase;

/** Variáveis CSS (`--background`, ...) de um tema, prontas para `vars()` do NativeWind. */
export function cssVars(name: ThemeName): Record<string, string> {
  return {
    ...nativewindVars(themes[name]),
    '--radius': `${radius}px`,
  };
}

/** Cor hex pronta para APIs que não usam classes (navegação, ícones, status bar). */
export function color(name: ThemeName, token: ThemeToken): string {
  const normalizedToken = token
    .replace(/^--/, '')
    .replace(/-([a-z0-9])/g, (_, character: string) =>
      character.toUpperCase(),
    ) as keyof ThemeColors;
  return themes[name][normalizedToken];
}

/**
 * Família mono do token `fontFamily.mono` que existe no aparelho: no iOS a Menlo, no Android a
 * `monospace` do sistema (a pilha do token é a do web; o RN aceita só um nome).
 */
export function monoFontFamily(os: string = Platform.OS): string {
  const stack: readonly string[] = fontFamily.mono;
  const native = os === 'ios' ? 'Menlo' : 'monospace';
  return stack.includes(native) ? native : (stack[stack.length - 1] ?? native);
}

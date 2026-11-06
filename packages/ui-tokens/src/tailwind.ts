import { colorTokens, cssVarName, palette } from './colors';
import { radius } from './layout';
import { fontFamily, textStyles } from './typography';

/**
 * Cores para o `tailwind.config.js` do mobile (Tailwind 3 + NativeWind), lendo as variáveis
 * em canais HSL de `generated/nativewind.css`: `{ primary: 'hsl(var(--primary))', ... }`.
 * Chaves planas: `primary-foreground` gera `bg-primary-foreground`, igual à web.
 */
export const tailwindColors: Record<string, string> = Object.fromEntries(
  colorTokens.map((t) => [cssVarName(t).slice(2), `hsl(var(${cssVarName(t)}))`]),
);

/**
 * Estilos da prancha 05 no formato `fontSize` do Tailwind 3 (`text-h1`, `text-overline`), com o
 * espaçamento em px (o React Native não aceita `em`). O peso fica de fora: no app cada peso é uma
 * família (`InterSemiBold`, `SpaceGrotesk_700Bold`), escolhida pela classe de fonte.
 */
export const tailwindTextStyles: Record<
  string,
  [string, { lineHeight: string; letterSpacing?: string }]
> = Object.fromEntries(
  Object.entries(textStyles).map(([name, s]) => [
    name,
    [
      `${s.size}px`,
      {
        lineHeight: `${s.lineHeight}px`,
        ...(s.letterSpacing
          ? { letterSpacing: `${+(s.letterSpacing * s.size).toFixed(2)}px` }
          : {}),
      },
    ],
  ]),
);

/** Preset do Tailwind 3 para o mobile: `presets: [require('@space-sports/ui-tokens').tailwindPreset]`. */
export const tailwindPreset = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ...tailwindColors, ...palette },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
      },
      fontFamily: {
        sans: [...fontFamily.sans],
        display: [...fontFamily.display],
        mono: [...fontFamily.mono],
      },
      fontSize: tailwindTextStyles,
    },
  },
};

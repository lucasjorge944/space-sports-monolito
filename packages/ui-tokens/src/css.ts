import {
  type ColorToken,
  colorTokens,
  cssVarName,
  palette,
  type ThemeColors,
  themes,
} from './colors';
import { radius, radiusBase, shadow, spacingUnit } from './layout';
import { toHslChannels } from './native';
import { fontFamily, fontSize, textStyles } from './typography';

const HEADER = '/* Gerado por scripts/generate-css.mjs a partir de src/. Não edite à mão. */\n';

const rem = (px: number) => `${px / 16}rem`;
const fontStack = (fonts: readonly string[]) =>
  fonts.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`;
}

/** `sm` → `calc(var(--radius) - 6px)`: os raios acompanham o `--radius`, como no shadcn. */
function radiusVar(px: number): string {
  const diff = px - radiusBase;
  if (diff === 0) return 'var(--radius)';
  return `calc(var(--radius) ${diff > 0 ? '+' : '-'} ${Math.abs(diff)}px)`;
}

function colorVars(colors: Partial<ThemeColors>, format: (hex: string) => string = (h) => h) {
  return colorTokens
    .filter((t): t is ColorToken => colors[t] !== undefined)
    .map((t) => `${cssVarName(t)}: ${format(colors[t] as string)};`);
}

/**
 * CSS da web: variáveis em `:root`/`.dark` e mapeamento para o Tailwind v4 (`@theme`). O claro
 * também vale em `.light`, para um trecho da página ficar claro dentro do escuro (pré-visualização
 * dos anúncios no `/super`, AD.1); o next-themes já põe `light` no `<html>` no tema claro.
 */
export function generateThemeCss(): string {
  const themeInline = [
    ...colorTokens.map((t) => `--color-${cssVarName(t).slice(2)}: var(${cssVarName(t)});`),
    ...(['sm', 'md', 'lg', 'xl'] as const).map((r) => `--radius-${r}: ${radiusVar(radius[r])};`),
  ];
  const themeStatic = [
    // Primitivas da marca: `bg-mar-500`, `bg-sol-100`, `text-neutral-600` (substituem o neutral do Tailwind).
    ...Object.entries(palette).flatMap(([name, scale]) =>
      Object.entries(scale).map(([step, hex]) => `--color-${name}-${step}: ${hex};`),
    ),
    `--font-sans: ${fontStack(fontFamily.sans)};`,
    `--font-display: ${fontStack(fontFamily.display)};`,
    `--font-mono: ${fontStack(fontFamily.mono)};`,
    `--spacing: ${rem(spacingUnit)};`,
    ...Object.entries(fontSize).flatMap(([name, { size, lineHeight }]) => [
      `--text-${name}: ${rem(size)};`,
      `--text-${name}--line-height: ${rem(lineHeight)};`,
    ]),
    // Estilos da prancha 05: `text-h1 font-display`, `text-overline uppercase`.
    ...Object.entries(textStyles).flatMap(([name, style]) => [
      `--text-${name}: ${rem(style.size)};`,
      `--text-${name}--line-height: ${rem(style.lineHeight)};`,
      `--text-${name}--font-weight: ${style.weight};`,
      ...(style.letterSpacing ? [`--text-${name}--letter-spacing: ${style.letterSpacing}em;`] : []),
    ]),
    ...Object.entries(shadow).map(([name, value]) => `--shadow-${name}: ${value};`),
  ];

  return [
    HEADER,
    '@custom-variant dark (&:is(.dark *));\n',
    block(':root,\n.light', [`--radius: ${rem(radiusBase)};`, ...colorVars(themes.light)]),
    block('.dark', colorVars(themes.dark)),
    block('@theme inline', themeInline),
    block('@theme', themeStatic),
  ].join('\n');
}

/** CSS do app (NativeWind + React Native Reusables): canais HSL em `:root` e `.dark:root`. */
export function generateNativewindCss(): string {
  return [
    HEADER,
    block(':root', [`--radius: ${radiusBase}px;`, ...colorVars(themes.light, toHslChannels)]),
    block('.dark:root', colorVars(themes.dark, toHslChannels)),
  ].join('\n');
}

export const generatedCssFiles = {
  'theme.css': generateThemeCss,
  'nativewind.css': generateNativewindCss,
} as const;

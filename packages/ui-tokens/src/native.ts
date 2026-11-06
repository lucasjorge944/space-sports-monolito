import { colorTokens, cssVarName, type ThemeColors } from './colors';
import { hexToRgb, splitAlpha } from './contrast';

/**
 * `#C2410C` → `"17.1 88.4% 40.4%"` (formato de canais HSL usado pelo React Native Reusables).
 * Com alfa (`#06202E99`, como o `scrim`), acrescenta `/ 0.6`: `hsl(var(--scrim))` continua válido.
 */
export function toHslChannels(color: string): string {
  const { hex, alpha } = splitAlpha(color);
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  const channels = `${round(h)} ${round(s * 100)}% ${round(l * 100)}%`;
  return alpha < 1 ? `${channels} / ${+alpha.toFixed(2)}` : channels;
}

/**
 * Variáveis CSS de um tema, para o `vars()` do NativeWind.
 * `format: 'hsl'` gera canais HSL (`hsl(var(--x))` no tailwind.config); `'hex'` gera a cor direta.
 */
export function nativewindVars(
  colors: ThemeColors,
  format: 'hex' | 'hsl' = 'hsl',
): Record<`--${string}`, string> {
  const vars: Record<`--${string}`, string> = {};
  for (const token of colorTokens) {
    vars[cssVarName(token)] = format === 'hsl' ? toHslChannels(colors[token]) : colors[token];
  }
  return vars;
}

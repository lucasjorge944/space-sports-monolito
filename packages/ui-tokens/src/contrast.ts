/** Contraste WCAG 2.x entre duas cores hex (#RRGGBB). */

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Cor inválida (esperado #RRGGBB): ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#06202E99` → `{ hex: '#06202E', alpha: 0.6 }`. Aceita `#RRGGBB` (alfa 1) e `#RRGGBBAA`. */
export function splitAlpha(color: string): { hex: string; alpha: number } {
  const match = /^(#[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match?.[1]) throw new Error(`Cor inválida (esperado #RRGGBB ou #RRGGBBAA): ${color}`);
  return { hex: match[1], alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1 };
}

/** Cor com alfa (ex.: o `scrim`) composta sobre um fundo opaco: o `#RRGGBB` que aparece na tela. */
export function compositeOver(color: string, background: string): string {
  const { hex, alpha } = splitAlpha(color);
  const fg = hexToRgb(hex);
  const bg = hexToRgb(background);
  return `#${fg
    .map((c, i) => Math.round(alpha * c + (1 - alpha) * (bg[i] as number)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

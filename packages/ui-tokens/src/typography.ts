/**
 * Tipografia. Tamanhos em px (React Native usa números; o CSS converte para rem com base 16).
 * Duas famílias (prancha 05): Space Grotesk (display: títulos, números de destaque e logo) e
 * Inter (interface). Use `tabular-nums` em preços, horários e placares.
 */

const systemSans = [
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'sans-serif',
];

export const fontFamily = {
  /** Inter: texto de interface (400–600). */
  sans: ['Inter', ...systemSans],
  /** Space Grotesk: display, títulos h1–h3, números de destaque e logo (400–700). */
  display: ['Space Grotesk', ...systemSans],
  mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Escala utilitária, para o texto denso do painel e da interface. Papéis sugeridos:
 * - xs: legendas, metadados (nunca para texto essencial no app)
 * - sm: texto denso do painel (tabelas, agenda)
 * - base: corpo de texto no app (mínimo para leitura ao sol)
 * - lg/xl: títulos de card e de seção
 * - 2xl/3xl: título de tela
 * - 4xl: números de destaque (placar, dashboard)
 */
export const fontSize = {
  xs: { size: 12, lineHeight: 16 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 28 },
  '2xl': { size: 24, lineHeight: 32 },
  '3xl': { size: 30, lineHeight: 36 },
  '4xl': { size: 36, lineHeight: 40 },
} as const;

export type FontSizeToken = keyof typeof fontSize;

export interface TextStyle {
  family: FontFamilyToken;
  size: number;
  lineHeight: number;
  weight: (typeof fontWeight)[keyof typeof fontWeight];
  /** Em `em` (fração do tamanho): -0.02 = -0,02em. */
  letterSpacing: number;
  uppercase?: boolean;
}

/**
 * Estilos de texto da marca (prancha 05). Na web viram `text-display`, `text-h1`… (tamanho,
 * altura de linha, peso e espaçamento); a família vem de `font-display`/`font-sans`.
 */
export const textStyles = {
  display: { family: 'display', size: 64, lineHeight: 72, weight: '700', letterSpacing: -0.02 },
  h1: { family: 'display', size: 48, lineHeight: 56, weight: '700', letterSpacing: -0.01 },
  h2: { family: 'display', size: 36, lineHeight: 44, weight: '600', letterSpacing: 0 },
  h3: { family: 'display', size: 24, lineHeight: 32, weight: '600', letterSpacing: 0 },
  'body-lg': { family: 'sans', size: 18, lineHeight: 28, weight: '400', letterSpacing: 0 },
  body: { family: 'sans', size: 16, lineHeight: 24, weight: '400', letterSpacing: 0 },
  small: { family: 'sans', size: 14, lineHeight: 20, weight: '500', letterSpacing: 0 },
  helper: { family: 'sans', size: 13, lineHeight: 18, weight: '400', letterSpacing: 0 },
  overline: {
    family: 'sans',
    size: 12,
    lineHeight: 16,
    weight: '600',
    letterSpacing: 0.12,
    uppercase: true,
  },
} as const satisfies Record<string, TextStyle>;

export type TextStyleToken = keyof typeof textStyles;

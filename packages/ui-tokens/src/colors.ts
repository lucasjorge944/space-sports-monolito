/**
 * Cores semânticas na convenção shadcn/ui (mesmos nomes das variáveis CSS, em camelCase).
 * Hex `#RRGGBB`; só o `scrim` (véu) e o `outlineBackground` do escuro têm alfa, em `#RRGGBBAA`.
 * Fonte única: o CSS em `generated/` é gerado a partir deste arquivo (`pnpm generate`).
 *
 * Marca do kit de 2026-10-29 (`docs/brand/kit/`): Mar (primária), Sol (destaque), Noite (texto e
 * modo escuro) e Rede (superfícies).
 */

/** As quatro cores da marca (prancha 04). */
export const brandColors = {
  mar: '#03547D',
  sol: '#FBBD10',
  noite: '#06202E',
  rede: '#FFFFFF',
} as const;

/** Escalas 50–900 da prancha 04. Base: Mar 500, Sol 400. Primitivas: use os tokens semânticos na UI. */
export const palette = {
  mar: {
    50: '#E6F1F7',
    100: '#C2DCEA',
    200: '#8FBFD8',
    300: '#579DC0',
    400: '#2A7CA4',
    500: '#03547D',
    600: '#034868',
    700: '#033A54',
    800: '#052D41',
    900: '#06202E',
  },
  sol: {
    50: '#FFF8E1',
    100: '#FEECB3',
    200: '#FDDD7A',
    300: '#FCCD45',
    400: '#FBBD10',
    500: '#E2A40A',
    600: '#BC8507',
    700: '#8F6407',
    800: '#66470A',
    900: '#42300B',
  },
  neutral: {
    50: '#F7F9FA',
    100: '#EEF2F4',
    200: '#DCE3E6',
    300: '#BCC6CB',
    400: '#94A1A8',
    500: '#66757D',
    600: '#4A5A63',
    700: '#2A3B44',
    800: '#15262F',
    900: '#06202E',
  },
} as const;

export type PaletteName = keyof typeof palette;
export type PaletteStep = keyof (typeof palette)['mar'];

/** Funcionais do kit (prancha 04, e as do escuro na prancha 07). */
export const functionalColors = {
  success: '#1F9D6B',
  warning: '#E07B12',
  error: '#D9483B',
  info: '#2A7CA4',
} as const;

/**
 * Superfícies e textos da prancha 07 (tabela claro/escuro). No claro coincidem com a escala
 * Neutra; no escuro são tons próprios do kit, entre Noite e Mar 800.
 */
export const surfaces = {
  light: {
    base: palette.neutral[50],
    surface: '#FFFFFF',
    raised: palette.neutral[100],
    border: palette.neutral[200],
    text: '#06202E',
    textSecondary: palette.neutral[600],
  },
  dark: {
    base: '#071A24',
    surface: '#0C2633',
    raised: '#12313F',
    border: '#1E4152',
    text: '#F2F6F8',
    textSecondary: '#A9BCC6',
  },
} as const;

export const colorTokens = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'destructiveForeground',
  'success',
  'successForeground',
  'warning',
  'warningForeground',
  'info',
  'infoForeground',
  'destructiveSubtle',
  'destructiveSubtleForeground',
  'successSubtle',
  'successSubtleForeground',
  'warningSubtle',
  'warningSubtleForeground',
  'infoSubtle',
  'infoSubtleForeground',
  'link',
  'border',
  'input',
  'ring',
  'ringOffset',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing',
  // Acréscimos da auditoria do web (tarefa 2.34, `docs/brand/auditoria-web.md`).
  'inverse',
  'inverseForeground',
  'disabled',
  'disabledForeground',
  'linkHover',
  'eyebrow',
  'inputBackground',
  'inputFocus',
  'inputFocusBackground',
  'chip',
  'chipForeground',
  'chipBorder',
  'chipSelected',
  'chipSelectedForeground',
  'scrim',
  // Acréscimos da revisão da 2.35 (tarefa 2.37): botão de contorno, campo desabilitado e aba ativa.
  'outlineBorder',
  'outlineBackground',
  'inputDisabled',
  'tabActive',
  'tabActiveBorder',
  // Acréscimos da A.2 (ajustes pós-piloto): contorno dos status, estados do chip e campo com erro.
  'destructiveSubtleBorder',
  'successSubtleBorder',
  'warningSubtleBorder',
  'infoSubtleBorder',
  'chipHover',
  'chipSelectedBorder',
  'inputError',
  'inputErrorBackground',
  'inputErrorForeground',
  // Acréscimos da AD.1 (Explorar e anúncios): selo "Patrocinado" e peças sobre foto.
  'sponsored',
  'sponsoredForeground',
  'mediaOverlay',
  'mediaForeground',
  'mediaAction',
  'mediaActionForeground',
  // Acréscimos da PG.1 (pagamento online): selo "Ambiente de teste", valor de entrada e QR do Pix.
  'sandbox',
  'sandboxForeground',
  'sandboxBorder',
  'amountPositive',
  'qrPlate',
  'qrModule',
  // Acréscimos da AV.1 (avaliações): estrela cheia (preenchimento e contorno) e estrela vazia.
  'rating',
  'ratingBorder',
  'ratingEmpty',
] as const;

export type ColorToken = (typeof colorTokens)[number];
export type ThemeColors = Record<ColorToken, string>;
export type ThemeName = 'light' | 'dark';

const { mar, sol, neutral } = palette;
const { noite, rede } = brandColors;

/**
 * Selo "Patrocinado" e peças sobre foto (AD.1). Sempre aparecem sobre uma imagem, que é a mesma
 * nos dois temas, e por isso os valores não mudam com o tema: a pílula Noite + branco do card de
 * quadra (prancha 06), o degradê de leitura em Noite (opacidades em `mediaOverlayStops`, no
 * layout.ts) e o botão Sol + Noite. O Sol não vai para o selo: anúncio não deve chamar mais
 * atenção que o resto da lista.
 */
const mediaColors = {
  sponsored: noite,
  sponsoredForeground: rede,
  mediaOverlay: noite,
  mediaForeground: rede,
  mediaAction: sol[400],
  mediaActionForeground: noite,
} as const satisfies Partial<ThemeColors>;

/**
 * QR do Pix (PG.1): sempre módulos escuros sobre placa branca, nos dois temas. Leitores de QR de
 * bancos falham com QR invertido (claro sobre escuro), então a placa não segue o tema.
 */
const qrColors = {
  qrPlate: rede,
  qrModule: noite,
} as const satisfies Partial<ThemeColors>;

/** Texto de sucesso (Confirmado, Pago); também o valor de entrada (`amountPositive`). */
const successText = { light: '#146B49', dark: '#3CC48A' } as const;

/** Tema claro: tabela da prancha 07 (coluna Claro) e status tingidos da prancha 06. */
export const light: ThemeColors = {
  background: surfaces.light.base,
  foreground: surfaces.light.text,
  card: surfaces.light.surface,
  cardForeground: surfaces.light.text,
  popover: surfaces.light.surface,
  popoverForeground: surfaces.light.text,
  primary: mar[500],
  primaryForeground: rede,
  secondary: sol[400], // botão "Destaque"
  secondaryForeground: noite,
  muted: surfaces.light.raised,
  mutedForeground: surfaces.light.textSecondary,
  accent: surfaces.light.raised, // hover e seleção (bg/raised)
  accentForeground: surfaces.light.text,
  // Erro do kit (#D9483B) escurecido o mínimo para 4.5:1 com branco e como texto no fundo.
  destructive: '#C84236',
  destructiveForeground: rede,
  // Sucesso e alerta do kit com texto Noite (com branco ficam em 3.5 e 3.0:1).
  success: functionalColors.success,
  successForeground: noite,
  warning: functionalColors.warning,
  warningForeground: noite,
  info: functionalColors.info,
  infoForeground: rede,
  // Status tingidos (Cancelado, Confirmado, Pendente). Use os -foreground para texto colorido.
  // A borda, um tom acima do fundo, dá ao badge um contorno limpo sobre branco.
  destructiveSubtle: '#FBE5E3',
  destructiveSubtleForeground: '#9E2A20',
  destructiveSubtleBorder: '#F3B8B2',
  successSubtle: '#E3F4EC',
  successSubtleForeground: successText.light,
  successSubtleBorder: '#A9DFC6',
  // O Pendente da prancha 06 (#FCF1D9 + #7A5306) parece sujo em uso: amarelo mais vivo, texto âmbar.
  warningSubtle: '#FFE69C',
  warningSubtleForeground: '#663C00',
  warningSubtleBorder: sol[400],
  infoSubtle: mar[50],
  infoSubtleForeground: mar[700],
  infoSubtleBorder: '#A9CFE3',
  link: mar[500],
  border: surfaces.light.border,
  // Borda de campo: o #BCC6CB da prancha 06 escurecido o mínimo para 3:1 (WCAG 1.4.11).
  input: '#7F8C93',
  // Anel Sol (1.6:1 no fundo claro) com a faixa de offset em Mar, que garante os 3:1.
  ring: sol[400],
  ringOffset: mar[500],
  chart1: mar[500],
  chart2: sol[600], // o Sol puro tem 1.6:1 no fundo claro
  chart3: neutral[500],
  chart4: functionalColors.success,
  chart5: functionalColors.error, // coral
  sidebar: surfaces.light.surface,
  sidebarForeground: surfaces.light.text,
  sidebarPrimary: mar[500],
  sidebarPrimaryForeground: rede,
  sidebarAccent: surfaces.light.raised,
  sidebarAccentForeground: surfaces.light.text,
  sidebarBorder: surfaces.light.border,
  sidebarRing: sol[400],
  // Botão "Escuro" da prancha 06 (Noite + branco).
  inverse: noite,
  inverseForeground: rede,
  // Botão "Indisponível" da prancha 06.
  disabled: neutral[200],
  disabledForeground: neutral[500],
  linkHover: mar[700], // `a:hover` das pranchas
  // Rótulo acima do título ("04 · Interface" da prancha 06).
  eyebrow: mar[500],
  // Campo da prancha 06: fundo branco; em foco, borda Mar e fundo Sol 50.
  inputBackground: surfaces.light.surface,
  inputFocus: mar[500],
  inputFocusBackground: sol[50],
  // Campo com erro: borda no vermelho de erro, fundo com um toque de vermelho e mensagem no tom forte.
  inputError: '#C84236',
  inputErrorBackground: '#FFF5F4',
  inputErrorForeground: '#9E2A20',
  // Chips neutros, na mesma receita da prancha 07 (bg/raised com borda): o Sol fica para o selecionado.
  chip: surfaces.light.raised,
  chipForeground: surfaces.light.text,
  chipBorder: surfaces.light.border,
  chipHover: surfaces.light.border,
  // Sol + Noite, como no escuro. O Sol tem 1.6:1 no fundo claro: a borda Noite dá os 3:1.
  chipSelected: sol[400],
  chipSelectedForeground: noite,
  chipSelectedBorder: noite,
  // Véu de diálogos e sheets: Noite a 60% (#RRGGBBAA).
  scrim: `${noite}99`,
  // Botão "Convidar" da prancha 06: borda 1.5 Noite e fundo branco, opaco sobre qualquer superfície.
  outlineBorder: surfaces.light.text,
  outlineBackground: surfaces.light.surface,
  // Derivado: igual ao `disabled`, que no claro já é mais escuro que o campo ativo.
  inputDisabled: neutral[200],
  // Aba ativa: branco sobre o trilho `muted`, com a borda sumindo no preenchimento.
  tabActive: surfaces.light.surface,
  tabActiveBorder: surfaces.light.surface,
  // Selo "Patrocinado" e peças sobre foto (AD.1): iguais nos dois temas, ver `mediaColors`.
  ...mediaColors,
  // Selo "Ambiente de teste" (PG.1): o laranja de alerta do kit com texto Noite (5.6:1). O laranja
  // tem 2.8:1 sobre o fundo: a borda Noite separa o selo da superfície, como no chip selecionado.
  sandbox: functionalColors.warning,
  sandboxForeground: noite,
  sandboxBorder: noite,
  // Valor de entrada (venda, taxa devolvida) em extratos e na carteira. Saída fica em `foreground`
  // com o sinal de menos: cor nunca é o único sinal.
  amountPositive: successText.light,
  ...qrColors,
  // Estrela das avaliações (AV.1): o Sol da marca no preenchimento, mas o Sol sozinho tem 1.6:1 no
  // fundo claro. O contorno Sol 700 dá os 3:1 (≥ 4.6:1 em fundo, card e `muted`), como a borda
  // Noite do chip selecionado. A estrela vazia é só contorno, na cor da borda de campo (≥ 3:1).
  rating: sol[400],
  ratingBorder: sol[700],
  ratingEmpty: '#7F8C93',
};

/** Borda de campo no escuro; a aba ativa usa a mesma. */
const darkFieldBorder = '#607B89';

/**
 * Tema escuro: tabela da prancha 07 (coluna Escuro). O Sol assume a ação principal (o Mar tem
 * 2.2:1 sobre Noite) e o Mar 400 a secundária; elevação por superfície (surface → raised).
 */
export const dark: ThemeColors = {
  background: surfaces.dark.base,
  foreground: surfaces.dark.text,
  card: surfaces.dark.surface,
  cardForeground: surfaces.dark.text,
  popover: surfaces.dark.surface,
  popoverForeground: surfaces.dark.text,
  primary: sol[400],
  primaryForeground: noite,
  secondary: mar[400],
  secondaryForeground: rede,
  muted: surfaces.dark.raised,
  mutedForeground: surfaces.dark.textSecondary,
  accent: surfaces.dark.raised,
  accentForeground: surfaces.dark.text,
  destructive: '#F2685B',
  destructiveForeground: noite,
  success: '#3CC48A',
  successForeground: noite,
  warning: '#F29A3A',
  warningForeground: noite,
  info: mar[300], // o kit não traz info no escuro
  infoForeground: noite,
  destructiveSubtle: '#3F1A1A', // derivado na lógica de Confirmado
  destructiveSubtleForeground: '#F2685B',
  destructiveSubtleBorder: '#7A2F2B',
  successSubtle: '#12392C',
  successSubtleForeground: successText.dark,
  successSubtleBorder: '#1F6B4E',
  // O Pendente da prancha 07 (#3D2410 + #F29A3A) fica barrento: dourado na família do Sol.
  warningSubtle: '#4A3604',
  warningSubtleForeground: sol[300],
  warningSubtleBorder: sol[700],
  infoSubtle: '#0F3448',
  infoSubtleForeground: mar[200],
  infoSubtleBorder: '#2A6486',
  link: mar[200],
  border: surfaces.dark.border,
  // Borda de campo: o #1E4152 do kit clareado o mínimo para 3:1 no fundo, no card e no campo.
  input: darkFieldBorder,
  ring: sol[400],
  ringOffset: surfaces.dark.base,
  chart1: sol[400],
  chart2: mar[300],
  chart3: surfaces.dark.textSecondary,
  chart4: '#3CC48A',
  chart5: '#F2685B',
  sidebar: surfaces.dark.surface,
  sidebarForeground: surfaces.dark.text,
  sidebarPrimary: sol[400],
  sidebarPrimaryForeground: noite,
  sidebarAccent: surfaces.dark.raised,
  sidebarAccentForeground: surfaces.dark.text,
  sidebarBorder: surfaces.dark.border,
  sidebarRing: sol[400],
  // O kit não traz o botão escuro no escuro: inverte (Noite sumiria sobre o fundo).
  inverse: surfaces.dark.text,
  inverseForeground: noite,
  // Derivado: borda do kit como fundo e o #7F949F (divisória forte da tabela da prancha 07) no texto.
  disabled: surfaces.dark.border,
  disabledForeground: '#7F949F',
  linkHover: mar[100],
  eyebrow: sol[300], // "05 · Tema" da prancha 07
  // Campo da prancha 07: fundo bg/raised. Em foco, borda no tom do link (o anel já é Sol).
  inputBackground: surfaces.dark.raised,
  inputFocus: mar[200],
  inputFocusBackground: surfaces.dark.raised,
  // Campo com erro: a borda vermelha já se destaca no escuro; o fundo fica bg/raised, como no foco.
  inputError: '#F2685B',
  inputErrorBackground: surfaces.dark.raised,
  inputErrorForeground: '#F36C5F', // o erro do kit tem 4.49:1 sobre `muted`: clareado o mínimo
  // Chips da prancha 07: os demais em bg/raised com borda, o selecionado em Sol com texto Noite.
  chip: surfaces.dark.raised,
  chipForeground: surfaces.dark.text,
  chipBorder: surfaces.dark.border,
  chipHover: surfaces.dark.border,
  chipSelected: sol[400],
  chipSelectedForeground: noite,
  chipSelectedBorder: sol[400],
  // O fundo já é quase Noite: o véu escurece com preto a 80% para separar o diálogo.
  scrim: '#000000CC',
  // "Convidar" da prancha 07: transparente de verdade, porque o botão aparece sobre `background`,
  // `card`, `popover` e `muted`, e nenhuma cor opaca coincide com todas essas superfícies.
  outlineBorder: surfaces.dark.textSecondary,
  outlineBackground: '#00000000',
  // Derivado: desce à bg/base, mais escuro que o campo ativo e que o card (o kit não desenha o estado).
  inputDisabled: surfaces.dark.base,
  // Derivado: um degrau acima do trilho (raised), e a borda de campo dá os 3:1 que o preenchimento
  // não alcança sem reprovar o texto.
  tabActive: surfaces.dark.border,
  tabActiveBorder: darkFieldBorder,
  // Iguais ao claro: ver `mediaColors`.
  ...mediaColors,
  // Laranja de alerta do escuro (prancha 07) com texto Noite (7.5:1); já tem 8:1 sobre o fundo.
  sandbox: '#F29A3A',
  sandboxForeground: noite,
  sandboxBorder: '#F29A3A',
  amountPositive: successText.dark,
  ...qrColors,
  // Estrela no escuro: Sol puro no preenchimento e no contorno (≥ 8:1 em fundo, card e `muted`);
  // a vazia, contorno na borda de campo do escuro (≥ 3:1 até sobre `muted`).
  rating: sol[400],
  ratingBorder: sol[400],
  ratingEmpty: darkFieldBorder,
};

export const themes: Record<ThemeName, ThemeColors> = { light, dark };

/** `primaryForeground` → `--primary-foreground`, `chart1` → `--chart-1`. */
export function cssVarName(token: ColorToken): `--${string}` {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/(\d+)/g, '-$1')}`;
}

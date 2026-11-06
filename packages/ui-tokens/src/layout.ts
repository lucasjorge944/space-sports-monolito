/** Espaçamento, raios e sombras. Valores em px. */

/** Unidade base de espaçamento (igual ao `--spacing` do Tailwind v4): `p-4` = 4 × 4 = 16px. */
export const spacingUnit = 4;

export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Medidas semânticas de layout. */
export const layout = {
  /** Alvo de toque mínimo (44pt), no app e na web. */
  touchTarget: 44,
  /** Altura dos botões e campos do app e das páginas públicas (prancha 06). */
  controlHeight: 48,
  /** Margem lateral das telas do app. */
  screenGutter: 16,
  /** Margem do conteúdo no painel web. */
  pageGutter: 24,
  /** Espaço entre cards em listas/grades. */
  cardGap: 12,
  /** Largura da sidebar do painel. */
  sidebarWidth: 256,
} as const;

/** Anatomia de campo (docs/05-design-system.md, "Anatomia de campo"), na web e no app. */
export const fieldLayout = {
  /** Rótulo → controle e controle → dica (prancha 06). */
  labelGap: 6,
  /** Dica → erro. */
  messageGap: 4,
  /** Tamanho do ícone de estado. */
  iconSize: 16,
  /** Ícone de estado → texto. */
  iconGap: 6,
  /** Campo → campo. */
  fieldGap: 16,
  /** Grupo de campos → grupo de campos. */
  groupGap: 24,
} as const;

/** Raio base (`--radius`): botões e campos. As variações são relativas a ele, como no shadcn. */
export const radiusBase = 12;

/** Raios da prancha 06: badges 6, botões e campos 12, cards 16, card de quadra 24, pill. */
export const radius = {
  sm: radiusBase - 6,
  md: radiusBase,
  lg: radiusBase + 4,
  xl: radiusBase + 12,
  full: 9999,
} as const;

/**
 * Sombras em sintaxe CSS `box-shadow`. React Native (New Architecture) aceita a mesma
 * string na prop `boxShadow`. Tom Noite (#06202E).
 */
export const shadow = {
  sm: '0 1px 2px 0 rgb(6 32 46 / 0.06)',
  md: '0 2px 8px -2px rgb(6 32 46 / 0.10), 0 1px 3px 0 rgb(6 32 46 / 0.06)',
  lg: '0 12px 24px -6px rgb(6 32 46 / 0.14), 0 4px 8px -4px rgb(6 32 46 / 0.08)',
} as const;

/**
 * Degradê de leitura sobre a foto do banner patrocinado (AD.1, docs/05 "Explorar e anúncios"):
 * a cor `media-overlay` (Noite) com estas opacidades, de cima (0) para baixo (1). Calibrado para
 * o pior caso, foto branca: no topo do título (≥ 22% da altura) o texto branco tem ≥ 3:1 (o título
 * é texto grande, 20 px em negrito) e no texto corrido (≥ 45%) ≥ 4.5:1. Testado em contrast.test.ts.
 */
export const mediaOverlayStops = [
  { offset: 0, opacity: 0 },
  { offset: 0.22, opacity: 0.5 },
  { offset: 0.45, opacity: 0.62 },
  { offset: 1, opacity: 0.85 },
] as const;

/** Opacidade do degradê numa altura relativa (0 = topo, 1 = base), interpolada entre as paradas. */
export function mediaOverlayOpacityAt(offset: number): number {
  const y = Math.min(1, Math.max(0, offset));
  for (let i = 1; i < mediaOverlayStops.length; i++) {
    const a = mediaOverlayStops[i - 1];
    const b = mediaOverlayStops[i];
    if (a && b && y <= b.offset) {
      return a.opacity + ((b.opacity - a.opacity) * (y - a.offset)) / (b.offset - a.offset);
    }
  }
  return mediaOverlayStops[mediaOverlayStops.length - 1]?.opacity ?? 1;
}

/** Medidas do Explorar e das peças de anúncio no app (docs/05, "Explorar e anúncios"). */
export const exploreLayout = {
  /** Entre as seções do topo (atalhos, carrossel, recentes, título da lista). */
  sectionGap: 24,
  /** Título da seção → conteúdo. */
  sectionTitleGap: 12,
  /** Entre os cards da lista vertical. */
  listGap: 16,
  /** Atalhos por esporte: chip de 44, ícone de 18 e 8 entre os chips. */
  shortcut: { height: 44, iconSize: 18, gap: 8 },
  /** Banner do carrossel (`EXPLORE_HERO`). */
  hero: {
    aspectRatio: 2,
    radius: radius.xl,
    /** Margem interna do texto e do botão. */
    padding: 16,
    /** Distância do selo aos cantos (topo e esquerda). */
    badgeInset: 12,
    /** Folga mínima entre o selo e o bloco de texto; se faltar, o texto corrido sai. */
    badgeClearance: 4,
    /** Altura mínima do botão (cresce com a fonte). */
    ctaHeight: 32,
    autoplayMs: 5000,
    /** Indicador em segmentos, abaixo do banner. */
    indicator: { segmentWidth: 20, height: 4, gap: 4, offset: 8 },
  },
  /** Card patrocinado da lista (`EXPLORE_FEED`): o mesmo card de espaço, raio 24 e foto 4:5. */
  feed: { aspectRatio: 4 / 5, radius: radius.xl, badgeInset: 16, ctaHeight: 40 },
  /** Card compacto de Espaços recentes. */
  recent: { width: 152, imageHeight: 96, logoSize: 36, radius: radius.lg, gap: 12 },
  /**
   * Selo "Patrocinado · <anunciante>": pílula com altura mínima de 24 (cresce com a fonte), texto
   * 14/20. Os textos do banner usam `maxFontSizeMultiplier` 1.3.
   */
  badge: { minHeight: 24, paddingX: 10 },
  /** Limite de aumento da fonte nos textos sobre foto (selo, título, texto e botão do banner). */
  mediaMaxFontSizeMultiplier: 1.3,
} as const;

/**
 * Pagamento online no app e no painel (PG.1, docs/05 "Pagamento online"). Os prazos de validade
 * (15 min na reserva, 24 h na mensalidade) vêm da API (`expiresAt`); aqui ficam só medidas e ritmos
 * de tela.
 */
export const paymentLayout = {
  /** Cartão de opção da etapa "Pagamento" (no local, Pix, cartão): altura mínima, ícone e espaço entre cartões. */
  methodOption: { minHeight: 64, iconSize: 24, gap: 8 },
  /** QR do Pix: lado do código, folga (zona de silêncio) e raio da placa branca. */
  qr: { size: 216, platePadding: 16, plateRadius: radius.lg },
  /** Selo "Ambiente de teste": pílula de altura mínima 24 (cresce com a fonte) e ícone de 14. */
  sandboxBadge: { minHeight: 24, paddingX: 10, iconSize: 14 },
  /** Quanto tempo o "Copiado" fica no botão do copia e cola. */
  copiedFeedbackMs: 2000,
  /** Consulta do status da cobrança enquanto a tela do Pix está em foco. */
  pollIntervalMs: 5000,
  /** Abaixo disso a contagem regressiva fica em tom de alerta. */
  countdownUrgentMs: { booking: 3 * 60_000, classCharge: 60 * 60_000 },
  /** Barra do "a liberar por data" na carteira do painel. */
  releaseBar: { height: 8, radius: 4, maxRows: 7 },
} as const;

/**
 * Avaliações de espaços (AV.1, docs/05-design-system.md, "Avaliações"): medidas das estrelas e dos
 * blocos, e o desenho da nota em estrelas cheias, meias e vazias. As cores vêm dos tokens `rating`
 * (preenchimento), `rating-border` (contorno da cheia) e `rating-empty` (contorno da vazia).
 *
 * Ícones: `Star` e `StarHalf` do Lucide (`lucide-react` e `lucide-react-native`, já usados), na
 * grade 24×24 com traço 2. Cheia: `<Star fill={rating} color={ratingBorder} />`. Vazia:
 * `<Star fill="none" color={ratingEmpty} />`. Meia: a vazia com a `StarHalf` cheia por cima.
 */

/** Tamanhos da estrela (ícone) e espaço entre estrelas, por uso. Valores em px. */
export const reviewLayout = {
  star: {
    /** Selo "★ 4,8 (23)" no card da vitrine, no callout do mapa e na linha do cabeçalho. */
    badge: { size: 14, gap: 4 },
    /** Nota do item da lista (5 estrelas, sempre inteiras). */
    item: { size: 14, gap: 2 },
    /** Sob a média grande do resumo e nos cards do painel. */
    summary: { size: 20, gap: 4 },
    /** Card "Avalie sua experiência" (reserva e aula passadas): alvo de 44, 4 entre os alvos (236 de largura). */
    prompt: { size: 32, hitSize: 44, gap: 4 },
    /** Tela de avaliar: estrelas grandes, alvo de 52 encostados (260 de largura). */
    input: { size: 40, hitSize: 52, gap: 0 },
  },
  /** Média grande do resumo: app 40/44 e web 48/56, `font-display` 700, `tabular-nums`. */
  summaryAverage: { app: { fontSize: 40, lineHeight: 44 }, web: { fontSize: 48, lineHeight: 56 } },
  /**
   * Coluna da média no resumo da web (≥ 640 px), ao lado das barras. No app o resumo é empilhado:
   * média, estrelas e total numa linha, e a distribuição abaixo, na largura toda.
   */
  summaryAsideWidth: 160,
  /** Barras da distribuição 1–5: altura 8, rótulo "5 ★" à esquerda e contagem à direita. */
  distribution: { barHeight: 8, rowGap: 6, labelWidth: 28, countWidth: 32 },
  /** Item da lista: avatar do autor, recuo da resposta (avatar + 12) e logo do espaço na resposta. */
  item: { avatarSize: 36, replyIndent: 48, replyAvatarSize: 20, gap: 12 },
  /** Linhas do comentário antes do "Ler mais" (app 4, web 6). */
  commentClampLines: { app: 4, web: 6 },
  /** Comentários recentes e chips mais citados no bloco da página do espaço. */
  recentCount: 3,
  topTagsCount: 3,
  /** Itens por página na lista "Ver todas" e no painel. */
  pageSize: 20,
} as const;

export type StarFill = 'full' | 'half' | 'empty';

/**
 * Desenho de uma nota em estrelas: arredonda para a meia estrela mais próxima (4,2 → 4; 4,3 → 4½;
 * 4,8 → 5). Nota inteira do item (1–5) dá só cheias e vazias. Fora de 0–5, limita.
 */
export function starFills(value: number, total = 5): StarFill[] {
  const halves = Math.round(Math.min(total, Math.max(0, value)) * 2);
  return Array.from({ length: total }, (_, i) => {
    const left = halves - i * 2;
    return left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
  });
}

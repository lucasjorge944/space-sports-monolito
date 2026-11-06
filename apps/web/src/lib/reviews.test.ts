import type { ReviewSummary } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import {
  averageVisibilityHint,
  commentExcerpt,
  distributionRows,
  emptyReviewsState,
  hasPublicSummary,
  headerRating,
  headerRatingText,
  isEditedAfterReply,
  moderationEntryText,
  panelFilteredCount,
  parseCursor,
  parsePanelFilters,
  parseRatingFilter,
  parseReportStatus,
  ratingAriaLabel,
  relativeReviewDate,
  reviewCountLabel,
  reviewsJsonLd,
  reviewsPagePath,
  reviewsPageRobots,
  superRatingLink,
  trendAriaLabel,
  trendBarPercent,
} from './reviews';

// 04/11/2026 10:00 em São Paulo (13:00 UTC).
const NOW = new Date('2026-11-04T13:00:00.000Z');

describe('relativeReviewDate', () => {
  it.each([
    ['2026-11-04T03:30:00.000Z', 'hoje'], // 00:30 local de hoje
    ['2026-11-04T02:30:00.000Z', 'ontem'], // 23:30 local de ontem, embora em UTC seja "hoje"
    ['2026-11-02T13:00:00.000Z', 'há 2 dias'],
    ['2026-10-29T13:00:00.000Z', 'há 6 dias'],
    ['2026-10-28T13:00:00.000Z', 'há 1 semana'],
    ['2026-10-06T13:00:00.000Z', 'há 4 semanas'],
    ['2026-10-05T13:00:00.000Z', 'há 1 mês'],
    ['2026-01-10T13:00:00.000Z', 'há 9 meses'],
    ['2025-11-04T13:00:00.000Z', 'há 1 ano'],
    ['2023-11-01T13:00:00.000Z', 'há 3 anos'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeReviewDate(iso, NOW)).toBe(expected);
  });

  it('data no futuro (relógio adiantado) vira "hoje"', () => {
    expect(relativeReviewDate('2026-11-05T13:00:00.000Z', NOW)).toBe('hoje');
  });
});

describe('isEditedAfterReply', () => {
  const reply = { repliedAt: '2026-10-10T12:00:00.000Z' };
  it('marca quando a avaliação mudou depois da resposta', () => {
    expect(isEditedAfterReply({ updatedAt: '2026-10-11T12:00:00.000Z', reply })).toBe(true);
  });
  it('não marca editada antes da resposta nem sem resposta', () => {
    expect(isEditedAfterReply({ updatedAt: '2026-10-09T12:00:00.000Z', reply })).toBe(false);
    expect(isEditedAfterReply({ updatedAt: '2026-10-10T12:00:00.000Z', reply })).toBe(false);
    expect(isEditedAfterReply({ updatedAt: '2026-10-11T12:00:00.000Z', reply: null })).toBe(false);
  });
});

describe('contagens e rótulos', () => {
  it('singular, plural e milhar com ponto', () => {
    expect(reviewCountLabel(1)).toBe('1 avaliação');
    expect(reviewCountLabel(23)).toBe('23 avaliações');
    expect(reviewCountLabel(1234)).toBe('1.234 avaliações');
  });
  it('rótulo de acessibilidade da nota', () => {
    expect(ratingAriaLabel(4.8, 23)).toBe('Nota 4,8 de 5, 23 avaliações');
  });
  it('resumo só a partir de 5 com média', () => {
    expect(hasPublicSummary({ count: 5, average: 4.2 })).toBe(true);
    expect(hasPublicSummary({ count: 4, average: null })).toBe(false);
    expect(hasPublicSummary({ count: 0, average: null })).toBe(false);
  });
  it('linha do cabeçalho', () => {
    expect(headerRatingText({ count: 23, average: 4.8 })).toBe('23 avaliações');
    expect(headerRatingText({ count: 2, average: null })).toBe('Ainda poucas avaliações');
    expect(headerRatingText({ count: 0, average: null })).toBeNull();
  });
  it('apoio da média: público vê, faltam N ou fora da vitrine', () => {
    expect(averageVisibilityHint({ count: 0, publicSummaryVisible: false }, true)).toBe(
      'Ainda sem avaliações',
    );
    expect(averageVisibilityHint({ count: 23, publicSummaryVisible: true }, true)).toBe(
      'Aparece no app e no site',
    );
    expect(averageVisibilityHint({ count: 3, publicSummaryVisible: false }, true)).toBe(
      'Aparece no app a partir de 5 avaliações (faltam 2)',
    );
  });
  it('apoio da média: fora da vitrine vem primeiro, seja qual for o total', () => {
    const outside = 'Não aparece no app nem no site: espaço fora da vitrine';
    expect(averageVisibilityHint({ count: 0, publicSummaryVisible: false }, false)).toBe(outside);
    expect(averageVisibilityHint({ count: 2, publicSummaryVisible: false }, false)).toBe(outside);
    expect(averageVisibilityHint({ count: 7, publicSummaryVisible: false }, false)).toBe(outside);
  });
  it('apoio da média sem saber da vitrine: só o resumo com 5 ou mais a denuncia', () => {
    expect(averageVisibilityHint({ count: 7, publicSummaryVisible: false }, null)).toBe(
      'Não aparece no app nem no site: espaço fora da vitrine',
    );
    expect(averageVisibilityHint({ count: 3, publicSummaryVisible: false }, null)).toBe(
      'Aparece no app a partir de 5 avaliações (faltam 2)',
    );
  });
  it('número do link "Avaliações" no Super', () => {
    expect(superRatingLink({ count: 1234, average: 4.8 })).toEqual({
      text: '4,8 (1.234)',
      ariaLabel: 'Avaliações, nota 4,8 de 5, 1.234 avaliações',
    });
    expect(superRatingLink({ count: 3, average: null })).toEqual({
      text: '(3)',
      ariaLabel: 'Avaliações, 3 avaliações',
    });
  });
  it('link "Avaliações" no Super sem avaliações: sem contagem', () => {
    expect(superRatingLink({ count: 0, average: null })).toEqual({
      text: null,
      ariaLabel: 'Avaliações do espaço',
    });
  });
  it('cabeçalho usa o resumo do bloco quando ele existe; o do espaço só de reserva', () => {
    const stale = { count: 4, average: null };
    expect(headerRating(stale, { count: 5, average: 4.6 })).toEqual({ count: 5, average: 4.6 });
    expect(headerRating(stale, null)).toEqual(stale);
  });
});

describe('distributionRows', () => {
  it('sempre 5 linhas, de 5 para 1, com percentuais', () => {
    expect(
      distributionRows([
        { rating: 5, count: 18 },
        { rating: 4, count: 3 },
        { rating: 1, count: 2 },
      ]),
    ).toEqual([
      { rating: 5, count: 18, percent: 78 },
      { rating: 4, count: 3, percent: 13 },
      { rating: 3, count: 0, percent: 0 },
      { rating: 2, count: 0, percent: 0 },
      { rating: 1, count: 2, percent: 9 },
    ]);
  });
  it('sem avaliações, tudo zero', () => {
    expect(distributionRows([]).every((r) => r.count === 0 && r.percent === 0)).toBe(true);
  });
});

describe('tendência', () => {
  const point = (count: number, average: number | null) => ({
    date: '2026-10-04',
    count,
    average,
    cumulativeAverage: average,
  });

  it('altura na escala 1–5 e semana vazia sem coluna', () => {
    expect(trendBarPercent(1)).toBe(20);
    expect(trendBarPercent(5)).toBe(100);
    expect(trendBarPercent(4.2)).toBe(84);
    expect(trendBarPercent(null)).toBeNull();
  });
  it('rótulo com o intervalo das médias', () => {
    expect(trendAriaLabel([point(1, 4.2), point(0, null), point(3, 5)])).toBe(
      'Média semanal dos últimos 90 dias, de 4,2 a 5,0',
    );
    expect(trendAriaLabel([point(0, null)])).toBe(
      'Média semanal dos últimos 90 dias, sem avaliações',
    );
  });
});

describe('filtros e URLs', () => {
  it('nota da URL só de 1 a 5', () => {
    expect(parseRatingFilter('5')).toBe(5);
    expect(parseRatingFilter(['3', '4'])).toBe(3);
    expect(parseRatingFilter('0')).toBeUndefined();
    expect(parseRatingFilter('6')).toBeUndefined();
    expect(parseRatingFilter('4.5')).toBeUndefined();
    expect(parseRatingFilter(undefined)).toBeUndefined();
  });
  it('cursor vazio é a primeira página', () => {
    expect(parseCursor('')).toBeUndefined();
    expect(parseCursor('abc')).toBe('abc');
  });
  it('caminho da lista com filtro e cursor', () => {
    expect(reviewsPagePath('arena')).toBe('/espacos/arena/avaliacoes');
    expect(reviewsPagePath('arena', { rating: 5, cursor: 'c1' })).toBe(
      '/espacos/arena/avaliacoes?nota=5&cursor=c1',
    );
  });
  it('página com cursor não é indexada', () => {
    expect(reviewsPageRobots(undefined)).toEqual({ index: true, follow: true });
    expect(reviewsPageRobots('c1')).toEqual({ index: false, follow: true });
  });
  it('status da fila com OPEN como padrão', () => {
    expect(parseReportStatus('DISMISSED')).toBe('DISMISSED');
    expect(parseReportStatus('x')).toBe('OPEN');
    expect(parseReportStatus(null)).toBe('OPEN');
  });
});

describe('reviewsJsonLd', () => {
  const review = (id: string, comment: string | null, commentHidden = false) => ({
    id,
    author: { name: 'Ana S.', avatarUrl: null, kind: 'PLAYER' as const },
    rating: 5,
    tags: [],
    comment,
    commentHidden,
    reply: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  });
  const summary = (count: number, average: number | null): ReviewSummary => ({
    count,
    average,
    distribution: [],
    topTags: [],
    recent: [review('r1', 'Ótimo'), review('r2', null, true)],
  });

  it('com resumo: AggregateRating e as recentes com comentário', () => {
    const ld = reviewsJsonLd(summary(23, 4.8));
    expect(ld.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.8,
      reviewCount: 23,
      bestRating: 5,
      worstRating: 1,
    });
    expect(ld.review).toEqual([
      expect.objectContaining({
        '@type': 'Review',
        author: { '@type': 'Person', name: 'Ana S.' },
        reviewBody: 'Ótimo',
        datePublished: '2026-10-01',
      }),
    ]);
  });
  it('sem resumo (menos de 5) ou sem dados: nada', () => {
    expect(reviewsJsonLd(summary(3, null))).toEqual({});
    expect(reviewsJsonLd(null)).toEqual({});
  });
});

describe('moderação', () => {
  it('trecho do comentário', () => {
    expect(commentExcerpt('curto')).toBe('curto');
    expect(commentExcerpt('a'.repeat(90))).toBe(`${'a'.repeat(80)}…`);
  });
  it('texto do histórico', () => {
    expect(
      moderationEntryText({
        action: 'review.hide',
        actorName: 'Super Admin',
        diff: { reason: 'Ofensivo' },
      }),
    ).toEqual({ title: 'Ocultado por Super Admin', reason: 'Ofensivo' });
    expect(moderationEntryText({ action: 'x.y', actorName: null, diff: null })).toEqual({
      title: 'x.y',
      reason: null,
    });
  });
});

describe('filtros do painel', () => {
  const summary = {
    count: 23,
    unansweredCount: 5,
    distribution: [
      { rating: 5, count: 18 },
      { rating: 4, count: 5 },
    ],
  };
  it('lê a URL', () => {
    expect(parsePanelFilters(new URLSearchParams('nota=4&sem-resposta=1'))).toEqual({
      rating: 4,
      unanswered: true,
    });
    expect(parsePanelFilters(new URLSearchParams('nota=9'))).toEqual({
      rating: undefined,
      unanswered: false,
    });
  });
  it('contagem da lista filtrada', () => {
    expect(panelFilteredCount(summary, { rating: undefined, unanswered: false })).toBe(23);
    expect(panelFilteredCount(summary, { rating: undefined, unanswered: true })).toBe(5);
    expect(panelFilteredCount(summary, { rating: 5, unanswered: false })).toBe(18);
    expect(panelFilteredCount(summary, { rating: 2, unanswered: false })).toBe(0);
    expect(panelFilteredCount(summary, { rating: 5, unanswered: true })).toBeNull();
  });
});

describe('emptyReviewsState', () => {
  it('com cursor é o fim da lista, com link para a primeira página (mantendo o filtro)', () => {
    expect(emptyReviewsState('arena', { cursor: 'c40' })).toEqual({
      title: 'Não há mais avaliações',
      action: { label: 'Ir para a primeira página', href: '/espacos/arena/avaliacoes' },
    });
    expect(emptyReviewsState('arena', { cursor: 'c40', rating: 2 }).action?.href).toBe(
      '/espacos/arena/avaliacoes?nota=2',
    );
  });
  it('com filtro e sem cursor: nota sem avaliações, com "Ver todas"', () => {
    expect(emptyReviewsState('arena', { rating: 1 })).toEqual({
      title: 'Nenhuma avaliação com 1 estrela',
      action: { label: 'Ver todas', href: '/espacos/arena/avaliacoes' },
    });
  });
  it('sem filtro nem cursor: ninguém avaliou', () => {
    expect(emptyReviewsState('arena', {})).toEqual({
      title: 'Ninguém avaliou ainda',
      action: null,
    });
  });
});

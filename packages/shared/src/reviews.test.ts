import { describe, expect, it } from 'vitest';
import {
  formatReviewAuthorName,
  formatReviewAverage,
  isPositiveReviewTag,
  REVIEW_NEGATIVE_TAGS,
  REVIEW_POSITIVE_TAGS,
  REVIEW_RATING_LABELS,
  REVIEW_SUMMARY_MIN_COUNT,
  REVIEW_TAG_LABELS,
  REVIEW_TAG_PAIRS,
  REVIEW_TAGS,
  replyReviewSchema,
  reportReviewSchema,
  reviewAverage,
  reviewTagsForRating,
  reviewTagsMatchRating,
  spaceRating,
  upsertReviewSchema,
} from './reviews';

describe('catálogo de chips (decisão 100)', () => {
  it('8 pares positivo/negativo na ordem da AV.1, todos com rótulo de até 20 caracteres', () => {
    expect(REVIEW_TAG_PAIRS).toHaveLength(8);
    expect(REVIEW_POSITIVE_TAGS).toEqual(REVIEW_TAG_PAIRS.map(([positive]) => positive));
    expect(REVIEW_NEGATIVE_TAGS).toEqual(REVIEW_TAG_PAIRS.map(([, negative]) => negative));
    expect(REVIEW_TAGS).toEqual(REVIEW_TAG_PAIRS.flat());
    expect(new Set(REVIEW_TAGS).size).toBe(16);
    for (const tag of REVIEW_TAGS) {
      expect(REVIEW_TAG_LABELS[tag]).toBeTruthy();
      expect(REVIEW_TAG_LABELS[tag].length).toBeLessThanOrEqual(20);
    }
    expect(REVIEW_RATING_LABELS[1]).toBe('Péssimo');
    expect(REVIEW_RATING_LABELS[5]).toBe('Excelente');
    expect(isPositiveReviewTag('GOOD_COURT')).toBe(true);
    expect(isPositiveReviewTag('DIRTY')).toBe(false);
  });

  it('positivos só com 4–5, negativos só com 1–3', () => {
    for (const rating of [4, 5]) {
      expect(reviewTagsForRating(rating)).toEqual(REVIEW_POSITIVE_TAGS);
      expect(reviewTagsMatchRating(rating, ['GOOD_COURT', 'CLEAN'])).toBe(true);
      expect(reviewTagsMatchRating(rating, ['GOOD_COURT', 'DIRTY'])).toBe(false);
    }
    for (const rating of [1, 2, 3]) {
      expect(reviewTagsForRating(rating)).toEqual(REVIEW_NEGATIVE_TAGS);
      expect(reviewTagsMatchRating(rating, ['DELAYS'])).toBe(true);
      expect(reviewTagsMatchRating(rating, ['GOOD_VALUE'])).toBe(false);
    }
    expect(reviewTagsMatchRating(1, [])).toBe(true);
    expect(reviewTagsMatchRating(2, ['HARD_BOOKING', 'POOR_FACILITIES'])).toBe(true);
    expect(reviewTagsMatchRating(5, ['ON_TIME', 'GOOD_FACILITIES'])).toBe(true);
  });
});

describe('upsertReviewSchema', () => {
  it('nota inteira de 1 a 5, chips padrão vazios e comentário vazio vira nulo', () => {
    expect(upsertReviewSchema.parse({ rating: 5 })).toEqual({ rating: 5, tags: [], comment: null });
    expect(upsertReviewSchema.parse({ rating: 3, comment: '   ' }).comment).toBeNull();
    expect(upsertReviewSchema.parse({ rating: 3, comment: '  Boa  ' }).comment).toBe('Boa');
    for (const rating of [0, 6, 4.5, '5']) {
      expect(upsertReviewSchema.safeParse({ rating }).success).toBe(false);
    }
  });

  it('até 5 chips, sem repetir, do catálogo', () => {
    const six = REVIEW_POSITIVE_TAGS.slice(0, 6);
    expect(six).toHaveLength(6);
    expect(upsertReviewSchema.safeParse({ rating: 5, tags: six }).success).toBe(false);
    expect(upsertReviewSchema.safeParse({ rating: 5, tags: six.slice(0, 5) }).success).toBe(true);
    expect(upsertReviewSchema.safeParse({ rating: 5, tags: ['CLEAN', 'CLEAN'] }).success).toBe(
      false,
    );
    expect(upsertReviewSchema.safeParse({ rating: 5, tags: ['NICE'] }).success).toBe(false);
  });

  it('comentário até 500 caracteres e nada além dos campos', () => {
    expect(upsertReviewSchema.safeParse({ rating: 4, comment: 'a'.repeat(500) }).success).toBe(
      true,
    );
    expect(upsertReviewSchema.safeParse({ rating: 4, comment: 'a'.repeat(501) }).success).toBe(
      false,
    );
    expect(upsertReviewSchema.safeParse({ rating: 4, userId: 'x' }).success).toBe(false);
  });
});

describe('denúncia e resposta', () => {
  it('motivo do catálogo e texto opcional', () => {
    expect(reportReviewSchema.parse({ reason: 'SPAM' })).toEqual({ reason: 'SPAM', details: null });
    expect(reportReviewSchema.safeParse({ reason: 'RUDE' }).success).toBe(false);
    expect(
      reportReviewSchema.safeParse({ reason: 'OTHER', details: 'a'.repeat(501) }).success,
    ).toBe(false);
  });

  it('resposta obrigatória, até 500', () => {
    expect(replyReviewSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(replyReviewSchema.parse({ body: ' Obrigado! ' })).toEqual({ body: 'Obrigado!' });
    expect(replyReviewSchema.safeParse({ body: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('média (RN-REVIEW-03)', () => {
  it(`só a partir de ${REVIEW_SUMMARY_MIN_COUNT} avaliações, com uma casa`, () => {
    expect(reviewAverage(20, 4)).toBeNull();
    expect(reviewAverage(0, 0)).toBeNull();
    expect(reviewAverage(24, 5)).toBe(4.8);
    expect(reviewAverage(29, 6)).toBe(4.8); // 4,833…
    expect(reviewAverage(27, 6)).toBe(4.5); // 4,5 exato
    expect(reviewAverage(89, 20)).toBe(4.5); // 4,45 → para cima
    expect(reviewAverage(7, 2, 1)).toBe(3.5);
    expect(reviewAverage(0, 0, 1)).toBeNull();
  });

  it('card: contagem e média das colunas do espaço', () => {
    expect(spaceRating(2, 9)).toEqual({ count: 2, average: null });
    expect(spaceRating(5, 23)).toEqual({ count: 5, average: 4.6 });
  });

  it('formata com vírgula', () => {
    expect(formatReviewAverage(4.8)).toBe('4,8');
    expect(formatReviewAverage(5)).toBe('5,0');
  });
});

describe('nome do autor (decisão 102)', () => {
  it('primeiro nome + inicial do último sobrenome', () => {
    expect(formatReviewAuthorName('Ana Paula Souza')).toBe('Ana S.');
    expect(formatReviewAuthorName('  joão   da silva ')).toBe('João S.');
    expect(formatReviewAuthorName('Ícaro élio')).toBe('Ícaro É.');
    expect(formatReviewAuthorName('Madonna')).toBe('Madonna');
  });

  it('sem autor: "Usuário removido"', () => {
    expect(formatReviewAuthorName(null)).toBe('Usuário removido');
    expect(formatReviewAuthorName('   ')).toBe('Usuário removido');
  });
});

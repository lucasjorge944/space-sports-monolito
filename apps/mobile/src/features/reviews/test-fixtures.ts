import type {
  MyReview,
  MyReviewPageItemsItem,
  PublicReviewPageItemsItem,
  PublicSpace,
  ReviewEligibility,
  ReviewSummary,
} from '@space-sports/api-client';

export const SPACE_ID = '0192f0a0-0000-7000-8000-0000000000aa';

/** Página do espaço só com o que as telas de avaliação usam. */
export function reviewSpace(extra: Partial<PublicSpace> = {}): PublicSpace {
  return {
    id: SPACE_ID,
    slug: 'arena-sol',
    name: 'Arena Sol',
    logoUrl: null,
    address: {
      street: 'Rua A',
      number: '10',
      neighborhood: 'Savassi',
      postalCode: null,
      city: { id: 'c1', name: 'Belo Horizonte', state: 'MG' },
    },
    rating: { count: 23, average: 4.8 },
    ...extra,
  } as PublicSpace;
}

export function myReview(extra: Partial<MyReview> = {}): MyReview {
  return {
    id: 'r-mine',
    spaceId: SPACE_ID,
    rating: 4,
    tags: ['GOOD_COURT'],
    comment: 'Quadra ótima.',
    commentHidden: false,
    authorKind: 'PLAYER',
    reply: null,
    createdAt: '2026-10-20T15:00:00.000Z',
    updatedAt: '2026-10-20T15:00:00.000Z',
    ...extra,
  };
}

export function eligibility(extra: Partial<ReviewEligibility> = {}): ReviewEligibility {
  return { canReview: true, canEdit: false, reason: null, myReview: null, ...extra };
}

/** Já avaliou e pode editar. */
export const editable = () =>
  eligibility({ canReview: false, canEdit: true, myReview: myReview() });
/** Já avaliou, mas está na equipe ativa (só leitura). */
export const readOnly = () =>
  eligibility({
    canReview: false,
    canEdit: false,
    reason: 'REVIEW_NOT_ALLOWED',
    myReview: myReview(),
  });

export function publicReview(
  extra: Partial<PublicReviewPageItemsItem> = {},
): PublicReviewPageItemsItem {
  return {
    id: 'r1',
    author: { name: 'Ana S.', avatarUrl: null, kind: 'PLAYER' },
    rating: 5,
    tags: ['GOOD_COURT', 'CLEAN'],
    comment: 'Ótimo atendimento.',
    commentHidden: false,
    reply: null,
    createdAt: '2026-10-30T15:00:00.000Z',
    updatedAt: '2026-10-30T15:00:00.000Z',
    ...extra,
  };
}

export function summary(extra: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    count: 23,
    average: 4.8,
    distribution: [
      { rating: 5, count: 18 },
      { rating: 4, count: 3 },
      { rating: 3, count: 1 },
      { rating: 2, count: 0 },
      { rating: 1, count: 1 },
    ],
    topTags: [
      { tag: 'GOOD_COURT', count: 12 },
      { tag: 'CLEAN', count: 9 },
      { tag: 'EXPENSIVE', count: 4 },
    ],
    recent: [publicReview()],
    ...extra,
  };
}

export function myReviewItem(extra: Partial<MyReviewPageItemsItem> = {}): MyReviewPageItemsItem {
  return {
    ...myReview(),
    space: {
      id: SPACE_ID,
      slug: 'arena-sol',
      name: 'Arena Sol',
      logoUrl: null,
      neighborhood: 'Centro',
      city: 'Cidade Teste',
      inShowcase: true,
    },
    canEdit: true,
    ...extra,
  };
}

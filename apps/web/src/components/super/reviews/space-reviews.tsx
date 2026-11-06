'use client';

import {
  getSuperListReviewsQueryKey,
  superListReviews,
  useSuperGetSpace,
  useSuperGetSpaceReviewSummary,
} from '@space-sports/api-client';
import { formatReviewAverage } from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { Field } from '@/components/painel/field';
import { DistributionCard, HighlightsCard, ReviewStatCard } from '@/components/reviews/panel-parts';
import { ReviewItem } from '@/components/reviews/review-item';
import { Stars } from '@/components/reviews/stars';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipButton } from '@/components/ui/chip';
import { Select } from '@/components/ui/select';
import {
  averageVisibilityHint,
  parseRatingFilter,
  RATINGS_DESC,
  reviewCountLabel,
} from '@/lib/reviews';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import {
  BlockedAuthorBadge,
  isOutOfAverage,
  OpenReportsBadge,
  superReviewItemData,
} from './review-parts';

/**
 * Indicadores a partir do resumo do Super (`superGetSpaceReviewSummary`): vale para qualquer
 * espaço, inclusive fora da vitrine, e conta as avaliações fora da média (autor bloqueado).
 */
function Indicators({
  spaceId,
  inShowcase,
}: {
  spaceId: string;
  /** `showcase.visible` do espaço; `undefined` carregando, `null` se não carregou. */
  inShowcase: boolean | null | undefined;
}) {
  const summary = useSuperGetSpaceReviewSummary({ spaceId });
  if (summary.isPending || inShowcase === undefined) return <LoadingBlock rows={2} />;
  if (summary.isError) {
    return <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const { count, average, uncountedCount, distribution, highlights } = summary.data;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ReviewStatCard
          label="Média"
          testId="super-avaliacoes-media"
          value={
            average === null ? (
              '—'
            ) : (
              <>
                {formatReviewAverage(average)}
                <Stars value={average} size="summary" />
              </>
            )
          }
        >
          <p className="text-muted-foreground text-xs">
            {averageVisibilityHint(summary.data, inShowcase)}
          </p>
        </ReviewStatCard>
        <ReviewStatCard label="Na média" value={count} testId="super-avaliacoes-total">
          <p className="text-muted-foreground text-xs">
            {uncountedCount > 0
              ? `${reviewCountLabel(uncountedCount)} fora da média (autor bloqueado)`
              : 'Nenhuma fora da média'}
          </p>
        </ReviewStatCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DistributionCard distribution={distribution} />
        <HighlightsCard highlights={highlights} />
      </div>
    </>
  );
}

/** Avaliações de um espaço no Super (RF-REVIEW-07): lista com filtros e o link para moderar. */
export function SuperSpaceReviews({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Estado local como fonte de verdade (o `useSearchParams` só muda depois do `router.replace`).
  const [filters, setFilters] = useState(() => ({
    rating: parseRatingFilter(params.get('nota')),
    hidden: params.get('ocultos') === '1',
    reported: params.get('denunciadas') === '1',
  }));
  const latest = useRef(filters);
  const { rating, hidden, reported } = filters;
  const space = useSuperGetSpace(spaceId);

  function updateFilters(patch: Partial<typeof filters>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setFilters(next);
    const search = new URLSearchParams();
    if (next.rating) search.set('nota', String(next.rating));
    if (next.hidden) search.set('ocultos', '1');
    if (next.reported) search.set('denunciadas', '1');
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const listParams = {
    spaceId,
    limit: reviewLayout.pageSize,
    ...(rating ? { rating } : {}),
    ...(hidden ? { hidden: 'true' } : {}),
    ...(reported ? { reported: 'true' } : {}),
  };
  const query = useInfiniteQuery({
    queryKey: [...getSuperListReviewsQueryKey(listParams), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      superListReviews({ ...listParams, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(rating || hidden || reported);
  const spaceName = space.data?.name ?? 'Espaço';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/super/espacos/${spaceId}`, label: spaceName }}
        title={`Avaliações · ${spaceName}`}
        description="Responder é pelo modo suporte. Aqui o Super modera os comentários."
      />
      <Indicators
        spaceId={spaceId}
        inShowcase={
          space.isPending ? undefined : space.isError ? null : space.data.showcase.visible
        }
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <Field label="Nota" htmlFor="super-avaliacoes-nota">
            <Select
              id="super-avaliacoes-nota"
              value={rating ? String(rating) : ''}
              onChange={(e) => updateFilters({ rating: parseRatingFilter(e.target.value) })}
            >
              <option value="">Todas</option>
              {RATINGS_DESC.map((r) => (
                <option key={r} value={r}>
                  {r} {r === 1 ? 'estrela' : 'estrelas'}
                </option>
              ))}
            </Select>
          </Field>
          <ChipButton selected={hidden} onClick={() => updateFilters({ hidden: !hidden })}>
            Com comentário oculto
          </ChipButton>
          <ChipButton selected={reported} onClick={() => updateFilters({ reported: !reported })}>
            Com denúncia aberta
          </ChipButton>
        </div>
        <div className="px-4">
          {query.isPending ? (
            <div className="py-4">
              <LoadingBlock rows={3} />
            </div>
          ) : query.isError ? (
            <div className="py-4">
              <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <div className="py-4">
              <EmptyBlock>
                {filtered ? 'Nenhuma avaliação com esses filtros.' : 'Nenhuma avaliação ainda.'}
              </EmptyBlock>
            </div>
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {items.map((review) => (
                <li key={review.id}>
                  <ReviewItem
                    review={superReviewItemData(review)}
                    space={{ name: review.space.name, logoUrl: space.data?.logoUrl ?? null }}
                    variant="panel"
                    hiddenComment={review.comment}
                    badges={
                      <>
                        {isOutOfAverage(review) ? <BlockedAuthorBadge /> : null}
                        <OpenReportsBadge count={review.openReports} />
                      </>
                    }
                    footer={
                      <Button variant="outline" size="sm" className="w-fit" asChild>
                        <Link href={`/super/avaliacoes/${review.id}`}>
                          <ShieldAlert aria-hidden />
                          Moderar
                        </Link>
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        {query.hasNextPage ? (
          <div className="flex justify-center border-t p-4">
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

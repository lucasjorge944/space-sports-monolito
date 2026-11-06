import { formatReviewAverage, type ReviewSummary } from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { appDeepLink } from '@/lib/public-space';
import {
  appReviewDeepLink,
  formatCount,
  hasPublicSummary,
  headerRatingText,
  ratingAriaLabel,
  reviewsPagePath,
} from '@/lib/reviews';
import { cn, focusRing, textLink } from '@/lib/utils';
import { PublicReviewItems } from './public-review-list';
import { NewSpaceSummaryCard, ReviewSummaryCard } from './review-summary';
import { NewBadge, StarIcon } from './stars';

/** O web não avalia (o jogador não usa o web logado): o convite leva ao app. */
function ReviewInAppHint({ slug }: { slug: string }) {
  return (
    <p className="text-muted-foreground text-sm">
      Jogou aqui? Avalie{' '}
      <a
        href={appReviewDeepLink(appDeepLink(slug))}
        className={cn(textLink, 'rounded-sm', focusRing)}
      >
        pelo app
      </a>
      .
    </p>
  );
}

/**
 * Bloco "Avaliações" da página pública (RF-REVIEW-03; docs/05, "Avaliações" (5)), renderizado no
 * servidor: resumo com 5 ou mais avaliações, senão "Novo"; os 3 comentários recentes visíveis e o
 * link para a lista completa.
 */
export function SpaceReviewsSection({
  space,
  summary,
}: {
  space: { id: string; slug: string; name: string; logoUrl: string | null };
  summary: ReviewSummary | null;
}) {
  const recent = summary?.recent.slice(0, reviewLayout.recentCount) ?? [];
  return (
    <section
      id="avaliacoes"
      className="flex scroll-mt-4 flex-col gap-4"
      data-testid="espaco-avaliacoes"
    >
      <h2 className="text-h3">Avaliações</h2>
      {!summary ? (
        <p className="text-muted-foreground text-sm" role="status">
          Não foi possível carregar as avaliações.
        </p>
      ) : (
        <>
          {hasPublicSummary(summary) ? (
            <ReviewSummaryCard
              count={summary.count}
              average={summary.average as number}
              distribution={summary.distribution}
              topTags={summary.topTags}
            />
          ) : (
            <NewSpaceSummaryCard count={summary.count} />
          )}
          <ReviewInAppHint slug={space.slug} />
          {recent.length > 0 ? (
            <PublicReviewItems
              reviews={recent}
              space={{ name: space.name, logoUrl: space.logoUrl }}
            />
          ) : null}
          {summary.count > recent.length ? (
            <Link
              href={reviewsPagePath(space.slug)}
              className={cn(
                textLink,
                'inline-flex min-h-11 w-fit items-center gap-1 rounded-sm font-semibold',
                focusRing,
              )}
              data-testid="espaco-avaliacoes-ver-todas"
            >
              {summary.count === 1
                ? 'Ver a avaliação'
                : `Ver todas as ${formatCount(summary.count)} avaliações`}
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Linha do cabeçalho da página: "★ 4,8 · 23 avaliações" ou "Novo", com link para o bloco. */
export function SpaceHeaderRating({
  rating,
}: {
  rating: { count: number; average: number | null };
}) {
  const text = headerRatingText(rating);
  const average = hasPublicSummary(rating) ? (rating.average as number) : null;
  return (
    <a
      href="#avaliacoes"
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-sm text-sm hover:underline',
        focusRing,
      )}
      aria-label={average !== null ? ratingAriaLabel(average, rating.count) : undefined}
      data-testid="espaco-nota"
    >
      {average !== null ? (
        <>
          <StarIcon fill="full" size={reviewLayout.star.badge.size} />
          <span className="text-foreground font-semibold tabular-nums">
            {formatReviewAverage(average)}
          </span>
          <span className="text-muted-foreground">· {text}</span>
        </>
      ) : (
        <>
          <NewBadge />
          {text ? <span className="text-muted-foreground">{text}</span> : null}
        </>
      )}
    </a>
  );
}

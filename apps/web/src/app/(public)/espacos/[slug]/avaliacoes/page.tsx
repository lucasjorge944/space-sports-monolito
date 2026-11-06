import { reviewLayout } from '@space-sports/ui-tokens';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicReviewList } from '@/components/reviews/public-review-list';
import { NewSpaceSummaryCard, ReviewSummaryCard } from '@/components/reviews/review-summary';
import { StarIcon } from '@/components/reviews/stars';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import {
  distributionRows,
  emptyReviewsState,
  hasPublicSummary,
  parseCursor,
  parseRatingFilter,
  RATINGS_DESC,
  type ReviewRating,
  reviewsPagePath,
  reviewsPageRobots,
} from '@/lib/reviews';
import { fetchPublicSpace, fetchReviewSummary, fetchSpaceReviews } from '@/lib/server-api';
import { cn, focusRing, textLink } from '@/lib/utils';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ nota?: string | string[]; cursor?: string | string[] }>;
};

const siteUrl = process.env.SITE_URL?.replace(/\/+$/, '');

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const space = await fetchPublicSpace(slug);
  if (!space) return { title: 'Espaço não encontrado', robots: { index: false } };
  const cursor = parseCursor(query.cursor);
  return {
    title: `Avaliações de ${space.name}`,
    description: `O que jogadores e alunos dizem do ${space.name}, em ${space.address.city.name}.`,
    // Só a primeira página sem cursor é indexável; o canonical é sempre a primeira sem filtro.
    robots: reviewsPageRobots(cursor),
    ...(siteUrl
      ? {
          metadataBase: new URL(siteUrl),
          alternates: { canonical: reviewsPagePath(space.slug) },
        }
      : {}),
  };
}

const starsLabel = (rating: number) => `${rating} ${rating === 1 ? 'estrela' : 'estrelas'}`;

/** Filtro por nota como links (`?nota=5`): funciona sem JavaScript e mantém o "voltar". */
function RatingFilter({
  slug,
  active,
  counts,
}: {
  slug: string;
  active: ReviewRating | undefined;
  /** Com resumo: a contagem de cada nota (e as com 0 ficam desabilitadas). */
  counts: Map<number, number> | null;
}) {
  const options: { rating: ReviewRating | undefined; label: React.ReactNode; aria: string }[] = [
    { rating: undefined, label: 'Todas', aria: 'Todas as notas' },
    ...RATINGS_DESC.map((rating) => ({
      rating,
      aria: starsLabel(rating),
      label: (
        <>
          <span aria-hidden className="inline-flex items-center gap-1">
            {rating}
            <StarIcon fill="full" size={reviewLayout.star.badge.size} />
            {counts ? <span className="tabular-nums">{counts.get(rating) ?? 0}</span> : null}
          </span>
          <span className="sr-only">
            {starsLabel(rating)}
            {counts ? `, ${counts.get(rating) ?? 0}` : ''}
          </span>
        </>
      ),
    })),
  ];
  return (
    <nav aria-label="Filtrar por nota">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.rating === active;
          const empty = option.rating !== undefined && counts?.get(option.rating) === 0;
          const chip = (
            <Chip
              selected={selected}
              className={cn(
                'gap-1',
                empty && 'border-disabled bg-input-disabled text-disabled-foreground',
              )}
            >
              {option.label}
            </Chip>
          );
          return (
            <li key={option.aria}>
              {empty && !selected ? (
                <span aria-disabled="true">{chip}</span>
              ) : (
                <Link
                  href={reviewsPagePath(slug, { rating: option.rating })}
                  aria-current={selected ? 'true' : undefined}
                  className={cn('inline-flex rounded-full', focusRing)}
                  data-testid={`avaliacoes-filtro-${option.rating ?? 'todas'}`}
                  scroll={false}
                >
                  {chip}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyReviews(props: {
  slug: string;
  rating: ReviewRating | undefined;
  cursor: string | undefined;
}) {
  const { title, action } = emptyReviewsState(props.slug, props);
  return (
    <div
      className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center"
      data-testid="avaliacoes-vazio"
    >
      <p className="text-foreground font-medium">{title}</p>
      {action ? (
        <Button variant="outline" asChild>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export default async function SpaceReviewsPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const space = await fetchPublicSpace(slug);
  if (!space) notFound();

  const rating = parseRatingFilter(query.nota);
  const cursor = parseCursor(query.cursor);
  const [summary, page] = await Promise.all([
    fetchReviewSummary(space.id),
    fetchSpaceReviews(space.id, { rating, cursor, limit: reviewLayout.pageSize }),
  ]);
  const withSummary = summary !== null && hasPublicSummary(summary);
  const counts = withSummary
    ? new Map(distributionRows(summary.distribution).map((row) => [row.rating, row.count]))
    : null;
  const spaceRef = { name: space.name, logoUrl: space.logoUrl };

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <Link
        href={`/espacos/${space.slug}`}
        className={cn(
          textLink,
          'inline-flex w-fit items-center gap-1 rounded-sm text-sm',
          focusRing,
        )}
      >
        <ChevronLeft className="size-4" aria-hidden />
        {space.name}
      </Link>
      <h1 className="text-h2">Avaliações de {space.name}</h1>

      {summary ? (
        withSummary ? (
          <ReviewSummaryCard
            count={summary.count}
            average={summary.average as number}
            distribution={summary.distribution}
            topTags={summary.topTags}
          />
        ) : (
          <NewSpaceSummaryCard count={summary.count} />
        )
      ) : null}

      <RatingFilter slug={space.slug} active={rating} counts={counts} />

      {cursor ? (
        <Link
          href={reviewsPagePath(space.slug, { rating })}
          className={cn(
            textLink,
            'inline-flex w-fit items-center gap-1 rounded-sm text-sm',
            focusRing,
          )}
        >
          <ChevronLeft className="size-4" aria-hidden />
          Voltar ao começo
        </Link>
      ) : null}

      {!page ? (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-muted-foreground text-sm">Não foi possível carregar as avaliações.</p>
          <Button variant="outline" asChild>
            <Link href={reviewsPagePath(space.slug, { rating })}>Tentar de novo</Link>
          </Button>
        </div>
      ) : page.items.length === 0 ? (
        <EmptyReviews slug={space.slug} rating={rating} cursor={cursor} />
      ) : (
        <PublicReviewList
          // Recomeça a lista ao trocar o filtro ou a página.
          key={`${rating ?? 'todas'}-${cursor ?? ''}`}
          spaceId={space.id}
          slug={space.slug}
          rating={rating}
          space={spaceRef}
          initialItems={page.items}
          initialCursor={page.nextCursor}
        />
      )}
    </article>
  );
}

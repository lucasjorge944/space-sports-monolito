import {
  formatReviewAverage,
  isPositiveReviewTag,
  REVIEW_TAG_LABELS,
  type ReviewDistribution,
  type ReviewTagCount,
} from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { distributionRows, ratingAriaLabel, reviewCountLabel } from '@/lib/reviews';
import { cn, overline } from '@/lib/utils';
import { NewBadge, StarIcon, Stars } from './stars';

const { distribution: dist } = reviewLayout;

/**
 * Barras da distribuição 1–5 (docs/05, "Avaliações" (5)): trilho `muted`, barra `primary`, mínimo de
 * 4 px quando há avaliação. As barras são decorativas; cada linha tem o rótulo em texto.
 */
export function DistributionList({
  distribution,
  showPercent = false,
}: {
  distribution: ReviewDistribution;
  /** Painel: "18 · 78%" no lugar de "18". */
  showPercent?: boolean;
}) {
  const rows = distributionRows(distribution);
  return (
    <ul className="flex flex-col" style={{ gap: dist.rowGap }} aria-label="Distribuição das notas">
      {rows.map((row) => (
        <li
          key={row.rating}
          className="flex items-center gap-2 text-sm"
          aria-label={`${row.rating} ${row.rating === 1 ? 'estrela' : 'estrelas'}: ${reviewCountLabel(row.count)}`}
        >
          <span
            className="text-foreground inline-flex shrink-0 items-center gap-1 font-medium tabular-nums"
            style={{ width: dist.labelWidth }}
            aria-hidden
          >
            {row.rating}
            <StarIcon fill="full" size={reviewLayout.star.badge.size} />
          </span>
          <span
            className="bg-muted flex-1 overflow-hidden rounded-full"
            style={{ height: dist.barHeight }}
            aria-hidden
          >
            <span
              className="bg-primary block h-full rounded-full"
              style={{ width: `${row.percent}%`, minWidth: row.count > 0 ? 4 : 0 }}
            />
          </span>
          <span
            className="text-muted-foreground shrink-0 text-right tabular-nums"
            style={showPercent ? undefined : { width: dist.countWidth }}
            aria-hidden
          >
            {showPercent ? `${row.count} · ${row.percent}%` : row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Etiqueta de chip citado: polegar (elogio ou crítica, sem depender de cor), rótulo e contagem. */
export function TagCountChip({ tag, count }: ReviewTagCount) {
  const Icon = isPositiveReviewTag(tag) ? ThumbsUp : ThumbsDown;
  const label = REVIEW_TAG_LABELS[tag];
  return (
    <Chip
      className="gap-1.5"
      aria-label={`${label}, citado ${count} ${count === 1 ? 'vez' : 'vezes'}`}
    >
      <Icon className="text-muted-foreground size-3.5" aria-hidden />
      <span aria-hidden>{label}</span>
      <span className="font-medium tabular-nums" aria-hidden>
        {count}
      </span>
    </Chip>
  );
}

/** Média grande, estrelas e total (a coluna da esquerda do resumo). */
function AverageBlock({ average, count }: { average: number; count: number }) {
  const { fontSize, lineHeight } = reviewLayout.summaryAverage.web;
  return (
    <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-1">
      <p
        className="font-display text-foreground font-bold tabular-nums"
        style={{ fontSize, lineHeight: `${lineHeight}px` }}
        aria-hidden
      >
        {formatReviewAverage(average)}
      </p>
      <div className="flex flex-col gap-1" aria-hidden>
        <Stars value={average} size="summary" />
        <p className="text-muted-foreground text-sm">{reviewCountLabel(count)}</p>
      </div>
    </div>
  );
}

/**
 * Resumo da página do espaço com 5 ou mais avaliações: média, distribuição e chips mais citados. No
 * web ≥ 640 px, a média fica numa coluna de 160 px ao lado das barras.
 */
export function ReviewSummaryCard({
  count,
  average,
  distribution,
  topTags,
}: {
  count: number;
  average: number;
  distribution: ReviewDistribution;
  topTags: readonly ReviewTagCount[];
}) {
  const tags = topTags.slice(0, reviewLayout.topTagsCount);
  return (
    <Card
      className="gap-4 p-4"
      role="group"
      aria-label={ratingAriaLabel(average, count)}
      data-testid="avaliacoes-resumo"
    >
      <div
        className="grid gap-4 sm:grid-cols-[var(--aside)_1fr] sm:items-center"
        style={{ '--aside': `${reviewLayout.summaryAsideWidth}px` } as CSSProperties}
      >
        <AverageBlock average={average} count={count} />
        <DistributionList distribution={distribution} />
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className={cn(overline, 'text-muted-foreground')}>Mais citados</p>
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t.tag}>
                <TagCountChip tag={t.tag} count={t.count} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/** Menos de 5 avaliações: o selo "Novo" no lugar da média (RN-REVIEW-03). */
export function NewSpaceSummaryCard({ count }: { count: number }) {
  return (
    <Card className="gap-1 p-4" data-testid="avaliacoes-resumo-novo">
      <p className="flex items-center gap-2">
        <NewBadge />
        <span className="text-foreground">
          {count === 0 ? 'Ninguém avaliou ainda.' : 'Ainda poucas avaliações'}
        </span>
      </p>
      <p className="text-muted-foreground text-sm">A nota aparece a partir de 5 avaliações.</p>
    </Card>
  );
}

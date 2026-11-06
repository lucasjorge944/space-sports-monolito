import { formatReviewAverage } from '@space-sports/shared';
import { reviewLayout, type StarFill, starFills } from '@space-sports/ui-tokens';
import { Star, StarHalf } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatCount, hasPublicSummary, ratingAriaLabel } from '@/lib/reviews';
import { cn } from '@/lib/utils';

type StarSize = 'badge' | 'item' | 'summary';

/**
 * Uma estrela (docs/05, "Avaliações" (1)): cheia com o Sol e contorno `rating-border`; vazia só com o
 * contorno `rating-empty`; meia é a vazia com a `StarHalf` cheia por cima. As classes `fill-*` e
 * `stroke-*` vencem os atributos do SVG do Lucide.
 */
export function StarIcon({ fill, size }: { fill: StarFill; size: number }) {
  if (fill === 'half') {
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <Star size={size} className="fill-none stroke-rating-empty" aria-hidden />
        <StarHalf
          size={size}
          className="fill-rating stroke-rating-border absolute inset-0"
          aria-hidden
        />
      </span>
    );
  }
  return (
    <Star
      size={size}
      className={cn(
        'shrink-0',
        fill === 'full' ? 'fill-rating stroke-rating-border' : 'fill-none stroke-rating-empty',
      )}
      aria-hidden
    />
  );
}

/** As 5 estrelas de uma nota (decorativas: o texto ao lado ou o rótulo do contêiner diz a nota). */
export function Stars({ value, size = 'item' }: { value: number; size?: StarSize }) {
  const { size: px, gap } = reviewLayout.star[size];
  return (
    <span className="inline-flex items-center" style={{ gap }} aria-hidden>
      {starFills(value).map((fill, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: posição fixa da estrela
        <StarIcon key={i} fill={fill} size={px} />
      ))}
    </span>
  );
}

/** Selo "Novo" (menos de 5 avaliações): situação, não nota, então badge `info` e sem estrela. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="info"
      className={className}
      aria-label="Novo, ainda poucas avaliações"
      data-testid="selo-novo"
    >
      Novo
    </Badge>
  );
}

/** Selo "★ 4,8 (23)" ou "Novo" a partir do `rating` do espaço (docs/05, "Avaliações" (2)). */
export function RatingBadge({ rating }: { rating: { count: number; average: number | null } }) {
  if (!hasPublicSummary(rating)) return <NewBadge />;
  const average = rating.average as number;
  return (
    <span
      className="inline-flex shrink-0 items-center text-sm whitespace-nowrap"
      style={{ gap: reviewLayout.star.badge.gap }}
      role="img"
      aria-label={ratingAriaLabel(average, rating.count)}
      data-testid="selo-avaliacao"
    >
      <StarIcon fill="full" size={reviewLayout.star.badge.size} />
      <span className="text-foreground font-semibold tabular-nums">
        {formatReviewAverage(average)}
      </span>
      <span className="text-muted-foreground tabular-nums">({formatCount(rating.count)})</span>
    </span>
  );
}

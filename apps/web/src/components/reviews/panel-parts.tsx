import {
  formatReviewAverage,
  REVIEW_TAG_LABELS,
  type ReviewDistribution,
  type ReviewHighlights,
  type ReviewTagCount,
  type ReviewTrendPoint,
} from '@space-sports/shared';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardLabel, CardTitle } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/format';
import { trendAriaLabel, trendBarPercent } from '@/lib/reviews';
import { DistributionList } from './review-summary';

/** Card de indicador do painel: rótulo, valor grande e linhas de apoio. */
export function ReviewStatCard({
  label,
  value,
  children,
  testId,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="gap-2 py-4" data-testid={testId}>
      <CardHeader>
        <CardLabel>{label}</CardLabel>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="font-display flex items-center gap-2 text-3xl font-bold tabular-nums">
          {value}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const pointTitle = (p: ReviewTrendPoint) =>
  p.average === null || p.count === 0
    ? `Semana de ${formatLocalDate(p.date)}: sem avaliações`
    : `Semana de ${formatLocalDate(p.date)}: média ${formatReviewAverage(p.average)} (${p.count} ${p.count === 1 ? 'avaliação' : 'avaliações'})`;

/**
 * Tendência de 90 dias (docs/05, "Avaliações" (7)): uma coluna por ponto semanal da API, quantos
 * vierem, na ordem da API (mais recente à direita), sem agrupar nem completar no cliente. Semana sem
 * avaliação é um traço de 2 px.
 */
export function TrendChart({ points }: { points: readonly ReviewTrendPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="mt-2">
      <div
        role="img"
        aria-label={trendAriaLabel(points)}
        className="flex h-12 items-end gap-1"
        data-testid="avaliacoes-tendencia"
      >
        {points.map((point) => {
          const percent = trendBarPercent(point.count > 0 ? point.average : null);
          return (
            <span
              key={point.date}
              title={pointTitle(point)}
              className={
                percent === null ? 'bg-border h-0.5 flex-1' : 'bg-chart-1 flex-1 rounded-t-[2px]'
              }
              style={percent === null ? undefined : { height: `${percent}%` }}
            />
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Média por semana</caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Média</th>
            <th scope="col">Avaliações</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{formatLocalDate(point.date)}</td>
              <td>{point.average === null ? '—' : formatReviewAverage(point.average)}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card "Notas": as barras com contagem e percentual. */
export function DistributionCard({ distribution }: { distribution: ReviewDistribution }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Notas</CardTitle>
      </CardHeader>
      <CardContent>
        <DistributionList distribution={distribution} showPercent />
      </CardContent>
    </Card>
  );
}

function HighlightColumn({
  title,
  icon: Icon,
  tags,
  testId,
}: {
  title: string;
  icon: typeof ThumbsUp;
  tags: readonly ReviewTagCount[];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="text-muted-foreground size-4" aria-hidden />
        {title}
      </p>
      {tags.length === 0 ? (
        <p className="text-muted-foreground text-sm">—</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tags.map((t) => (
            <li key={t.tag} className="flex justify-between gap-2 text-sm">
              <span>{REVIEW_TAG_LABELS[t.tag]}</span>
              <span className="text-muted-foreground tabular-nums">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Card "Destaques": até 5 elogios e até 5 críticas mais citados, já separados e ordenados pela API
 * (`highlights`); "—" no grupo que vier vazio.
 */
export function HighlightsCard({ highlights }: { highlights: ReviewHighlights }) {
  const { positive, negative } = highlights;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Destaques</CardTitle>
      </CardHeader>
      <CardContent>
        {positive.length === 0 && negative.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum destaque escolhido ainda</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <HighlightColumn
              title="Elogios"
              icon={ThumbsUp}
              tags={positive}
              testId="destaques-elogios"
            />
            <HighlightColumn
              title="Críticas"
              icon={ThumbsDown}
              tags={negative}
              testId="destaques-criticas"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

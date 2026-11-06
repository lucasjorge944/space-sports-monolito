'use client';

import {
  getSuperGetReviewQueryKey,
  getSuperListReviewReportsQueryKey,
  getSuperListReviewsQueryKey,
  isApiError,
  superDismissReviewReport,
  superHideReviewComment,
  superUnhideReviewComment,
  useSuperGetReview,
} from '@space-sports/api-client';
import type { SuperReviewDetail, SuperReviewReport } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReviewItem } from '@/components/reviews/review-item';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { moderationEntryText, REPORT_REASON_LABEL } from '@/lib/reviews';
import { textLink } from '@/lib/utils';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { ReasonDialog } from '../reason-dialog';
import {
  BlockedAuthorBadge,
  isOutOfAverage,
  OpenReportsBadge,
  ReportStatusBadge,
  reviewActionError,
  superReviewItemData,
} from './review-parts';

const back = { href: '/super/avaliacoes', label: 'Denúncias' };

/** Depois de moderar: o detalhe vem na resposta; a fila e as listas por espaço recarregam. */
function useApplyDetail(reviewId: string) {
  const queryClient = useQueryClient();
  return async (detail: SuperReviewDetail) => {
    queryClient.setQueryData(getSuperGetReviewQueryKey(reviewId), detail);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getSuperListReviewReportsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getSuperListReviewsQueryKey() }),
    ]);
  };
}

/** Detalhe da avaliação no Super (RF-REVIEW-07): ocultar/reexibir o comentário e as denúncias. */
export function SuperReviewDetailView({ reviewId }: { reviewId: string }) {
  const query = useSuperGetReview(reviewId);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Avaliação" back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Avaliação" back={back} />
        {notFound ? (
          <EmptyBlock>Avaliação não encontrada. Ela pode ter sido excluída pelo autor.</EmptyBlock>
        ) : (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  return <Detail review={query.data} />;
}

function Detail({ review }: { review: SuperReviewDetail }) {
  const apply = useApplyDetail(review.id);
  const [moderating, setModerating] = useState(false);
  const hidden = review.hidden !== null;
  const reports = [...review.reports].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={back}
        title={`Avaliação do ${review.space.name}`}
        description={`Criada em ${formatDateTime(review.createdAt)}${
          review.updatedAt !== review.createdAt
            ? ` · editada em ${formatDateTime(review.updatedAt)}`
            : ''
        }`}
        actions={
          hidden ? (
            <Button variant="outline" onClick={() => setModerating(true)}>
              <Eye aria-hidden />
              Reexibir comentário
            </Button>
          ) : review.comment ? (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setModerating(true)}
              data-testid="super-avaliacao-ocultar"
            >
              <EyeOff aria-hidden />
              Ocultar comentário
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-2">
          <CardContent className="flex flex-col gap-3">
            <ReviewItem
              review={superReviewItemData(review)}
              space={{ name: review.space.name, logoUrl: null }}
              variant="panel"
              hiddenComment={review.comment}
              badges={
                <>
                  {isOutOfAverage(review) ? <BlockedAuthorBadge /> : null}
                  <OpenReportsBadge count={review.openReports} />
                </>
              }
            />
            <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="text-muted-foreground">Espaço</dt>
              <dd>
                <Link href={`/super/espacos/${review.space.id}/avaliacoes`} className={textLink}>
                  {review.space.name}
                </Link>
              </dd>
              <dt className="text-muted-foreground">Autor</dt>
              <dd>
                {review.author.userId ? (
                  <Link href={`/super/usuarios/${review.author.userId}`} className={textLink}>
                    {review.author.name}
                  </Link>
                ) : (
                  'Usuário removido'
                )}
              </dd>
              {hidden && review.hidden ? (
                <>
                  <dt className="text-muted-foreground">Oculto</dt>
                  <dd>
                    {formatDateTime(review.hidden.at)}
                    {review.hidden.byName ? ` por ${review.hidden.byName}` : ''}
                    {review.hidden.reason ? ` · Motivo: ${review.hidden.reason}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Denúncias</CardTitle>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhuma denúncia.</p>
              ) : (
                <ul className="divide-border flex flex-col divide-y">
                  {reports.map((report) => (
                    <ReportRow key={report.id} report={report} review={review} onApplied={apply} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Histórico de moderação</CardTitle>
            </CardHeader>
            <CardContent>
              {review.history.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nada por enquanto.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm" data-testid="historico-moderacao">
                  {review.history.map((entry) => {
                    const { title, reason } = moderationEntryText(entry);
                    return (
                      <li key={entry.id}>
                        {title} · {formatDateTime(entry.createdAt)}
                        {reason ? ` · Motivo: ${reason}` : ''}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={moderating}
        onOpenChange={setModerating}
        title={hidden ? 'Reexibir o comentário?' : 'Ocultar o comentário?'}
        description={
          hidden
            ? 'Ele volta a aparecer no app e no site.'
            : 'A nota e os chips continuam valendo. As denúncias abertas desta avaliação são resolvidas.'
        }
        required
        requiredMessage="Escreva o motivo"
        confirmLabel={hidden ? 'Reexibir comentário' : 'Ocultar comentário'}
        pendingLabel={hidden ? 'Reexibindo…' : 'Ocultando…'}
        destructive={!hidden}
        formatError={reviewActionError}
        onConfirm={async (reason) => {
          const body = { reason: reason ?? '' };
          const detail = hidden
            ? await superUnhideReviewComment(review.id, body)
            : await superHideReviewComment(review.id, body);
          toast.success(hidden ? 'Comentário reexibido' : 'Comentário ocultado');
          await apply(detail);
        }}
      />
    </div>
  );
}

function ReportRow({
  report,
  review,
  onApplied,
}: {
  report: SuperReviewReport;
  review: SuperReviewDetail;
  onApplied: (detail: SuperReviewDetail) => Promise<void>;
}) {
  const [dismissing, setDismissing] = useState(false);
  const who = report.reporter.spaceId
    ? `Espaço · ${review.space.name}`
    : (report.reporter.name ?? 'Usuário removido');
  return (
    <li className="flex flex-col gap-1 py-3 text-sm" data-testid={`denuncia-${report.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{REPORT_REASON_LABEL[report.reason]}</span>
        <ReportStatusBadge status={report.status} />
      </div>
      {report.details ? <p className="whitespace-pre-line">{report.details}</p> : null}
      <p className="text-muted-foreground">
        {who} · {formatDateTime(report.createdAt)}
        {report.resolvedAt
          ? ` · ${report.status === 'DISMISSED' ? 'descartada' : 'resolvida'} em ${formatDateTime(report.resolvedAt)}${report.resolvedByName ? ` por ${report.resolvedByName}` : ''}`
          : ''}
      </p>
      {report.resolutionReason ? (
        <p className="text-muted-foreground whitespace-pre-line">
          Motivo: {report.resolutionReason}
        </p>
      ) : null}
      {report.status === 'OPEN' ? (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setDismissing(true)}>
          Descartar
        </Button>
      ) : null}
      <ReasonDialog
        open={dismissing}
        onOpenChange={setDismissing}
        title="Descartar esta denúncia?"
        description="A avaliação continua como está. O motivo fica no histórico de moderação."
        confirmLabel="Descartar"
        pendingLabel="Descartando…"
        formatError={reviewActionError}
        onConfirm={async (reason) => {
          const detail = await superDismissReviewReport(report.id, reason ? { reason } : {});
          toast.success('Denúncia descartada');
          await onApplied(detail);
        }}
      />
    </li>
  );
}

'use client';

import {
  getSuperListReviewReportsQueryKey,
  superListReviewReports,
} from '@space-sports/api-client';
import type { ReviewReportStatus, SuperReviewReportItem } from '@space-sports/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Stars } from '@/components/reviews/stars';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import { commentExcerpt, parseReportStatus, REPORT_REASON_LABEL } from '@/lib/reviews';
import { textLink } from '@/lib/utils';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { BlockedAuthorBadge, isOutOfAverage, ReportStatusBadge } from './review-parts';

const EMPTY_TEXT: Record<ReviewReportStatus, string> = {
  OPEN: 'Nenhuma denúncia aberta',
  RESOLVED: 'Nenhuma denúncia resolvida',
  DISMISSED: 'Nenhuma denúncia descartada',
};

function ReviewCell({ report }: { report: SuperReviewReportItem }) {
  const { review } = report;
  return (
    <div className="flex flex-col gap-1">
      <span role="img" aria-label={`${review.rating} de 5 estrelas`}>
        <Stars value={review.rating} />
      </span>
      {review.hidden ? (
        <span className="text-muted-foreground text-sm">Comentário oculto</span>
      ) : review.comment ? (
        <span className="text-sm">{commentExcerpt(review.comment)}</span>
      ) : (
        <span className="text-muted-foreground text-sm">Sem comentário</span>
      )}
      {isOutOfAverage(review) ? <BlockedAuthorBadge /> : null}
    </div>
  );
}

function reporterName(report: SuperReviewReportItem): string {
  if (report.reporter.spaceId) return `Espaço · ${report.review.space.name}`;
  return report.reporter.name ?? 'Usuário removido';
}

/** Fila de denúncias (RF-REVIEW-07; docs/05, "Avaliações" (8)): abas de status na URL. */
export function ReportsQueue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = parseReportStatus(params.get('status'));
  const query = useInfiniteQuery({
    queryKey: [...getSuperListReviewReportsQueryKey({ status }), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      superListReviewReports({ status, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Avaliações"
        description="Denúncias de avaliações. Ocultar esconde só o comentário: a nota continua valendo."
      />
      <Tabs
        value={status}
        onValueChange={(value) =>
          router.replace(value === 'OPEN' ? pathname : `${pathname}?status=${value}`, {
            scroll: false,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="OPEN">Abertas</TabsTrigger>
          <TabsTrigger value="RESOLVED">Resolvidas</TabsTrigger>
          <TabsTrigger value="DISMISSED">Descartadas</TabsTrigger>
        </TabsList>
      </Tabs>

      {query.isPending ? (
        <LoadingBlock />
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock>{EMPTY_TEXT[status]}</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebida</TableHead>
                  <TableHead>Espaço</TableHead>
                  <TableHead>Avaliação</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Denunciante</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((report) => {
                  const href = `/super/avaliacoes/${report.reviewId}`;
                  return (
                    <TableRow
                      key={report.id}
                      className="cursor-pointer"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a')) return;
                        router.push(href);
                      }}
                      data-testid={`denuncia-${report.id}`}
                    >
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <Link href={href} className={textLink}>
                          {formatDateTime(report.createdAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/super/espacos/${report.review.space.id}/avaliacoes`}
                          className={textLink}
                        >
                          {report.review.space.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-80 whitespace-normal">
                        <ReviewCell report={report} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          {REPORT_REASON_LABEL[report.reason]}
                          {report.details ? (
                            <MessageSquareText
                              className="text-muted-foreground size-4"
                              aria-label={`Detalhes: ${report.details}`}
                            >
                              <title>{report.details}</title>
                            </MessageSquareText>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>{reporterName(report)}</TableCell>
                      <TableCell>
                        <ReportStatusBadge status={report.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              className="w-fit self-center"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

'use client';

import {
  getGetManageReviewSummaryQueryKey,
  getListManageReviewsQueryKey,
  listManageReviews,
  reportReviewAsSpace,
  useDeleteReviewReply,
  useGetManagedSpace,
  useGetManageReviewSummary,
  useReplyToReview,
} from '@space-sports/api-client';
import {
  formatReviewAverage,
  type ManageReview,
  type ManageReviewSummary,
  REVIEW_REPLY_MAX_LENGTH,
} from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareReply, Pencil, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Field } from '@/components/painel/field';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, PageHeader } from '@/components/painel/states';
import {
  DistributionCard,
  HighlightsCard,
  ReviewStatCard,
  TrendChart,
} from '@/components/reviews/panel-parts';
import { ReviewReportMenu } from '@/components/reviews/report-dialog';
import { ReviewItem, ReviewReplyBlock } from '@/components/reviews/review-item';
import { Stars } from '@/components/reviews/stars';
import { useSelectedSpace } from '@/components/shell/selected-space';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipButton } from '@/components/ui/chip';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/painel/errors';
import {
  averageVisibilityHint,
  type PanelReviewFilters,
  panelFilteredCount,
  parsePanelFilters,
  parseRatingFilter,
  RATINGS_DESC,
  reviewCountLabel,
} from '@/lib/reviews';
import { cn, focusRing, textLink } from '@/lib/utils';

/** /painel/avaliacoes (RF-REVIEW-06): ver (Dono, Admin, Professor); responder e denunciar (Dono, Admin). */
export function AvaliacoesView() {
  return (
    <SpaceGate permission="review.view">{(scope) => <SpaceReviews scope={scope} />}</SpaceGate>
  );
}

/**
 * Filtros na URL (`?nota=&sem-resposta=1`). O estado local é a fonte de verdade: o `useSearchParams`
 * só muda depois do `router.replace`, e duas mudanças seguidas perderiam a primeira.
 */
function useFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [filters, setLocal] = useState(() => parsePanelFilters(params));
  const latest = useRef(filters);
  function updateFilters(patch: Partial<PanelReviewFilters>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setLocal(next);
    const search = new URLSearchParams(window.location.search);
    if (next.rating) search.set('nota', String(next.rating));
    else search.delete('nota');
    if (next.unanswered) search.set('sem-resposta', '1');
    else search.delete('sem-resposta');
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  return [filters, updateFilters] as const;
}

function SpaceReviews({ scope }: { scope: SpaceScope }) {
  const { selected } = useSelectedSpace();
  const space = { name: scope.spaceName, logoUrl: selected?.space.logoUrl ?? null };
  const canReply = scope.canWrite('review.reply');
  const [filters, setFilters] = useFilters();
  const summary = useGetManageReviewSummary(scope.spaceId, { trend: 'WEEK' });
  // Se o espaço está na vitrine (o apoio da média diz se o público vê a nota).
  const managed = useGetManagedSpace(scope.spaceId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Avaliações"
        description={`O que jogadores e alunos dizem do ${scope.spaceName}. As respostas são públicas.`}
      />
      <ReadOnlyNotice scope={scope} />
      {!scope.can('review.reply') ? (
        <Alert variant="info" role="status" className="py-2">
          Você vê as avaliações do espaço. Só o Dono e os Administradores respondem.
        </Alert>
      ) : null}

      {summary.isPending || managed.isPending ? (
        <div
          className="grid gap-4 sm:grid-cols-3"
          role="status"
          aria-label="Carregando indicadores"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <Indicators
          summary={summary.data}
          inShowcase={managed.isError ? null : managed.data.showcase.visible}
          onShowUnanswered={() => setFilters({ rating: undefined, unanswered: true })}
        />
      )}

      <ReviewList
        scope={scope}
        space={space}
        canReply={canReply}
        filters={filters}
        setFilters={setFilters}
        summary={summary.data}
      />
    </div>
  );
}

function Indicators({
  summary,
  inShowcase,
  onShowUnanswered,
}: {
  summary: ManageReviewSummary;
  /** `showcase.visible` do espaço; `null` se ele não carregou. */
  inShowcase: boolean | null;
  onShowUnanswered: () => void;
}) {
  // Total e média dos 90 dias vêm prontos da API (soma ÷ contagem no banco).
  const last90 = summary.trend;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <ReviewStatCard
          label="Média"
          testId="avaliacoes-media"
          value={
            summary.average === null ? (
              '—'
            ) : (
              <>
                {formatReviewAverage(summary.average)}
                <Stars value={summary.average} size="summary" />
              </>
            )
          }
        >
          <p className="text-muted-foreground text-xs">
            {averageVisibilityHint(summary, inShowcase)}
          </p>
        </ReviewStatCard>
        <ReviewStatCard label="Total" value={summary.count} testId="avaliacoes-total">
          {summary.count === 0 ? null : summary.unansweredCount > 0 ? (
            <button
              type="button"
              className={cn(textLink, 'w-fit rounded-sm text-left text-xs', focusRing)}
              onClick={onShowUnanswered}
            >
              {summary.unansweredCount} sem resposta
            </button>
          ) : (
            <p className="text-muted-foreground text-xs">Todas respondidas</p>
          )}
        </ReviewStatCard>
        <ReviewStatCard
          label="Últimos 90 dias"
          value={last90.average === null ? '—' : formatReviewAverage(last90.average)}
          testId="avaliacoes-90-dias"
        >
          <p className="text-muted-foreground text-xs">
            {reviewCountLabel(last90.count)}
            {summary.average !== null ? ` · geral ${formatReviewAverage(summary.average)}` : ''}
          </p>
          <TrendChart points={summary.trend.points} />
        </ReviewStatCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DistributionCard distribution={summary.distribution} />
        <HighlightsCard highlights={summary.highlights} />
      </div>
    </>
  );
}

function ReviewList({
  scope,
  space,
  canReply,
  filters,
  setFilters,
  summary,
}: {
  scope: SpaceScope;
  space: { name: string; logoUrl: string | null };
  canReply: boolean;
  filters: PanelReviewFilters;
  setFilters: (patch: Partial<PanelReviewFilters>) => void;
  summary: ManageReviewSummary | undefined;
}) {
  const params = {
    limit: reviewLayout.pageSize,
    ...(filters.rating ? { rating: filters.rating } : {}),
    ...(filters.unanswered ? { unanswered: 'true' } : {}),
  };
  const query = useInfiniteQuery({
    queryKey: [...getListManageReviewsQueryKey(scope.spaceId, params), 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listManageReviews(scope.spaceId, { ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // Um compositor aberto por vez.
  const [composing, setComposing] = useState<string | null>(null);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(filters.rating || filters.unanswered);
  const count = summary ? panelFilteredCount(summary, filters) : null;

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nota" htmlFor="avaliacoes-nota">
            <Select
              id="avaliacoes-nota"
              value={filters.rating ? String(filters.rating) : ''}
              onChange={(e) =>
                setFilters({ ...filters, rating: parseRatingFilter(e.target.value) })
              }
            >
              <option value="">Todas</option>
              {RATINGS_DESC.map((r) => (
                <option key={r} value={r}>
                  {r} {r === 1 ? 'estrela' : 'estrelas'}
                </option>
              ))}
            </Select>
          </Field>
          <ChipButton
            selected={filters.unanswered}
            onClick={() => setFilters({ unanswered: !filters.unanswered })}
          >
            Sem resposta
          </ChipButton>
        </div>
        {count !== null ? (
          <p className="text-muted-foreground text-sm" data-testid="avaliacoes-contagem">
            {reviewCountLabel(count)}
          </p>
        ) : null}
      </div>
      <div className="px-4">
        {query.isPending ? (
          <div
            className="flex flex-col gap-3 py-4"
            role="status"
            aria-label="Carregando avaliações"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="py-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="py-4">
            {filtered ? (
              <EmptyState
                title="Nenhuma avaliação com esses filtros"
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFilters({ rating: undefined, unanswered: false })}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="Nenhuma avaliação ainda"
                description="Quem joga ou faz aula aqui recebe um pedido de avaliação cerca de 2 horas depois."
              />
            )}
          </div>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {items.map((review) => (
              <li key={review.id}>
                <PanelReviewItem
                  scope={scope}
                  space={space}
                  review={review}
                  canReply={canReply}
                  composing={composing === review.id}
                  onCompose={(open) => setComposing(open ? review.id : null)}
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
  );
}

/** Atualiza a lista e os indicadores depois de responder, editar ou remover a resposta. */
function useInvalidateReviews(spaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListManageReviewsQueryKey(spaceId) }),
      queryClient.invalidateQueries({ queryKey: getGetManageReviewSummaryQueryKey(spaceId) }),
    ]);
}

function PanelReviewItem({
  scope,
  space,
  review,
  canReply,
  composing,
  onCompose,
}: {
  scope: SpaceScope;
  space: { name: string; logoUrl: string | null };
  review: ManageReview;
  canReply: boolean;
  composing: boolean;
  onCompose: (open: boolean) => void;
}) {
  const [reported, setReported] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const invalidate = useInvalidateReviews(scope.spaceId);
  const remove = useDeleteReviewReply();

  let replyArea: React.ReactNode = null;
  if (composing) {
    replyArea = (
      <ReplyComposer
        scope={scope}
        space={space}
        review={review}
        onClose={() => onCompose(false)}
        onSaved={invalidate}
      />
    );
  } else if (review.reply) {
    replyArea = (
      <div className="flex flex-col gap-2">
        <ReviewReplyBlock reply={review.reply} space={space} />
        {canReply ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => onCompose(true)}>
              <Pencil aria-hidden />
              Editar resposta
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden />
              Remover resposta
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else if (canReply) {
    replyArea = (
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onCompose(true)}
        data-testid={`painel-avaliacoes-responder-${review.id}`}
      >
        <MessageSquareReply aria-hidden />
        Responder
      </Button>
    );
  }

  return (
    <>
      <ReviewItem
        review={review}
        space={space}
        variant="panel"
        replyArea={replyArea}
        menu={
          canReply ? (
            <ReviewReportMenu
              reviewId={review.id}
              authorName={review.author.name}
              reported={reported || review.reportedBySpace}
              context="panel"
              submit={(body) => reportReviewAsSpace(scope.spaceId, review.id, body)}
              onReported={() => {
                setReported(true);
                void invalidate();
              }}
            />
          ) : null
        }
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          setConfirmRemove(open);
          if (!open) remove.reset();
        }}
        title="Remover a resposta?"
        description="Ela sai da página do espaço e do app."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(
            { spaceId: scope.spaceId, reviewId: review.id },
            {
              onSuccess: async () => {
                setConfirmRemove(false);
                toast.success('Resposta removida');
                await invalidate();
              },
            },
          )
        }
      />
    </>
  );
}

/** Compositor da resposta (no próprio item): pública, com o nome do espaço, até 500 caracteres. */
function ReplyComposer({
  scope,
  space,
  review,
  onClose,
  onSaved,
}: {
  scope: SpaceScope;
  space: { name: string; logoUrl: string | null };
  review: ManageReview;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const initial = review.reply?.body ?? '';
  const editing = review.reply !== null;
  const [body, setBody] = useState(initial);
  const [fieldError, setFieldError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const reply = useReplyToReview();
  const id = `resposta-${review.id}`;
  const dirty = body.trim() !== initial.trim();

  function cancel() {
    if (dirty && body.trim()) setConfirmDiscard(true);
    else onClose();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) {
      setFieldError('Escreva a resposta');
      return;
    }
    reply.mutate(
      { spaceId: scope.spaceId, reviewId: review.id, data: { body: text } },
      {
        onSuccess: async () => {
          toast.success(editing ? 'Resposta atualizada' : 'Resposta publicada');
          await onSaved();
          onClose();
        },
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      className="flex flex-col gap-2 rounded-md border p-3"
      noValidate
    >
      <FormError message={reply.error ? apiErrorMessage(reply.error) : undefined} />
      <Field
        label={`Responder como ${space.name}`}
        htmlFor={id}
        error={fieldError}
        hint={
          <span className="flex justify-between gap-2">
            <span>A resposta é pública e aparece com o nome do espaço.</span>
            <span className="tabular-nums">
              {body.length}/{REVIEW_REPLY_MAX_LENGTH}
            </span>
          </span>
        }
      >
        <Textarea
          id={id}
          autoFocus
          rows={3}
          className="max-h-48"
          value={body}
          maxLength={REVIEW_REPLY_MAX_LENGTH}
          onChange={(e) => {
            setBody(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={reply.isPending}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={reply.isPending}>
          {reply.isPending ? 'Publicando…' : editing ? 'Salvar resposta' : 'Publicar resposta'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar a resposta?"
        description="O texto escrito será perdido."
        confirmLabel="Descartar"
        pending={false}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </form>
  );
}

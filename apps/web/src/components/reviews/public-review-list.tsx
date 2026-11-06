'use client';

import { listSpaceReviews, reportReview, useGetMe } from '@space-sports/api-client';
import type { PublicReview } from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ReviewRating, reviewsPagePath } from '@/lib/reviews';
import { ReviewReportMenu } from './report-dialog';
import { ReviewItem } from './review-item';

const SESSION_STALE_MS = 5 * 60_000;

/**
 * A página pública vê uma sessão do web? A página é renderizada no servidor sem ler cookies (fica em
 * cache para SEO) e o cookie de sessão é `HttpOnly`, então quem decide é o `GET /v1/me` feito pelo
 * browser (pelo rewrite de `/v1`). Sem sessão, 401 e nada de menu; sem repetir nem redirecionar
 * (diferente do `useMe` do painel).
 */
export function useWebSession(): boolean {
  const me = useGetMe({ query: { retry: false, staleTime: SESSION_STALE_MS } });
  return me.isSuccess;
}

function PublicReviewItem({
  review,
  space,
  canReport,
}: {
  review: PublicReview;
  space: { name: string; logoUrl: string | null };
  canReport: boolean;
}) {
  const [reported, setReported] = useState(false);
  return (
    <ReviewItem
      review={review}
      space={space}
      menu={
        canReport ? (
          <ReviewReportMenu
            reviewId={review.id}
            authorName={review.author.name}
            reported={reported}
            context="public"
            submit={(body) => reportReview(review.id, body)}
            onReported={() => setReported(true)}
          />
        ) : null
      }
    />
  );
}

/** Itens da página pública (os 3 recentes do bloco ou uma página da lista), com "Denunciar". */
export function PublicReviewItems({
  reviews,
  space,
}: {
  reviews: readonly PublicReview[];
  space: { name: string; logoUrl: string | null };
}) {
  const canReport = useWebSession();
  return (
    <ul className="divide-border flex flex-col divide-y">
      {reviews.map((review) => (
        <li key={review.id}>
          <PublicReviewItem review={review} space={space} canReport={canReport} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Lista "Ver todas" (docs/05, "Avaliações" (6)): os 20 primeiros vêm do servidor. "Carregar mais
 * avaliações" é um link `?nota=&cursor=` (funciona sem JS); com JS, busca e acrescenta na mesma
 * página, leva o foco ao primeiro item novo e avisa no `aria-live`.
 */
export function PublicReviewList({
  spaceId,
  slug,
  rating,
  space,
  initialItems,
  initialCursor,
}: {
  spaceId: string;
  slug: string;
  rating: ReviewRating | undefined;
  space: { name: string; logoUrl: string | null };
  initialItems: readonly PublicReview[];
  initialCursor: string | null;
}) {
  const canReport = useWebSession();
  const [items, setItems] = useState<readonly PublicReview[]>(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  async function loadMore(event: React.MouseEvent<HTMLAnchorElement>) {
    // Antes da guarda: um segundo clique durante o carregamento não pode seguir o link (?cursor=),
    // que trocaria a lista acumulada pela página seguinte sozinha.
    event.preventDefault();
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await listSpaceReviews(spaceId, {
        cursor,
        limit: reviewLayout.pageSize,
        ...(rating ? { rating } : {}),
      });
      const firstNew = items.length;
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setAnnouncement(
        `${page.items.length} ${page.items.length === 1 ? 'avaliação carregada' : 'avaliações carregadas'}`,
      );
      requestAnimationFrame(() => {
        const next = listRef.current?.children[firstNew]?.querySelector('article');
        next?.setAttribute('tabindex', '-1');
        (next as HTMLElement | null | undefined)?.focus();
      });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={listRef}
        className="divide-border flex flex-col divide-y"
        data-testid="avaliacoes-lista"
      >
        {items.map((review) => (
          <li key={review.id}>
            <PublicReviewItem review={review} space={space} canReport={canReport} />
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {failed ? (
        <p className="text-muted-foreground text-sm" role="alert">
          Não foi possível carregar mais. Tente de novo.
        </p>
      ) : null}
      {cursor ? (
        <Button variant="outline" size="xl" className="self-center" asChild>
          <a
            href={reviewsPagePath(slug, { rating, cursor })}
            onClick={loadMore}
            aria-disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Carregar mais avaliações
          </a>
        </Button>
      ) : null}
    </div>
  );
}

'use client';

import {
  REVIEW_TAG_LABELS,
  REVIEW_TAGS,
  type ReviewAuthorKind,
  type ReviewReply,
  type ReviewTag,
} from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { EyeOff, GraduationCap, LandPlot, User } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { UserAvatar } from '@/components/account/user-avatar';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { formatDate } from '@/lib/format';
import {
  isEditedAfterReply,
  isRemovedAuthor,
  relativeReviewDate,
  reviewMetaAriaLabel,
} from '@/lib/reviews';
import { cn, focusRing, textLink } from '@/lib/utils';
import { Stars } from './stars';

/** O que o item precisa: a avaliação pública, a do painel e a do Super cabem aqui. */
export type ReviewItemData = {
  id: string;
  author: { name: string; avatarUrl: string | null; kind: ReviewAuthorKind | null };
  rating: number;
  tags: readonly ReviewTag[];
  /** Nulo sem comentário ou oculto (na lista pública). */
  comment: string | null;
  commentHidden: boolean;
  reply: ReviewReply | null;
  createdAt: string;
  updatedAt: string;
};

const AUTHOR_KIND = {
  PLAYER: { label: 'Jogou aqui', icon: LandPlot },
  STUDENT: { label: 'Aluno', icon: GraduationCap },
} as const;

const TAG_ORDER = new Map(REVIEW_TAGS.map((tag, i) => [tag, i]));

/**
 * Texto com corte de linhas e "Ler mais" que expande no lugar. O botão só aparece se o texto passar
 * do corte (medido depois de montar; sem JS, o texto fica cortado).
 */
function ClampedText({ text, lines, testId }: { text: string; lines?: number; testId?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !lines) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [lines]);

  const clamped = Boolean(lines) && !expanded;
  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={ref}
        className="text-foreground text-sm whitespace-pre-line [overflow-wrap:anywhere]"
        style={
          clamped
            ? {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lines,
                overflow: 'hidden',
              }
            : undefined
        }
        data-testid={testId}
      >
        {text}
      </p>
      {lines && (overflows || expanded) ? (
        <button
          type="button"
          className={cn(textLink, 'rounded-sm text-sm font-medium', focusRing)}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Ler menos' : 'Ler mais'}
        </button>
      ) : null}
    </div>
  );
}

/** Resposta pública do espaço, recuada sob o texto do autor (decisão 104). */
export function ReviewReplyBlock({
  reply,
  space,
  clampLines,
}: {
  reply: ReviewReply;
  space: { name: string; logoUrl: string | null };
  clampLines?: number | undefined;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: `fieldset` é de formulário; aqui é só o agrupamento da resposta com rótulo.
    <div
      role="group"
      aria-label={`Resposta do ${space.name}`}
      className="bg-muted flex flex-col gap-1 rounded-md p-3"
      data-testid="avaliacao-resposta"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-sm">
        <SpaceAvatar
          name={space.name}
          logoUrl={space.logoUrl}
          size={reviewLayout.item.replyAvatarSize}
          decorative
        />
        <span className="text-foreground truncate font-semibold">Resposta do {space.name}</span>
        <span className="text-muted-foreground shrink-0">
          ·{' '}
          <time
            dateTime={reply.repliedAt}
            title={formatDate(reply.repliedAt)}
            suppressHydrationWarning
          >
            {relativeReviewDate(reply.repliedAt)}
          </time>
        </span>
      </p>
      <ClampedText text={reply.body} lines={clampLines} />
    </div>
  );
}

function Author({ author, badges }: { author: ReviewItemData['author']; badges?: ReactNode }) {
  const size = reviewLayout.item.avatarSize;
  if (isRemovedAuthor(author.name)) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="bg-muted inline-flex shrink-0 items-center justify-center rounded-full"
          style={{ width: size, height: size }}
          aria-hidden
        >
          <User className="text-muted-foreground size-[18px]" />
        </span>
        <span className="text-muted-foreground truncate text-sm font-medium">{author.name}</span>
        {badges}
      </div>
    );
  }
  const kind = author.kind ? AUTHOR_KIND[author.kind] : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <UserAvatar name={author.name} avatarUrl={author.avatarUrl} size={size} decorative />
      <span className="text-foreground truncate text-sm font-semibold">{author.name}</span>
      {kind ? (
        <Badge variant="muted">
          <kind.icon aria-hidden />
          {kind.label}
        </Badge>
      ) : null}
      {badges}
    </div>
  );
}

/**
 * Item de avaliação (docs/05, "Avaliações" (5)): autor, nota e data, chips, comentário, resposta do
 * espaço. `variant="public"` corta o comentário em 6 linhas; o painel e o Super mostram tudo.
 */
export function ReviewItem({
  review,
  space,
  variant = 'public',
  menu,
  badges,
  hiddenComment,
  replyArea,
  footer,
}: {
  review: ReviewItemData;
  space: { name: string; logoUrl: string | null };
  variant?: 'public' | 'panel';
  /** Menu "⋮" no canto (só para quem está logado). */
  menu?: ReactNode;
  /** Selos ao lado do nome (Super: "Autor bloqueado · fora da média", denúncias abertas). */
  badges?: ReactNode;
  /** Super: o comentário oculto pela moderação, mostrado em `muted` com o selo "Oculto". */
  hiddenComment?: string | null;
  /** Painel: troca o bloco da resposta (compositor, botões de editar e remover). */
  replyArea?: ReactNode;
  /** Ações abaixo do item (ex.: "Moderar" no Super). */
  footer?: ReactNode;
}) {
  const clampLines = variant === 'public' ? reviewLayout.commentClampLines.web : undefined;
  const edited = isEditedAfterReply(review);
  const tags = [...review.tags].sort((a, b) => (TAG_ORDER.get(a) ?? 0) - (TAG_ORDER.get(b) ?? 0));
  const indent = { paddingLeft: reviewLayout.item.replyIndent };

  return (
    <article
      className="flex flex-col gap-2 py-4"
      aria-label={`Avaliação de ${review.author.name}`}
      data-testid={`avaliacao-item-${review.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Author author={review.author} badges={badges} />
        {menu}
      </div>
      <div className="flex flex-col gap-2" style={indent}>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-sm">
          <span className="sr-only">{reviewMetaAriaLabel(review.rating, review.createdAt)}</span>
          <Stars value={review.rating} size="item" />
          <span aria-hidden>·</span>
          <time
            dateTime={review.createdAt}
            title={formatDate(review.createdAt)}
            aria-hidden
            suppressHydrationWarning
          >
            {relativeReviewDate(review.createdAt)}
          </time>
          {edited ? (
            <span title="Editada depois da resposta do espaço">
              <span aria-hidden>· </span>editada
              <span className="sr-only"> depois da resposta do espaço</span>
            </span>
          ) : null}
        </p>
        {tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Destaques">
            {tags.map((tag) => (
              <li key={tag}>
                <Chip className="px-2.5 py-1 text-xs">{REVIEW_TAG_LABELS[tag]}</Chip>
              </li>
            ))}
          </ul>
        ) : null}
        {review.commentHidden && hiddenComment ? (
          <div className="bg-muted flex flex-col gap-1 rounded-md p-3">
            <Badge variant="muted">
              <EyeOff aria-hidden />
              Oculto
            </Badge>
            <p className="text-muted-foreground text-sm whitespace-pre-line [overflow-wrap:anywhere]">
              {hiddenComment}
            </p>
          </div>
        ) : review.commentHidden ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm italic">
            <EyeOff className="size-3.5 shrink-0" aria-hidden />
            Comentário oculto pela moderação.
          </p>
        ) : review.comment ? (
          <ClampedText text={review.comment} lines={clampLines} testId="avaliacao-comentario" />
        ) : null}
        {replyArea !== undefined ? (
          replyArea
        ) : review.reply ? (
          <ReviewReplyBlock reply={review.reply} space={space} clampLines={clampLines} />
        ) : null}
        {footer}
      </div>
    </article>
  );
}

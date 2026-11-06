import type { PublicReviewPageItemsItem } from '@space-sports/api-client';
import {
  REVIEW_REMOVED_AUTHOR_NAME,
  REVIEW_TAG_LABELS,
  type ReviewTag,
} from '@space-sports/shared';
import { reviewLayout } from '@space-sports/ui-tokens';
import { EllipsisVertical, EyeOff, GraduationCap, LandPlot, User } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BottomSheet, useMenuSheet } from '@/components/bottom-sheet';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { UserAvatar } from '@/components/user-avatar';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { editedAfterReply, relativeDate, relativeDateSpoken, starsSpoken } from './format';
import { StarRow } from './stars';

export type ReviewItemData = Pick<
  PublicReviewPageItemsItem,
  'id' | 'rating' | 'tags' | 'comment' | 'commentHidden' | 'reply' | 'createdAt' | 'updatedAt'
> & { author?: PublicReviewPageItemsItem['author'] };

const ITEM = reviewLayout.item;

/** Texto com corte de 4 linhas e "Ler mais"/"Ler menos" (docs/05, "Item de avaliação"). */
export function ClampedText({
  text,
  className,
  testID,
}: {
  text: string;
  className?: string;
  testID?: string;
}) {
  const lines = reviewLayout.commentClampLines.app;
  const [measured, setMeasured] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const clampable = measured !== null && measured > lines;
  return (
    <View className="items-start">
      <Text
        testID={testID}
        className={cn('text-base text-foreground', className)}
        // Mede uma vez sem corte; acima de 4 linhas, corta e mostra o "Ler mais".
        numberOfLines={clampable && !expanded ? lines : undefined}
        onTextLayout={(event) => {
          if (measured === null) setMeasured(event.nativeEvent.lines.length);
        }}
      >
        {text}
      </Text>
      {clampable ? (
        <Pressable
          role="button"
          onPress={() => setExpanded((value) => !value)}
          className="min-h-11 justify-center"
        >
          <Text className="font-medium text-link">{expanded ? 'Ler menos' : 'Ler mais'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Etiquetas dos chips escolhidos, na ordem do catálogo, sem toque. */
export function TagList({ tags }: { tags: readonly ReviewTag[] }) {
  if (tags.length === 0) return null;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {tags.map((tag) => (
        <Badge key={tag} variant="sport">
          <Text>{REVIEW_TAG_LABELS[tag]}</Text>
        </Badge>
      ))}
    </View>
  );
}

/** "Comentário oculto pela moderação." com o ícone `EyeOff`. */
export function HiddenCommentLine({
  text = 'Comentário oculto pela moderação.',
}: {
  text?: string;
}) {
  const name = useThemeName();
  return (
    <View
      className="flex-row items-center gap-1.5"
      accessible
      accessibilityLabel="Comentário oculto pela moderação"
    >
      <EyeOff size={14} color={color(name, 'mutedForeground')} aria-hidden />
      <Text className="flex-1 text-sm italic text-muted-foreground">{text}</Text>
    </View>
  );
}

/** Resposta pública do espaço: recuada, `bg-muted`, com a logo e a data. */
export function ReplyBlock({
  reply,
  spaceName,
  spaceLogoUrl,
  indent = true,
}: {
  reply: NonNullable<ReviewItemData['reply']>;
  spaceName: string;
  spaceLogoUrl: string | null;
  indent?: boolean;
}) {
  const when = relativeDate(reply.repliedAt);
  return (
    <View
      role="group"
      accessibilityLabel={`Resposta do ${spaceName}, ${when}: ${reply.body}`}
      className="gap-1 rounded-md bg-muted p-3"
      style={indent ? { marginLeft: ITEM.replyIndent } : undefined}
    >
      <View className="flex-row items-center gap-2" aria-hidden>
        <SpaceAvatar name={spaceName} logoUrl={spaceLogoUrl} size={ITEM.replyAvatarSize} />
        <Text numberOfLines={1} className="shrink text-sm font-semibold text-foreground">
          Resposta do {spaceName}
        </Text>
        <Text className="text-sm text-muted-foreground">· {when}</Text>
      </View>
      <ClampedText text={reply.body} />
    </View>
  );
}

/** Nota e data: "★★★★☆ · há 3 dias", com " · editada" depois da resposta do espaço. */
export function RatingDateLine({ review }: { review: ReviewItemData }) {
  const edited = editedAfterReply(review);
  return (
    <View
      className="flex-row items-center gap-1.5"
      accessible
      accessibilityLabel={[
        `${starsSpoken(review.rating)}, ${relativeDateSpoken(review.createdAt)}`,
        edited ? 'Editada depois da resposta do espaço' : null,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <StarRow value={review.rating} size="item" />
      <Text className="text-sm text-muted-foreground">
        · {relativeDate(review.createdAt)}
        {edited ? ' · editada' : ''}
      </Text>
    </View>
  );
}

export type ReviewMenuAction = 'report' | 'edit' | 'delete';

/**
 * Item de avaliação (bloco da página, lista "Ver todas"): autor, nota e data, etiquetas, comentário
 * (ou a linha de oculto) e a resposta do espaço. O menu `⋮` tem "Denunciar avaliação" para as dos
 * outros e "Editar"/"Excluir" para a minha (a minha: `id` igual a `eligibility.myReview.id`).
 */
export function ReviewItem({
  review,
  spaceName,
  spaceLogoUrl,
  mine = false,
  canEditMine = true,
  reported = false,
  highlighted = false,
  onAction,
}: {
  review: ReviewItemData;
  spaceName: string;
  spaceLogoUrl: string | null;
  mine?: boolean;
  canEditMine?: boolean;
  /** Denúncia enviada nesta tela (estado local; não vem da API). */
  reported?: boolean;
  highlighted?: boolean;
  onAction?: (action: ReviewMenuAction, review: ReviewItemData) => void;
}) {
  const name = useThemeName();
  // A ação roda depois que o menu fecha: no iOS, o Alert de excluir e a folha de denúncia não abrem
  // no mesmo toque em que outro Modal está fechando.
  const menu = useMenuSheet<ReviewMenuAction>((action) => onAction?.(action, review));
  const author = review.author;
  const removed = !author || author.name === REVIEW_REMOVED_AUTHOR_NAME;
  const authorName = author?.name ?? REVIEW_REMOVED_AUTHOR_NAME;
  const KindIcon = author?.kind === 'STUDENT' ? GraduationCap : LandPlot;

  return (
    <View
      testID={`avaliacao-item-${review.id}`}
      className={cn('flex-row py-4', highlighted && 'rounded-md bg-accent')}
      style={{ gap: ITEM.gap }}
    >
      {removed ? (
        <View
          className="items-center justify-center rounded-full bg-muted"
          style={{ width: ITEM.avatarSize, height: ITEM.avatarSize }}
          aria-hidden
        >
          <User size={18} color={color(name, 'mutedForeground')} />
        </View>
      ) : (
        <UserAvatar
          name={authorName}
          avatarUrl={author?.avatarUrl ?? null}
          size={ITEM.avatarSize}
          testID={`avaliacao-autor-${review.id}`}
        />
      )}
      <View className="flex-1 gap-2">
        <View className="flex-row items-start gap-2">
          <View className="flex-1 gap-0.5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text
                numberOfLines={1}
                className={cn(
                  'shrink text-sm',
                  removed ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground',
                )}
              >
                {authorName}
              </Text>
              {mine ? (
                <Badge variant="info" testID={`avaliacao-minha-${review.id}`}>
                  <Text>Sua avaliação</Text>
                </Badge>
              ) : null}
              {!removed && author ? (
                <Badge variant="muted" className="gap-1">
                  <KindIcon size={12} color={color(name, 'mutedForeground')} aria-hidden />
                  <Text>{author.kind === 'STUDENT' ? 'Aluno' : 'Jogou aqui'}</Text>
                </Badge>
              ) : null}
            </View>
            <RatingDateLine review={review} />
          </View>
          {onAction ? (
            <Pressable
              testID={`avaliacao-menu-${review.id}`}
              role="button"
              accessibilityLabel={`Mais opções da avaliação de ${authorName}`}
              onPress={menu.open}
              className="-mr-2 -mt-2 h-11 w-11 items-center justify-center rounded-full active:bg-accent"
            >
              <EllipsisVertical size={20} color={color(name, 'mutedForeground')} />
            </Pressable>
          ) : null}
        </View>
        <TagList tags={review.tags} />
        {review.commentHidden ? (
          <HiddenCommentLine />
        ) : review.comment ? (
          <ClampedText text={review.comment} testID={`avaliacao-comentario-${review.id}`} />
        ) : null}
        {review.reply ? (
          // A coluna do texto já começa no recuo de 48 (avatar 36 + 12).
          <View className="mt-1">
            <ReplyBlock
              reply={review.reply}
              spaceName={spaceName}
              spaceLogoUrl={spaceLogoUrl}
              indent={false}
            />
          </View>
        ) : null}
      </View>
      {/* Montada só quando aberta (ou fechando): a lista não carrega um Modal por item. */}
      {onAction && menu.mounted ? (
        <BottomSheet
          visible={menu.visible}
          title="Avaliação"
          onClose={menu.close}
          onDismissed={menu.onDismissed}
        >
          {mine ? (
            <>
              {canEditMine ? (
                <Button
                  testID={`avaliacao-editar-${review.id}`}
                  variant="outline"
                  onPress={() => menu.choose('edit')}
                >
                  <Text>Editar</Text>
                </Button>
              ) : null}
              <Button
                testID={`avaliacao-excluir-${review.id}`}
                variant="outline"
                className="border-destructive"
                onPress={() => menu.choose('delete')}
              >
                <Text className="text-destructive">Excluir</Text>
              </Button>
            </>
          ) : reported ? (
            <Button testID={`avaliacao-denunciada-${review.id}`} variant="outline" disabled>
              <Text>Denúncia enviada</Text>
            </Button>
          ) : (
            <Button
              testID={`avaliacao-denunciar-${review.id}`}
              variant="outline"
              onPress={() => menu.choose('report')}
            >
              <Text>Denunciar avaliação</Text>
            </Button>
          )}
        </BottomSheet>
      ) : null}
    </View>
  );
}

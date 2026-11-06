import {
  type MyReview,
  type PublicSpace,
  useDeleteMyReview,
  useGetReviewEligibility,
  useGetSpaceBySlug,
  useUpsertMyReview,
} from '@space-sports/api-client';
import {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_MAX_TAGS,
  REVIEW_TAG_LABELS,
  type ReviewTag,
  reviewTagsForRating,
} from '@space-sports/shared';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { CircleAlert, CircleCheck, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { SpaceAvatar } from '@/components/space-avatar';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { spaceLocationLabel } from '@/features/discovery/space-card';
import { isNotFound } from '@/lib/api-errors';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import {
  BLOCKED_TEXTS,
  cleanComment,
  isNotAllowed,
  READ_ONLY_NOTICE,
  ratingLabel,
  reviewMode,
  submitErrorMessage,
  toggleTag,
  visibleTags,
} from './format';
import { HiddenCommentLine, ReplyBlock, TagList } from './review-item';
import { StarInput, StarRow } from './stars';
import { useInvalidateReviews } from './use-reviews';

/** Aviso tingido no topo da tela (`info`, `success` ou `destructive`). */
export function Notice({
  tone,
  text: children,
  testID,
}: {
  tone: 'info' | 'success' | 'destructive';
  text: string;
  testID?: string;
}) {
  const box = {
    info: 'border-info-subtle-border bg-info-subtle',
    success: 'border-success-subtle-border bg-success-subtle',
    destructive: 'border-destructive-subtle-border bg-destructive-subtle',
  }[tone];
  const text = {
    info: 'text-info-subtle-foreground',
    success: 'text-success-subtle-foreground',
    destructive: 'text-destructive-subtle-foreground',
  }[tone];
  return (
    <View
      testID={testID}
      className={cn('rounded-md border p-3', box)}
      role={tone === 'destructive' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      <Text className={cn('text-sm font-medium', text)}>{children}</Text>
    </View>
  );
}

/** Confirmação da exclusão (o mesmo texto na tela, na lista e em Minhas avaliações). */
export function confirmDeleteReview(onConfirm: () => void) {
  Alert.alert(
    'Excluir sua avaliação?',
    'A nota sai da média do espaço. Para avaliar de novo, é preciso ter jogado ou feito aula aqui nos últimos 6 meses.',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: onConfirm },
    ],
  );
}

function SpaceHeading({ space }: { space: PublicSpace }) {
  return (
    <View className="flex-row items-center gap-3">
      <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={56} />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={2} className="text-lg font-semibold text-foreground">
          {space.name}
        </Text>
        <Text variant="muted">
          {spaceLocationLabel({
            neighborhood: space.address.neighborhood,
            city: space.address.city.name,
          })}
        </Text>
      </View>
    </View>
  );
}

type Done = { rating: number; edited: boolean };

/**
 * Tela de avaliar (RF-REVIEW-01; docs/05, "Avaliações (3)"), rota `espaco/[slug]/avaliar`: abre
 * pela página do espaço, pelo card da reserva ou aula, pelo push e pelo deep link. Cria, edita ou
 * mostra só leitura conforme `GET .../reviews/eligibility`.
 */
export function ReviewScreen() {
  const { slug, salva } = useLocalSearchParams<{ slug: string; salva?: string }>();
  const router = useRouter();
  const space = useGetSpaceBySlug(slug, { query: { staleTime: 60_000 } });
  const spaceId = space.data?.id ?? '';
  const eligibility = useGetReviewEligibility(spaceId, { query: { enabled: Boolean(spaceId) } });
  // 403 `REVIEW_NOT_ALLOWED` ao salvar uma edição: passa ao só leitura com o aviso.
  const [forcedReadOnly, setForcedReadOnly] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const data = eligibility.data;
  const mode = data ? (forcedReadOnly && data.myReview ? 'readOnly' : reviewMode(data)) : null;
  const title = mode === 'readOnly' ? 'Sua avaliação' : 'Avaliar';
  const openSpace = () => router.dismissTo({ pathname: '/espaco/[slug]', params: { slug } });

  let body: React.ReactNode;
  if (space.isPending || (spaceId && eligibility.isPending)) {
    body = <LoadingView />;
  } else if (space.isError || !space.data) {
    body = isNotFound(space.error) ? (
      <EmptyView title={BLOCKED_TEXTS.SPACE_NOT_FOUND.title} />
    ) : (
      <ErrorView error={space.error} onRetry={() => void space.refetch()} />
    );
  } else if (eligibility.isError || !data) {
    body = <ErrorView error={eligibility.error} onRetry={() => void eligibility.refetch()} />;
  } else if (done) {
    body = (
      <SuccessView
        space={space.data}
        done={done}
        onOpenSpace={() =>
          router.dismissTo({ pathname: '/espaco/[slug]', params: { slug, avaliacoes: '1' } })
        }
        onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
    );
  } else if (mode === 'blocked') {
    const text = BLOCKED_TEXTS[data.reason ?? 'REVIEW_NOT_ELIGIBLE'];
    body = (
      <View testID="avaliar-bloqueado">
        <EmptyView
          title={text.title}
          description={text.description}
          action={
            <Button variant="outline" onPress={openSpace}>
              <Text>Ver o espaço</Text>
            </Button>
          }
        />
      </View>
    );
  } else if (mode === 'readOnly' && data.myReview) {
    body = <ReadOnlyReview space={space.data} review={data.myReview} slug={slug} />;
  } else {
    body = (
      <ReviewForm
        key={data.myReview?.id ?? 'new'}
        space={space.data}
        slug={slug}
        review={data.myReview}
        savedFromCard={salva === '1'}
        onDone={setDone}
        onNotAllowed={() => setForcedReadOnly(true)}
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <ScreenHeader title={title} testID="avaliar-titulo" />
      {body}
    </SafeAreaView>
  );
}

function ReviewForm({
  space,
  slug,
  review,
  savedFromCard,
  onDone,
  onNotAllowed,
}: {
  space: PublicSpace;
  slug: string;
  review: MyReview | null;
  savedFromCard: boolean;
  onDone: (done: Done) => void;
  onNotAllowed: () => void;
}) {
  const name = useThemeName();
  const router = useRouter();
  const invalidate = useInvalidateReviews();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const initial = useRef({
    rating: review?.rating ?? null,
    tags: [...(review?.tags ?? [])] as ReviewTag[],
    comment: review?.comment ?? '',
  });
  const [rating, setRating] = useState<number | null>(initial.current.rating);
  const [picked, setPicked] = useState<ReviewTag[]>(initial.current.tags);
  const [comment, setComment] = useState(initial.current.comment);
  const [missingRating, setMissingRating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);
  const spokenLength = useDebouncedValue(comment.length, 800);

  const upsert = useUpsertMyReview();
  const remove = useDeleteMyReview();
  const busy = upsert.isPending || remove.isPending;
  const shown = visibleTags(rating, picked);
  const dirty =
    rating !== initial.current.rating ||
    comment !== initial.current.comment ||
    shown.join() !== visibleTags(initial.current.rating, initial.current.tags).join();

  // Sair com alterações não enviadas: confirma (voltar do cabeçalho e do sistema).
  const allowLeave = usePreventRemove(dirty && !leaving.current, ({ repeat }) => {
    Alert.alert('Descartar a avaliação?', 'O que você escolheu não será enviado.', [
      { text: 'Continuar avaliando', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: () => {
          leaving.current = true;
          allowLeave();
          repeat();
        },
      },
    ]);
  });

  const submit = () => {
    if (rating === null) {
      setMissingRating(true);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setError(null);
    upsert.mutate(
      {
        spaceId: space.id,
        data: { rating, tags: visibleTags(rating, picked), comment: cleanComment(comment) },
      },
      {
        onSuccess: () => {
          leaving.current = true;
          void invalidate(space.id, slug);
          onDone({ rating, edited: Boolean(review) });
        },
        onError: (err) => {
          if (review && isNotAllowed(err)) {
            void invalidate(space.id, slug);
            onNotAllowed();
            return;
          }
          setError(submitErrorMessage(err));
        },
      },
    );
  };

  const deleteReview = () =>
    confirmDeleteReview(() => {
      setError(null);
      remove.mutate(
        { spaceId: space.id },
        {
          onSuccess: () => {
            leaving.current = true;
            allowLeave();
            void invalidate(space.id, slug);
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: '/espaco/[slug]', params: { slug } });
          },
          onError: () => setError('Não foi possível excluir agora. Tente de novo.'),
        },
      );
    });

  const atLimit = shown.length >= REVIEW_MAX_TAGS;
  const nearLimit = comment.length >= 450;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerClassName="gap-6 px-4 pb-8 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        {review?.commentHidden ? (
          <Notice
            tone="info"
            testID="avaliar-aviso-oculto"
            text={
              'Seu comentário está oculto pela moderação e não aparece para os outros. Editar o texto não o reexibe.'
            }
          />
        ) : null}
        {savedFromCard ? (
          <Notice
            tone="success"
            testID="avaliar-nota-salva"
            text={'Nota salva. Quer contar mais?'}
          />
        ) : null}
        <SpaceHeading space={space} />

        <View className="gap-4">
          <Text className="font-display-semibold text-xl text-foreground" role="heading">
            Como foi sua experiência?
          </Text>
          <View className="gap-2">
            <StarInput
              value={rating}
              size="input"
              label="Nota"
              disabled={busy}
              testIDPrefix="avaliar-estrela"
              onChange={(value) => {
                setRating(value);
                setMissingRating(false);
              }}
            />
            {rating === null ? (
              <Text className="text-center text-base text-muted-foreground">
                Toque para dar a nota
              </Text>
            ) : (
              <Text
                testID="avaliar-rotulo-nota"
                accessibilityLiveRegion="polite"
                className="text-center text-lg font-semibold text-foreground"
              >
                {ratingLabel(rating)}
              </Text>
            )}
            {missingRating ? (
              <View
                className="flex-row items-center justify-center gap-1.5"
                accessibilityLiveRegion="polite"
                testID="avaliar-erro-nota"
              >
                <CircleAlert size={16} color={color(name, 'inputErrorForeground')} aria-hidden />
                <Text className="text-sm font-medium text-input-error-foreground">
                  Escolha de 1 a 5 estrelas
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            O que se destacou?<Text className="font-normal text-muted-foreground"> (opcional)</Text>
          </Text>
          <Text className="text-sm text-muted-foreground" testID="avaliar-dica-chips">
            {rating === null
              ? 'Dê a nota para ver as opções'
              : atLimit
                ? `Você escolheu ${REVIEW_MAX_TAGS} de ${REVIEW_MAX_TAGS}`
                : `Escolha até ${REVIEW_MAX_TAGS}`}
          </Text>
          {rating !== null ? (
            <View className="flex-row flex-wrap gap-2">
              {reviewTagsForRating(rating).map((tag) => {
                const selected = shown.includes(tag);
                return (
                  <Chip
                    key={tag}
                    testID={`avaliar-chip-${tag}`}
                    role="checkbox"
                    aria-checked={selected}
                    selected={selected}
                    disabled={busy || (!selected && atLimit)}
                    onPress={() =>
                      setPicked((list) => toggleTag(list, tag, rating, REVIEW_MAX_TAGS))
                    }
                  >
                    <Text>{REVIEW_TAG_LABELS[tag]}</Text>
                  </Chip>
                );
              })}
            </View>
          ) : null}
        </View>

        <View className="gap-1.5">
          <Text variant="small">
            Comentário
            <Text className="font-normal text-muted-foreground"> (opcional)</Text>
          </Text>
          <Input
            testID="avaliar-comentario"
            accessibilityLabel="Comentário (opcional)"
            value={comment}
            onChangeText={setComment}
            placeholder="Conte como foi o jogo ou a aula"
            multiline
            maxLength={REVIEW_COMMENT_MAX_LENGTH}
            textAlignVertical="top"
            editable={!busy}
            className="h-auto py-3"
            style={{ minHeight: 120, maxHeight: 200 }}
          />
          <View className="flex-row justify-between gap-2">
            <Text className="flex-1 text-sm text-muted-foreground">
              Aparece com seu primeiro nome.
            </Text>
            <Text
              testID="avaliar-contador"
              accessibilityLabel={`${spokenLength} de ${REVIEW_COMMENT_MAX_LENGTH} caracteres`}
              className={cn(
                'text-sm tabular-nums',
                nearLimit ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {comment.length}/{REVIEW_COMMENT_MAX_LENGTH}
            </Text>
          </View>
        </View>

        {review ? (
          <Button
            testID="avaliar-excluir"
            variant="ghost"
            className="flex-row gap-2 self-start"
            disabled={busy}
            onPress={deleteReview}
          >
            <Trash2 size={18} color={color(name, 'destructive')} aria-hidden />
            <Text className="text-destructive">Excluir avaliação</Text>
          </Button>
        ) : null}
      </ScrollView>
      <View className="gap-3 border-t border-border bg-background p-4">
        {error ? <Notice tone="destructive" testID="avaliar-erro" text={error} /> : null}
        <Button testID="avaliar-enviar" disabled={busy} onPress={submit} className="flex-row gap-2">
          {upsert.isPending ? (
            <ActivityIndicator size="small" color={color(name, 'primaryForeground')} />
          ) : null}
          <Text>
            {upsert.isPending
              ? review
                ? 'Salvando…'
                : 'Enviando…'
              : review
                ? 'Salvar alterações'
                : 'Enviar avaliação'}
          </Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Só leitura: a pessoa está na equipe ativa do espaço (RN-REVIEW-01); só excluir. */
function ReadOnlyReview({
  space,
  review,
  slug,
}: {
  space: PublicSpace;
  review: MyReview;
  slug: string;
}) {
  const name = useThemeName();
  const router = useRouter();
  const invalidate = useInvalidateReviews();
  const remove = useDeleteMyReview();
  const [error, setError] = useState<string | null>(null);

  const deleteReview = () =>
    confirmDeleteReview(() => {
      setError(null);
      remove.mutate(
        { spaceId: space.id },
        {
          onSuccess: () => {
            void invalidate(space.id, slug);
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: '/espaco/[slug]', params: { slug } });
          },
          onError: () => setError('Não foi possível excluir agora. Tente de novo.'),
        },
      );
    });

  return (
    <View className="flex-1" testID="avaliar-so-leitura">
      <ScrollView contentContainerClassName="gap-5 px-4 pb-8 pt-2">
        <Notice tone="info" text={READ_ONLY_NOTICE} />
        <SpaceHeading space={space} />
        <View
          className="flex-row items-center gap-2"
          accessible
          accessibilityLabel={`${review.rating} de 5 estrelas, ${ratingLabel(review.rating)}`}
        >
          <StarRow value={review.rating} size="summary" />
          <Text className="text-base font-semibold text-foreground">
            {ratingLabel(review.rating)}
          </Text>
        </View>
        <TagList tags={review.tags} />
        {review.commentHidden ? <HiddenCommentLine /> : null}
        {review.comment ? (
          <Text className={cn('text-base', review.commentHidden ? 'text-muted-foreground' : '')}>
            {review.comment}
          </Text>
        ) : null}
        {review.reply ? (
          <ReplyBlock
            reply={review.reply}
            spaceName={space.name}
            spaceLogoUrl={space.logoUrl}
            indent={false}
          />
        ) : null}
      </ScrollView>
      <View className="gap-3 border-t border-border bg-background p-4">
        {error ? <Notice tone="destructive" text={error} /> : null}
        <Button
          testID="avaliar-excluir"
          variant="outline"
          className="flex-row gap-2 border-destructive"
          disabled={remove.isPending}
          onPress={deleteReview}
        >
          <Trash2 size={18} color={color(name, 'destructive')} aria-hidden />
          <Text className="text-destructive">
            {remove.isPending ? 'Excluindo…' : 'Excluir avaliação'}
          </Text>
        </Button>
      </View>
    </View>
  );
}

function SuccessView({
  space,
  done,
  onOpenSpace,
  onClose,
}: {
  space: PublicSpace;
  done: Done;
  onOpenSpace: () => void;
  onClose: () => void;
}) {
  const name = useThemeName();
  return (
    <View
      testID="avaliar-sucesso"
      className="flex-1 items-center gap-3 px-4 pt-12"
      accessibilityLiveRegion="polite"
    >
      <View className="h-20 w-20 items-center justify-center rounded-full bg-success-subtle">
        <CircleCheck size={48} color={color(name, 'successSubtleForeground')} aria-hidden />
      </View>
      <View accessible accessibilityLabel={`${done.rating} de 5 estrelas`}>
        <StarRow value={done.rating} size="summary" />
      </View>
      <Text variant="h3" className="text-center" role="heading">
        {done.edited ? 'Avaliação atualizada' : 'Obrigado pela avaliação!'}
      </Text>
      <Text className="text-center text-muted-foreground">
        Ela já aparece na página do {space.name}.
      </Text>
      <View className="w-full gap-2 pt-4">
        <Button testID="avaliar-ver-no-espaco" onPress={onOpenSpace}>
          <Text>Ver no espaço</Text>
        </Button>
        <Button variant="ghost" onPress={onClose}>
          <Text>Fechar</Text>
        </Button>
      </View>
    </View>
  );
}

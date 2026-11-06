import {
  type CreateBookingDto,
  createBooking,
  getGetMyBookingPaymentQueryKey,
  isApiError,
  type PaymentMethod,
  type PaymentOption,
  type PlayerBookingDetailDto,
  useGetSpaceAvailability,
  useGetSpaceBySlug,
} from '@space-sports/api-client';
import {
  BOOKING_PAYMENT_HOLD_MIN,
  calculateBookingPriceCents,
  formatCents,
} from '@space-sports/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { ChipRow, Step } from '@/features/booking/section';
import { clampPeople, defaultPeople, durationOptions, timeOptions } from '@/features/booking/slots';
import { Stepper } from '@/features/booking/stepper';
import { tokenizeCard } from '@/features/payments/card-form';
import { CardFormView } from '@/features/payments/components/card-form-view';
import { PaymentMethodOptions } from '@/features/payments/components/payment-method-options';
import { isSandbox, SandboxBadge } from '@/features/payments/components/sandbox-badge';
import { holdMinutes } from '@/features/payments/countdown';
import {
  idempotencyHeaders,
  isUnknownOutcome,
  newIdempotencyKey,
  retryUnknownOutcome,
} from '@/features/payments/idempotency';
import { bookingPaymentChoices, defaultPaymentOption } from '@/features/payments/options';
import { PAYMENT_METHOD_LABELS } from '@/features/space/labels';
import { errorMessage, isSlotUnavailable } from '@/lib/api-errors';
import {
  bookingDates,
  formatBookingWhen,
  formatDayCompact,
  formatDayShort,
  formatDuration,
  formatTime,
} from '@/lib/datetime';
import { testIdPart } from '@/lib/test-ids';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';

/** O espaço mudou o modo no meio do caminho (docs/05, "App — (1)", Erros). */
const UNANSWERED_MESSAGE =
  'Não tivemos resposta. A reserva pode ter sido criada: tente de novo com o mesmo pedido (não duplica) ou confira em Minhas reservas.';

const MODE_CHANGED_CODES = new Set([
  'ONLINE_PAYMENT_UNAVAILABLE',
  'ONLINE_PAYMENTS_DISABLED',
  'ONLINE_PAYMENT_REQUIRED',
]);

interface CreateVariables {
  data: CreateBookingDto;
  key: string;
}

/**
 * Reserva avulsa (RF-BOOK-01/02, RN-BOOK-01..07): esporte → data → duração → horário → quadra →
 * pessoas → pagamento → confirmar. Sem pagamento online, nasce confirmada e paga no local. Com o
 * modo do espaço permitindo (RF-ONPAY-03, RN-ONPAY-02), a etapa "Como você quer pagar?" oferece
 * Pix, cartão e (no opcional) "No local"; no obrigatório a reserva nasce aguardando pagamento e o
 * app segue direto para a tela de pagar.
 */
export default function ReservarScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const spaceQuery = useGetSpaceBySlug(slug, { query: { staleTime: 60_000 } });
  const space = spaceQuery.data;

  const [sportId, setSportId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [people, setPeople] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [option, setOption] = useState<PaymentOption | null>(null);
  const [stage, setStage] = useState<'form' | 'card'>('form');
  const [notice, setNotice] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  // `Idempotency-Key` ligada ao pedido (decisão 96): a mesma enquanto o corpo da tentativa for o
  // mesmo; horário, quadra, duração, pessoas ou forma diferentes geram outra (a API recusa a mesma
  // chave com outro pedido: 422 IDEMPOTENCY_KEY_REUSED). Depois de um resultado desconhecido, o
  // "Tentar de novo" reenvia o mesmo pedido com a mesma chave (a reserva pode ter sido criada).
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [unanswered, setUnanswered] = useState<CreateVariables | null>(null);

  // Padrões assim que o espaço chega: único esporte, hoje e a duração mínima.
  const dates = useMemo(() => (space ? bookingDates(space.rental.windowDays) : []), [space]);
  const effectiveSport =
    sportId ?? (space?.sports.length === 1 ? (space.sports[0]?.slug ?? null) : null);
  const sport = space?.sports.find((s) => s.slug === effectiveSport) ?? null;
  const sportCatalogId = space?.courts
    .flatMap((c) => c.sports)
    .find((s) => s.slug === sport?.slug)?.sportId;
  const effectiveDate = date ?? dates[0] ?? null;
  const effectiveDuration = durationMin ?? space?.rental.minDurationMin ?? null;

  const availability = useGetSpaceAvailability(
    space?.id ?? '',
    {
      date: effectiveDate ?? '',
      durationMin: effectiveDuration ?? 0,
      sportId: sportCatalogId ?? '',
    },
    {
      query: {
        enabled: Boolean(space && effectiveDate && effectiveDuration && sportCatalogId),
        staleTime: 15_000,
      },
    },
  );

  const options = useMemo(
    () => (availability.data ? timeOptions(availability.data) : []),
    [availability.data],
  );
  const chosen = options.find((o) => o.startsAt === startsAt) ?? null;
  const court = chosen?.courts.find((c) => c.id === courtId) ?? null;
  const timeZone = availability.data?.timeZone;

  // Se a quadra escolhida deixou de ter o horário (atualização da grade), pede nova escolha.
  useEffect(() => {
    if (startsAt && !chosen) {
      setStartsAt(null);
      setCourtId(null);
    }
  }, [startsAt, chosen]);

  const goToBooking = (booking: PlayerBookingDetailDto, chosen: PaymentOption) => {
    void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
    void queryClient.invalidateQueries({ queryKey: [`/v1/spaces/${space?.id}/availability`] });
    if (booking.onlinePayment) {
      queryClient.setQueryData(getGetMyBookingPaymentQueryKey(booking.id), booking.onlinePayment);
    }
    const pay =
      chosen === 'ONLINE_PIX'
        ? { pagar: 'pix' }
        : chosen === 'ONLINE_CARD'
          ? {
              pagar: 'cartao',
              ...(booking.onlinePayment ? { cobranca: booking.onlinePayment.id } : { falha: '1' }),
            }
          : {};
    // A pilha vira reserva → pagamento: voltar do pagamento cai no detalhe, nunca no formulário.
    router.replace({ pathname: '/reserva/[id]', params: { id: booking.id, nova: '1', ...pay } });
  };

  const create = useMutation({
    mutationFn: ({ data, key }: CreateVariables) => createBooking(data, idempotencyHeaders(key)),
    retry: retryUnknownOutcome,
    retryDelay: 1500,
    onSuccess: (booking, { data }) => {
      attempt.current = null;
      setUnanswered(null);
      goToBooking(booking, data.paymentOption ?? 'ON_SITE');
    },
    onError: (error, variables) => {
      if (isUnknownOutcome(error)) {
        // Sem resposta: guarda o pedido e a chave para o "Tentar de novo".
        setUnanswered(variables);
        if (stage === 'card') setCardError(UNANSWERED_MESSAGE);
        else setNotice(UNANSWERED_MESSAGE);
        return;
      }
      // Resposta definitiva: nada foi criado com esta chave; o próximo toque gera outra.
      attempt.current = null;
      setUnanswered(null);
      if (isApiError(error) && error.code === 'IDEMPOTENCY_KEY_REUSED') {
        void queryClient.invalidateQueries({ queryKey: ['/v1/bookings'] });
        setStage('form');
        setNotice(errorMessage(error));
        return;
      }
      if (
        isSlotUnavailable(error) ||
        (isApiError(error) && error.code === 'BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT')
      ) {
        // Outra pessoa levou o horário (ou não dá tempo de pagar): volta à escolha com a grade atualizada.
        setStartsAt(null);
        setCourtId(null);
        setStage('form');
        void availability.refetch();
        setNotice(errorMessage(error));
        return;
      }
      if (isApiError(error) && MODE_CHANGED_CODES.has(error.code)) {
        // O espaço mudou o modo: as opções recarregam.
        setOption(null);
        setStage('form');
        void spaceQuery.refetch();
        setNotice(
          error.code === 'ONLINE_PAYMENT_REQUIRED'
            ? errorMessage(error)
            : 'Este espaço não aceita mais pagamento pelo app. Escolha outra forma.',
        );
        return;
      }
      if (stage === 'card') {
        setCardError(errorMessage(error));
        return;
      }
      setNotice(errorMessage(error));
    },
  });

  // Na etapa do cartão, o voltar do sistema volta ao formulário (e espera a resposta do envio).
  useEffect(() => {
    if (stage !== 'card') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!create.isPending) setStage('form');
      return true;
    });
    return () => sub.remove();
  }, [stage, create.isPending]);

  if (spaceQuery.isPending)
    return (
      <Shell>
        <LoadingView />
      </Shell>
    );
  if (spaceQuery.isError || !space) {
    return (
      <Shell>
        <ErrorView error={spaceQuery.error} onRetry={() => void spaceQuery.refetch()} />
      </Shell>
    );
  }
  if (space.courts.length === 0 || space.sports.length === 0) {
    return (
      <Shell>
        <EmptyView
          title="Sem quadras disponíveis"
          description="Este espaço ainda não abriu reservas."
        />
      </Shell>
    );
  }

  const durations = durationOptions(space.rental.minDurationMin, space.rental.maxDurationMin);
  const peopleCount = court
    ? clampPeople(people ?? defaultPeople(court.maxPlayers), court.maxPlayers)
    : null;
  const priceCents = effectiveDuration
    ? calculateBookingPriceCents(space.rental.pricePerHourCents, effectiveDuration)
    : 0;
  const canConfirm = Boolean(chosen && court && peopleCount && sportCatalogId && !create.isPending);
  const choices = bookingPaymentChoices(space, priceCents);
  const selected: PaymentOption =
    option && choices.options.includes(option)
      ? option
      : (defaultPaymentOption(choices.options) ?? 'ON_SITE');
  const online = choices.online && selected !== 'ON_SITE';
  const required = choices.mode === 'ONLINE_REQUIRED';

  const send = (paymentOption: PaymentOption, cardToken?: string) => {
    if (!(chosen && court && peopleCount && sportCatalogId && effectiveDuration)) return;
    const data: CreateBookingDto = {
      spaceId: space.id,
      courtId: court.id,
      sportId: sportCatalogId,
      startsAt: chosen.startsAt,
      durationMin: effectiveDuration,
      peopleCount,
      ...(paymentOption === 'ON_SITE' && method ? { intendedPaymentMethod: method } : {}),
      ...(choices.online ? { paymentOption } : {}),
      ...(cardToken ? { cardToken } : {}),
    };
    // O token do cartão não entra (como na API: cada tokenização gera outro).
    const { cardToken: _token, ...request } = data;
    const signature = JSON.stringify(request);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newIdempotencyKey() };
    }
    setUnanswered(null);
    create.mutate({ key: attempt.current.key, data });
  };

  /** Reenvia o pedido sem resposta, igual e com a mesma chave (não duplica a reserva). */
  const retryUnanswered = () => {
    if (!unanswered) return;
    setNotice(null);
    setCardError(null);
    create.mutate(unanswered);
  };

  const confirm = () => {
    setNotice(null);
    setCardError(null);
    if (choices.online && selected === 'ONLINE_CARD') {
      // O cartão é preenchido antes: a reserva nasce junto com o token, no primeiro envio.
      setStage('card');
      return;
    }
    send(choices.online ? selected : 'ON_SITE');
  };

  const confirmLabel = create.isPending
    ? 'Reservando…'
    : !online
      ? 'Confirmar reserva'
      : selected === 'ONLINE_PIX'
        ? required
          ? 'Reservar e pagar com Pix'
          : 'Pagar com Pix'
        : required
          ? 'Reservar e pagar com cartão'
          : 'Pagar com cartão';

  const resetSlot = () => {
    setStartsAt(null);
    setCourtId(null);
    setNotice(null);
    attempt.current = null;
    setUnanswered(null);
  };

  if (stage === 'card' && chosen && court && peopleCount) {
    return (
      <Shell
        title="Pagar com cartão"
        onBack={() => {
          if (!create.isPending) setStage('form');
        }}
        right={isSandbox(space.paymentEnvironment) ? <SandboxBadge /> : undefined}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerClassName="gap-4 px-4 pb-10"
            keyboardShouldPersistTaps="handled"
          >
            <View className="gap-1 pt-2">
              <Text variant="overline">Valor</Text>
              <Text
                testID="reservar-cartao-valor"
                className="font-display-bold text-4xl tabular-nums"
              >
                {formatCents(priceCents)}
              </Text>
              <Text variant="muted">Reserva · {space.name}</Text>
              <Text variant="muted" className="tabular-nums">
                {formatBookingWhen(chosen.startsAt, chosen.endsAt, timeZone)}
              </Text>
            </View>
            {unanswered ? (
              <Button
                testID="reservar-tentar-de-novo"
                variant="outline"
                disabled={create.isPending}
                onPress={retryUnanswered}
              >
                <Text>Tentar de novo com o mesmo cartão</Text>
              </Button>
            ) : null}
            <CardFormView
              amountCents={priceCents}
              environment={space.paymentEnvironment}
              processing={create.isPending}
              decline={null}
              error={cardError}
              onSubmit={(values) => {
                setCardError(null);
                const result = tokenizeCard(values, space.paymentEnvironment);
                if (!result.ok) {
                  setCardError(
                    result.reason === 'unavailable'
                      ? 'O pagamento com cartão está indisponível agora. Use o Pix ou pague no espaço.'
                      : 'Confira o número do cartão',
                  );
                  return;
                }
                send('ONLINE_CARD', result.token);
              }}
              onPayWithPix={
                choices.options.includes('ONLINE_PIX')
                  ? () => {
                      setOption('ONLINE_PIX');
                      setStage('form');
                    }
                  : undefined
              }
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Shell>
    );
  }

  return (
    <Shell title={`Reservar · ${space.name}`}>
      <ScrollView contentContainerClassName="gap-6 p-4 pb-8" keyboardShouldPersistTaps="handled">
        {space.sports.length > 1 ? (
          <Step title="Esporte">
            <ChipRow label="Esporte">
              {space.sports.map((s) => (
                <Chip
                  key={s.slug}
                  testID={`reservar-esporte-${s.slug}`}
                  selected={effectiveSport === s.slug}
                  onPress={() => {
                    setSportId(s.slug);
                    resetSlot();
                  }}
                >
                  <Text>{s.name}</Text>
                </Chip>
              ))}
            </ChipRow>
          </Step>
        ) : null}

        {sport ? (
          <>
            <Step title="Data">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2"
              >
                {dates.map((d) => (
                  <Chip
                    key={d}
                    testID={`reservar-data-${d}`}
                    selected={effectiveDate === d}
                    accessibilityLabel={formatDayShort(d)}
                    onPress={() => {
                      setDate(d);
                      resetSlot();
                    }}
                  >
                    <Text>{d === dates[0] ? 'Hoje' : formatDayCompact(d)}</Text>
                  </Chip>
                ))}
              </ScrollView>
            </Step>

            <Step title="Duração">
              <ChipRow label="Duração">
                {durations.map((d) => (
                  <Chip
                    key={d}
                    testID={`reservar-duracao-${d}`}
                    selected={effectiveDuration === d}
                    onPress={() => {
                      setDurationMin(d);
                      resetSlot();
                    }}
                  >
                    <Text>{formatDuration(d)}</Text>
                  </Chip>
                ))}
              </ChipRow>
            </Step>

            <Step title="Horário">
              {availability.isPending && availability.fetchStatus !== 'idle' ? (
                <LoadingView label="Buscando horários…" />
              ) : availability.isError ? (
                <ErrorView error={availability.error} onRetry={() => void availability.refetch()} />
              ) : options.length === 0 ? (
                <Text variant="muted">
                  Nenhum horário livre neste dia para {formatDuration(effectiveDuration ?? 0)}.
                  Tente outra data ou duração.
                </Text>
              ) : (
                <ChipRow label="Horário">
                  {options.map((o) => (
                    <Chip
                      key={o.startsAt}
                      shape="slot"
                      testID={`reservar-horario-${formatTime(o.startsAt, timeZone)}`}
                      selected={startsAt === o.startsAt}
                      onPress={() => {
                        setStartsAt(o.startsAt);
                        setCourtId(o.courts.length === 1 ? (o.courts[0]?.id ?? null) : null);
                        setNotice(null);
                      }}
                    >
                      <Text className="tabular-nums">{formatTime(o.startsAt, timeZone)}</Text>
                    </Chip>
                  ))}
                </ChipRow>
              )}
            </Step>
          </>
        ) : (
          <Text variant="muted">Escolha o esporte para ver os horários.</Text>
        )}

        {chosen ? (
          <Step title="Quadra">
            <ChipRow label="Quadra">
              {chosen.courts.map((c) => (
                <Chip
                  key={c.id}
                  testID={`reservar-quadra-${testIdPart(c.name)}`}
                  selected={courtId === c.id}
                  onPress={() => {
                    setCourtId(c.id);
                    setPeople((p) => clampPeople(p ?? defaultPeople(c.maxPlayers), c.maxPlayers));
                  }}
                >
                  <Text>
                    {c.name} · {c.covered ? 'coberta' : 'descoberta'}
                  </Text>
                </Chip>
              ))}
            </ChipRow>
          </Step>
        ) : null}

        {court && peopleCount ? (
          <>
            <Step title={`Quantas pessoas? (até ${court.maxPlayers})`}>
              <Stepper
                testID="reservar-pessoas"
                label="Número de pessoas"
                value={peopleCount}
                min={1}
                max={court.maxPlayers}
                onChange={setPeople}
              />
            </Step>
            {choices.online ? (
              <Step
                title="Como você quer pagar?"
                right={isSandbox(space.paymentEnvironment) ? <SandboxBadge /> : undefined}
              >
                {required && chosen ? <RequiredNotice startsAt={chosen.startsAt} /> : null}
                <PaymentMethodOptions
                  testIDPrefix="reservar-forma"
                  options={choices.options}
                  value={selected}
                  onChange={(next) => {
                    setOption(next);
                    setNotice(null);
                  }}
                  onSiteExtra={
                    space.acceptedPaymentMethods.length > 0 ? (
                      <>
                        <ChipRow label="Forma de pagamento no local">
                          {space.acceptedPaymentMethods.map((m) => (
                            <Chip
                              key={m}
                              testID={`reservar-pagamento-${m}`}
                              selected={method === m}
                              onPress={() => setMethod(method === m ? null : m)}
                            >
                              <Text>{PAYMENT_METHOD_LABELS[m]}</Text>
                            </Chip>
                          ))}
                        </ChipRow>
                        <Text variant="muted">Só para o espaço se preparar.</Text>
                      </>
                    ) : undefined
                  }
                />
              </Step>
            ) : space.acceptedPaymentMethods.length > 0 ? (
              <Step title="Como você vai pagar no espaço?">
                <ChipRow label="Forma de pagamento">
                  {space.acceptedPaymentMethods.map((m) => (
                    <Chip
                      key={m}
                      testID={`reservar-pagamento-${m}`}
                      selected={method === m}
                      onPress={() => setMethod(method === m ? null : m)}
                    >
                      <Text>{PAYMENT_METHOD_LABELS[m]}</Text>
                    </Chip>
                  ))}
                </ChipRow>
                <Text variant="muted">
                  Só para o espaço se preparar. O pagamento é feito no local.
                </Text>
              </Step>
            ) : null}
            <Card testID="reservar-resumo">
              <Text variant="small">Resumo</Text>
              <Text>
                {formatBookingWhen(chosen?.startsAt ?? '', chosen?.endsAt ?? '', timeZone)}
              </Text>
              <Text variant="muted">
                {court.name} · {sport?.name} · {peopleCount}{' '}
                {peopleCount === 1 ? 'pessoa' : 'pessoas'}
              </Text>
              <View className="flex-row items-center justify-between">
                <Text variant="muted">Total ({formatDuration(effectiveDuration ?? 0)})</Text>
                <Text variant="large" className="tabular-nums" testID="reservar-total">
                  {formatCents(priceCents)}
                </Text>
              </View>
              {online ? (
                <>
                  <Text variant="muted">Sem taxa extra no app.</Text>
                  <Text variant="muted">
                    Cancelando até {formatDuration(space.rental.cancellationDeadlineMin)} antes, o
                    valor volta inteiro para você.
                  </Text>
                </>
              ) : (
                <Text variant="muted">
                  Cancelamento sem custo até {formatDuration(space.rental.cancellationDeadlineMin)}{' '}
                  antes.
                </Text>
              )}
            </Card>
          </>
        ) : null}

        <InlineError message={notice} />
        {unanswered ? (
          <Button
            testID="reservar-tentar-de-novo"
            variant="outline"
            disabled={create.isPending}
            onPress={retryUnanswered}
          >
            <Text>Tentar de novo</Text>
          </Button>
        ) : null}
        <Button testID="reservar-confirmar" size="lg" disabled={!canConfirm} onPress={confirm}>
          <Text>{confirmLabel}</Text>
        </Button>
      </ScrollView>
    </Shell>
  );
}

function RequiredNotice({ startsAt }: { startsAt: string }) {
  const name = useThemeName();
  const minutes = holdMinutes(startsAt);
  return (
    <View
      testID="reservar-pagamento-obrigatorio"
      className="flex-row gap-2 rounded-md border border-info-subtle-border bg-info-subtle p-3"
    >
      <Info size={16} color={color(name, 'infoSubtleForeground')} aria-hidden />
      <Text className="flex-1 text-sm text-info-subtle-foreground">
        Este espaço pede o pagamento na reserva. O horário fica guardado por{' '}
        {minutes < BOOKING_PAYMENT_HOLD_MIN ? `${minutes} min (até o início)` : `${minutes} min`}{' '}
        enquanto você paga.
      </Text>
    </View>
  );
}

function Shell({
  title = 'Reservar',
  onBack,
  right,
  children,
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title={title} testID="reservar-titulo" onBack={onBack} right={right} />
      {children}
    </SafeAreaView>
  );
}

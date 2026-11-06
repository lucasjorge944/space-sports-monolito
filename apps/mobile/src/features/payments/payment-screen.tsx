import { isApiError, type PlayerOnlineCharge, useGetMyPayment } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { paymentLayout } from '@space-sports/ui-tokens';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  TimerOff,
  Undo2,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatTime } from '@/lib/datetime';
import { color, monoFontFamily } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { type CardFormValues, canTokenizeCard, tokenizeCard } from './card-form';
import {
  type ChargeView,
  deriveChargeView,
  type LateRefundReason,
  needsNewPix,
  needsRefundReasons,
} from './charge-state';
import { CardFormView, type DeclineNotice } from './components/card-form-view';
import { CountdownCard } from './components/countdown-card';
import { PixQr, PixQrSkeleton } from './components/pix-qr';
import { ResultState } from './components/result-state';
import { isSandbox, SandboxBadge } from './components/sandbox-badge';
import { countdownA11yLabel, formatClock, isUrgent } from './countdown';
import { isUnknownOutcome, newIdempotencyKey } from './idempotency';
import { methodShortLabel } from './labels';
import type { Payable } from './payable';
import { useCountdown } from './use-countdown';
import { useCreateCharge, useOnlineCharge } from './use-online-charge';
import { ONLINE_OFF_MESSAGE } from './use-pay-action';
import { type PayableContext, usePayableContext } from './use-payable-context';

type Mode = 'pix' | 'card';

const GATEWAY_CODES_OFF = new Set([
  'ONLINE_PAYMENT_UNAVAILABLE',
  'ONLINE_PAYMENTS_DISABLED',
  'NOT_PAYABLE_ONLINE',
]);

/** `details.chargeId` do 502 com a criação pendente de verificação (RN-ONPAY-07). */
export function pendingVerificationChargeId(error: unknown): string | null {
  if (!isApiError(error) || error.code !== 'PAYMENT_GATEWAY_UNAVAILABLE') return null;
  const details = error.details as Record<string, unknown> | null;
  if (details?.verification !== 'PENDING') return null;
  return typeof details.chargeId === 'string' ? details.chargeId : null;
}

/** Título do "pago e estornado sozinho" pelo `reasonCode` do estorno (decisão 96). */
export function lateRefundTitle(
  reason: LateRefundReason | null,
  bookingCancelled: boolean,
): string {
  return reason === 'PAID_AFTER_DEADLINE' && bookingCancelled
    ? 'O pagamento chegou depois do prazo'
    : 'Este pagamento chegou atrasado';
}

/** O porquê do estorno automático, pelo `reasonCode`. */
export function lateRefundCause(
  reason: LateRefundReason | null,
  bookingCancelled: boolean,
): string {
  switch (reason) {
    case 'PAID_AFTER_DEADLINE':
      return bookingCancelled
        ? 'A reserva já tinha sido cancelada.'
        : 'O prazo para pagar já tinha acabado.';
    case 'PAID_AFTER_METHOD_CHANGE':
      return 'Você já tinha trocado de forma de pagamento.';
    case 'ITEM_ALREADY_PAID':
      return 'Este item já estava pago.';
    default:
      return 'O pagamento chegou depois que esta cobrança foi fechada.';
  }
}

/** Recusa do cartão, com o motivo da API quando houver (docs/05, "Recusado"). */
export function declineNotice(
  charge: PlayerOnlineCharge,
  kind: PayableContext['kind'],
): DeclineNotice {
  const fallback =
    kind === 'optional'
      ? 'Sua reserva está confirmada: tente outro cartão, pague com Pix ou no espaço.'
      : kind === 'subscription'
        ? 'Tente outro cartão ou pague com Pix.'
        : 'O banco não autorizou. Confira os dados ou use outro cartão.';
  return { title: 'Cartão recusado', message: charge.failureReason || fallback };
}

/**
 * Tela de pagamento de uma reserva ou mensalidade já criada (RF-ONPAY-03 a 05; docs/05, "App —
 * (2)" e "(3)"): Pix (QR, copia e cola, contagem, atualização sozinha) ou cartão (formulário com
 * token), com os estados finais. Sair não cancela nada; voltar retoma a cobrança aberta.
 */
export function PaymentScreen({ payable }: { payable: Payable }) {
  const params = useLocalSearchParams<{ forma?: string; cobranca?: string; falha?: string }>();
  const mode: Mode = params.forma === 'cartao' ? 'card' : 'pix';
  const router = useRouter();
  const name = useThemeName();
  const item = usePayableContext(payable);
  const context = item.context;

  const [createError, setCreateError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(
    params.falha === '1' ? 'Não conseguimos falar com o banco. Tente de novo.' : null,
  );
  const [verifying, setVerifying] = useState(false);
  const [submittedCardIds, setSubmittedCardIds] = useState<string[]>(
    params.cobranca ? [params.cobranca] : [],
  );
  const [copied, setCopied] = useState(false);
  // Cobrança que existia antes da tentativa: a conferência pós "sem resposta" compara com ela.
  const chargeBefore = useRef<string | null>(null);
  const [autoCreateUsed, setAutoCreateUsed] = useState(false);
  // A API respondeu ALREADY_PAID: o item já está pago (no local ou por outro toque).
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  const { query, charge, offline } = useOnlineCharge(payable, {
    poll: (c) => verifying || c?.status === 'PENDING',
  });

  const deadline =
    context?.kind === 'required'
      ? context.holdDeadline
      : ((charge?.status === 'PENDING' ? (charge.expiresAt ?? charge.pix?.expiresAt) : null) ??
        null);
  // O hold da reserva conta pelo relógio da própria reserva; o Pix, pelo da cobrança.
  const remaining = useCountdown(
    deadline,
    true,
    context?.kind === 'required' ? context.clockOffsetMs : null,
  );
  // Paga e fechada ou estornada: os estornos (com o motivo) vêm do comprovante.
  const withRefunds = needsRefundReasons(charge);
  const receipt = useGetMyPayment(charge?.id ?? '', { query: { enabled: withRefunds } });

  const create = useCreateCharge(payable, {
    onSuccess: (created) => {
      setCreateError(null);
      setCardError(null);
      if (created.method === 'CARD') setSubmittedCardIds((ids) => [...ids, created.id]);
    },
    onError: (error) => void handleCreateError(error),
  });
  const lastMethod = useRef<'PIX' | 'CARD'>('PIX');

  const viewInput = {
    mode,
    kind: context?.kind ?? 'optional',
    charge: query.isError && query.data === undefined ? null : charge,
    booking: context?.booking ?? null,
    remainingMs: deadline ? remaining : null,
    creating: create.isPending || verifying,
    createError,
    submittedCardIds,
    settled: Boolean(context?.settled) || alreadyPaid,
    autoCreateUsed,
    refunds: withRefunds ? receipt.data?.refunds : [],
  } as const;
  const view: ChargeView = context ? deriveChargeView(viewInput) : { screen: 'loading' };

  // Contagem em zero ou hold vencido: confere a reserva (a leitura vence o hold) e a cobrança.
  const refetchItem = item.refetch;
  const { refetch } = query;
  const refetchBoth = useRef(() => {});
  refetchBoth.current = () => {
    refetchItem();
    void refetch();
  };
  const expired = remaining === 0;
  useEffect(() => {
    if (!expired) return;
    refetchBoth.current();
    const timer = setInterval(() => refetchBoth.current(), paymentLayout.pollIntervalMs);
    return () => clearInterval(timer);
  }, [expired]);

  const startCreate = (method: 'PIX' | 'CARD', cardToken?: string) => {
    lastMethod.current = method;
    chargeBefore.current = charge?.id ?? null;
    setCreateError(null);
    setCardError(null);
    create.mutate({
      input: { method, ...(cardToken ? { cardToken } : {}) },
      key: newIdempotencyKey(),
    });
  };

  // Na tela do Pix sem um Pix utilizável, gera um (uma vez por abertura da tela).
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispara pela mudança do estado.
  useEffect(() => {
    if (!context || query.isPending || autoCreateUsed) return;
    if (needsNewPix(viewInput)) {
      setAutoCreateUsed(true);
      startCreate('PIX');
    }
  }, [context, query.isPending, view.screen, mode]);

  async function handleCreateError(error: unknown) {
    const method = lastMethod.current;
    const verificationId = pendingVerificationChargeId(error);
    if (verificationId) {
      // Pendente de verificação: consulta a cobrança, nunca cria outra (RN-ONPAY-07).
      if (method === 'CARD') setSubmittedCardIds((ids) => [...ids, verificationId]);
      setVerifying(true);
      await refetch();
      setVerifying(false);
      return;
    }
    if (isApiError(error)) {
      if (GATEWAY_CODES_OFF.has(error.code)) {
        Alert.alert('Pagamento indisponível', ONLINE_OFF_MESSAGE, [
          { text: 'Voltar', onPress: () => router.back() },
        ]);
        return;
      }
      if (error.code === 'ALREADY_PAID' || error.code === 'PAYMENT_HOLD_EXPIRED') {
        // Estado final: pago (a cobrança paga), nada a pagar ou o prazo acabou.
        if (error.code === 'ALREADY_PAID') setAlreadyPaid(true);
        refetchItem();
        void refetch();
        return;
      }
    }
    if (isUnknownOutcome(error)) {
      // Sem resposta: confere a cobrança antes de deixar tentar de novo.
      setVerifying(true);
      const { data } = await refetch();
      setVerifying(false);
      // Criada nesta tentativa = outra cobrança que não a que existia antes dela.
      const created = data && data.id !== chargeBefore.current;
      if (created && data) {
        if (method === 'CARD') setSubmittedCardIds((ids) => [...ids, data.id]);
        return;
      }
      if (method === 'CARD') setCardError('Não conseguimos falar com o banco. Tente de novo.');
      else setCreateError('Confira a internet e tente de novo.');
      return;
    }
    const message = errorMessage(error);
    if (method === 'CARD') setCardError(message);
    else setCreateError(message);
    void refetch();
  }

  // Confirmado: anuncia para o leitor de tela.
  const announced = useRef(false);
  useEffect(() => {
    if (view.screen === 'paid' && !announced.current) {
      announced.current = true;
      AccessibilityInfo.announceForAccessibility('Pagamento confirmado');
    }
  }, [view.screen]);

  // Processando o cartão: o voltar espera a resposta.
  const busy = create.isPending || verifying;
  useEffect(() => {
    if (!busy) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [busy]);

  const setMode = (next: Mode) => {
    setCreateError(null);
    setCardError(null);
    setAutoCreateUsed(false);
    router.setParams({ forma: next === 'card' ? 'cartao' : 'pix' });
  };

  /** Antes de trocar de meio ou gerar outro Pix (decisão 96): confere a cobrança aberta. */
  const confirmSwitch = async (proceed: () => void) => {
    const { data } = await refetch();
    if (data?.status === 'PAID') return; // A tela mostra "Confirmado".
    if (data?.status === 'PENDING' && data.method === 'PIX') {
      Alert.alert(
        'Já pagou? Aguarde a confirmação',
        'Se você já pagou este Pix, a confirmação chega em alguns segundos. Trocar agora cancela este código.',
        [
          { text: 'Aguardar', style: 'cancel', onPress: () => void refetch() },
          { text: 'Trocar mesmo assim', onPress: proceed },
        ],
      );
      return;
    }
    proceed();
  };

  const submitCard = (values: CardFormValues) => {
    const environment = charge?.paymentEnvironment ?? context?.spaceEnvironment;
    const result = tokenizeCard(values, environment);
    if (!result.ok) {
      setCardError(
        result.reason === 'unavailable'
          ? 'O pagamento com cartão está indisponível agora. Use o Pix ou pague no espaço.'
          : 'Confira o número do cartão',
      );
      return;
    }
    startCreate('CARD', result.token);
  };

  const environment = charge?.paymentEnvironment ?? context?.spaceEnvironment ?? null;
  const finalScreen = [
    'paid',
    'hold-expired',
    'pix-expired',
    'late-refund',
    'refunded',
    'nothing-due',
  ].includes(view.screen);
  const title = finalScreen ? 'Pagamento' : mode === 'card' ? 'Pagar com cartão' : 'Pagar com Pix';
  const amountCents =
    charge && (charge.status === 'PENDING' || charge.status === 'PAID')
      ? charge.amountCents
      : (context?.dueCents ?? 0);

  const goToItem = () => {
    if (payable.type === 'BOOKING') {
      router.dismissTo({ pathname: '/reserva/[id]', params: { id: payable.bookingId } });
    } else {
      router.dismissTo({ pathname: '/planos/[id]', params: { id: payable.subscriptionId } });
    }
  };
  const openReceipt = (id: string) =>
    router.push({ pathname: '/meus-pagamentos/[id]', params: { id } });

  const copyCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    AccessibilityInfo.announceForAccessibility('Código Pix copiado');
    setTimeout(() => setCopied(false), paymentLayout.copiedFeedbackMs);
  };

  const body = () => {
    if (item.isPending || view.screen === 'loading') return <LoadingView />;
    if (item.isError || !context) {
      return isNotFound(item.error) || !item.error ? (
        <EmptyView title="Item não encontrado" />
      ) : (
        <ErrorView error={item.error} onRetry={item.refetch} />
      );
    }
    switch (view.screen) {
      case 'paid': {
        const c = view.charge;
        const when = c.paidAt ? formatTime(c.paidAt, context.timeZone) : null;
        return (
          <ResultState
            testID="pagamento-confirmado"
            tone="success"
            icon={CircleCheck}
            title={c.method === 'CARD' ? 'Pagamento aprovado' : 'Pagamento confirmado'}
            lines={[
              [formatCents(c.amountCents), methodShortLabel(c.method, c.cardLast4), when]
                .filter(Boolean)
                .join(' · '),
              context.kind === 'subscription'
                ? `${context.title.split(' · ')[0]} paga.`
                : 'Sua reserva está confirmada.',
            ]}
            actions={
              <>
                <Button testID="pagamento-ver-item" size="lg" onPress={goToItem}>
                  <Text>{payable.type === 'BOOKING' ? 'Ver reserva' : 'Voltar ao plano'}</Text>
                </Button>
                <Button
                  testID="pagamento-ver-comprovante"
                  size="lg"
                  variant="outline"
                  onPress={() => openReceipt(c.id)}
                >
                  <Text>Ver comprovante</Text>
                </Button>
              </>
            }
          />
        );
      }
      case 'hold-expired':
        return (
          <ResultState
            testID="pagamento-prazo-acabou"
            tone="muted"
            icon={TimerOff}
            title="O prazo para pagar acabou"
            lines={[
              'A reserva foi cancelada e o horário liberado. Se ainda estiver livre, você pode reservar de novo.',
            ]}
            actions={
              <>
                <Button
                  testID="pagamento-reservar-de-novo"
                  size="lg"
                  onPress={() =>
                    router.push({
                      pathname: '/espaco/[slug]/reservar',
                      params: { slug: context.spaceSlug },
                    })
                  }
                >
                  <Text>Reservar de novo</Text>
                </Button>
                <Button size="lg" variant="outline" onPress={goToItem}>
                  <Text>Voltar</Text>
                </Button>
              </>
            }
          />
        );
      case 'pix-expired':
        return (
          <ResultState
            testID="pagamento-pix-vencido"
            tone="muted"
            icon={TimerOff}
            title="Este Pix venceu"
            lines={[
              context.kind === 'subscription'
                ? 'Gere outro quando quiser pagar.'
                : context.kind === 'required'
                  ? 'Gere outro Pix para pagar dentro do prazo.'
                  : 'Sua reserva continua confirmada. Gere outro Pix ou pague no espaço.',
            ]}
            actions={
              <>
                <Button testID="pagamento-gerar-pix" size="lg" onPress={() => startCreate('PIX')}>
                  <Text>Gerar novo Pix</Text>
                </Button>
                <Button size="lg" variant="outline" onPress={goToItem}>
                  <Text>
                    {payable.type === 'BOOKING' ? 'Voltar para a reserva' : 'Voltar ao plano'}
                  </Text>
                </Button>
              </>
            }
          />
        );
      case 'late-refund': {
        const c = view.charge;
        const destination = c.method === 'PIX' ? 'para o mesmo Pix' : 'para o cartão';
        return (
          <ResultState
            testID="pagamento-estornado-sozinho"
            tone="info"
            icon={Undo2}
            title={lateRefundTitle(view.reason, view.bookingCancelled)}
            lines={[
              `${lateRefundCause(view.reason, view.bookingCancelled)} Os ${formatCents(c.amountCents)} voltam ${destination}.`,
            ]}
            actions={
              <Button size="lg" variant="outline" onPress={() => openReceipt(c.id)}>
                <Text>Ver comprovante</Text>
              </Button>
            }
          />
        );
      }
      case 'refunded':
        return (
          <ResultState
            testID="pagamento-estornado"
            tone="info"
            icon={Undo2}
            title="Pagamento estornado"
            lines={['Veja os valores e as datas no comprovante.']}
            actions={
              <Button size="lg" variant="outline" onPress={() => openReceipt(view.charge.id)}>
                <Text>Ver comprovante</Text>
              </Button>
            }
          />
        );
      case 'nothing-due':
        return (
          <ResultState
            testID="pagamento-nada-a-pagar"
            tone="muted"
            icon={CircleCheck}
            title="Nada a pagar"
            lines={[
              payable.type === 'BOOKING'
                ? 'Esta reserva não tem valor em aberto para pagar pelo app.'
                : 'Esta mensalidade já está paga, foi dispensada ou não tem valor em aberto.',
            ]}
            actions={
              <Button size="lg" variant="outline" onPress={goToItem}>
                <Text>Voltar</Text>
              </Button>
            }
          />
        );
      case 'pix-closed':
        return (
          <ResultState
            testID="pagamento-pix-cancelado"
            tone="muted"
            icon={Ban}
            title="Este Pix não vale mais"
            lines={[
              'O código foi cancelado (por exemplo, por uma troca de forma de pagamento). Nada foi cobrado.',
            ]}
            actions={
              <>
                <Button testID="pagamento-gerar-pix" size="lg" onPress={() => startCreate('PIX')}>
                  <Text>Gerar novo Pix</Text>
                </Button>
                <Button size="lg" variant="outline" onPress={goToItem}>
                  <Text>
                    {payable.type === 'BOOKING' ? 'Voltar para a reserva' : 'Voltar ao plano'}
                  </Text>
                </Button>
              </>
            }
          />
        );
      case 'error':
        return (
          <ResultState
            testID="pagamento-erro"
            tone="destructive"
            icon={CircleAlert}
            title="Não conseguimos gerar o Pix"
            lines={[view.message]}
            actions={
              <Button
                testID="pagamento-tentar-de-novo"
                size="lg"
                onPress={() => startCreate('PIX')}
              >
                <Text>Tentar de novo</Text>
              </Button>
            }
          />
        );
      default:
        return null;
    }
  };

  const content = body();

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <ScreenHeader
        title={title}
        testID="pagamento-titulo"
        right={isSandbox(environment) ? <SandboxBadge /> : undefined}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="gap-4 px-4 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          {content ?? (
            <>
              {context ? <AmountBlock context={context} amountCents={amountCents} /> : null}
              {context && (view.screen === 'card-form' || view.screen === 'processing') ? (
                <>
                  {context.kind === 'required' && context.holdDeadline && remaining !== null ? (
                    <HoldLine remainingMs={remaining} />
                  ) : null}
                  {view.screen === 'processing' ? (
                    <View
                      testID="cartao-processando"
                      className="flex-row items-center gap-3 py-6"
                      accessibilityLiveRegion="polite"
                    >
                      <ActivityIndicator color={color(name, 'mutedForeground')} />
                      <Text variant="muted">Conferindo o pagamento…</Text>
                    </View>
                  ) : !environment ? (
                    <LoadingView />
                  ) : !canTokenizeCard(environment) ? (
                    <View testID="cartao-indisponivel" className="gap-3 py-4">
                      <Text>O pagamento com cartão não está disponível no app agora.</Text>
                      {context.onlineOptions.includes('ONLINE_PIX') ? (
                        <Button size="lg" onPress={() => setMode('pix')}>
                          <Text>Pagar com Pix</Text>
                        </Button>
                      ) : null}
                    </View>
                  ) : (
                    <CardFormView
                      amountCents={amountCents}
                      environment={environment}
                      processing={busy}
                      decline={view.declined ? declineNotice(view.declined, context.kind) : null}
                      resetKey={view.declined?.id ?? null}
                      error={
                        cardError ??
                        (view.interrupted
                          ? 'O pagamento não foi concluído e nada foi cobrado. Tente de novo.'
                          : null)
                      }
                      onSubmit={submitCard}
                      onPayWithPix={
                        context.onlineOptions.includes('ONLINE_PIX')
                          ? () => setMode('pix')
                          : undefined
                      }
                    />
                  )}
                </>
              ) : null}
              {context && (view.screen === 'pix' || view.screen === 'generating') ? (
                <PixBody
                  view={view}
                  context={context}
                  remaining={remaining}
                  deadline={deadline}
                  offline={offline}
                  copied={copied}
                  onCopy={(code) => void copyCode(code)}
                  onPayWithCard={() => void confirmSwitch(() => setMode('card'))}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AmountBlock({ context, amountCents }: { context: PayableContext; amountCents: number }) {
  return (
    <View className="gap-1 pt-2">
      <Text variant="overline">Valor</Text>
      <Text testID="pagamento-valor" className="font-display-bold text-4xl tabular-nums">
        {formatCents(amountCents)}
      </Text>
      <Text variant="muted">{context.title}</Text>
      {context.subtitle ? (
        <Text variant="muted" className="tabular-nums">
          {context.subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Reserva obrigatória na tela do cartão: "Horário guardado por mais 12:41". */
function HoldLine({ remainingMs }: { remainingMs: number }) {
  const name = useThemeName();
  const urgent = isUrgent(remainingMs, 'booking');
  return (
    <View className="flex-row items-center gap-2" testID="cartao-prazo">
      <Clock
        size={16}
        color={color(name, urgent ? 'warningSubtleForeground' : 'foreground')}
        aria-hidden
      />
      <Text
        accessibilityLabel={countdownA11yLabel(remainingMs)}
        className={
          urgent
            ? 'font-medium text-warning-subtle-foreground tabular-nums'
            : 'font-medium tabular-nums'
        }
      >
        Horário guardado por mais {formatClock(remainingMs)}
      </Text>
    </View>
  );
}

function PixBody({
  view,
  context,
  remaining,
  deadline,
  offline,
  copied,
  onCopy,
  onPayWithCard,
}: {
  view: Extract<ChargeView, { screen: 'pix' } | { screen: 'generating' }>;
  context: PayableContext;
  remaining: number | null;
  deadline: string | null;
  offline: boolean;
  copied: boolean;
  onCopy: (code: string) => void;
  onPayWithCard: () => void;
}) {
  const name = useThemeName();
  const charge = view.screen === 'pix' ? view.charge : null;
  const pix = charge?.pix ?? null;
  const steps = useMemo(
    () => [
      '1. Copie o código',
      '2. No app do banco, escolha Pix copia e cola',
      '3. Volte aqui: a confirmação aparece sozinha',
    ],
    [],
  );
  return (
    <>
      {deadline && remaining !== null && pix ? (
        <CountdownCard
          kind={context.kind}
          deadline={deadline}
          remainingMs={remaining}
          checking={view.screen === 'pix' && view.checking}
          timeZone={context.timeZone}
        />
      ) : null}

      {pix ? (
        <View className="gap-2">
          <Text variant="overline">Pix copia e cola</Text>
          <Text
            testID="pix-copia-e-cola"
            numberOfLines={1}
            ellipsizeMode="middle"
            className="text-sm text-muted-foreground"
            style={{ fontFamily: monoFontFamily() }}
            selectable
          >
            {pix.copyPaste}
          </Text>
          <Button testID="pix-copiar" size="lg" onPress={() => onCopy(pix.copyPaste)}>
            {copied ? (
              <Check size={20} color={color(name, 'primaryForeground')} aria-hidden />
            ) : (
              <Copy size={20} color={color(name, 'primaryForeground')} aria-hidden />
            )}
            <Text>{copied ? 'Copiado!' : 'Copiar código Pix'}</Text>
          </Button>
          <View className="gap-0.5">
            {steps.map((step) => (
              <Text key={step} variant="muted">
                {step}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-2 pt-2">
        {pix ? (
          <Text className="text-center text-sm font-medium">
            Ou leia o QR code em outro celular
          </Text>
        ) : null}
        {pix && charge ? (
          <PixQr qr={pix.qrSvg} amountCents={charge.amountCents} />
        ) : (
          <PixQrSkeleton />
        )}
      </View>

      <View
        className="flex-row items-center justify-center gap-2"
        accessibilityLiveRegion="polite"
        testID="pix-aguardando"
      >
        <ActivityIndicator size="small" color={color(name, 'mutedForeground')} />
        <Text variant="muted">
          {!pix
            ? 'Gerando o Pix…'
            : offline
              ? 'Sem conexão. Tentando de novo…'
              : 'Aguardando o pagamento…'}
        </Text>
      </View>

      {pix ? (
        <View className="gap-1">
          {context.kind === 'optional' ? (
            <Text variant="muted" className="text-center">
              Prefere pagar no espaço? Pode sair: sua reserva já está confirmada.
            </Text>
          ) : null}
          {context.onlineOptions.includes('ONLINE_CARD') ? (
            <Button testID="pix-pagar-cartao" variant="ghost" onPress={onPayWithCard}>
              <Text>Pagar com cartão</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

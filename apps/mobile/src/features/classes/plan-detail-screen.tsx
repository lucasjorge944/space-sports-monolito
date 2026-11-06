import {
  getGetMySubscriptionQueryKey,
  type PaymentMethod,
  type SubscriptionDetail,
  useCancelMySubscription,
  useGetMySubscription,
  useGetSpaceBySlug,
  useResumeMySubscriptionCancel,
  useSwapMyClassGroup,
  useUpdateMySubscription,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { ChipRow } from '@/features/booking/section';
import { classOnlineOptions } from '@/features/payments/options';
import { PAYMENT_METHOD_LABELS } from '@/features/space/labels';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { formatDate, todayIn } from '@/lib/datetime';
import { cancellationMessage, canResumeCancellation } from './cancellation';
import { ChargesList } from './charges-list';
import { GroupSummary } from './group-card';
import {
  isOpenSubscription,
  NEXT_CHARGE_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_PREFERENCE_NONE,
  planFrequencyLabel,
  SUBSCRIPTION_STATUS_LABELS,
} from './labels';
import { SwapSheet, type SwapTarget } from './swap-sheet';

/**
 * Meu plano (RF-CLASS-04/06): assinatura, turmas, próxima mensalidade e histórico; cancelar com
 * acesso até o último mês pago e desistir enquanto ele durar (RN-CLASS-08, decisão 45), trocar de
 * turma e a forma de pagamento preferida. Sem reposição de aula (decisão 24).
 */
export function PlanDetailScreen() {
  const { id, nova } = useLocalSearchParams<{ id: string; nova?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useGetMySubscription(id);
  const [notice, setNotice] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  const subscription = query.data;

  /** Cada ação devolve a assinatura atualizada: grava no cache e renova as listas e as aulas. */
  const onUpdated = (updated: SubscriptionDetail) => {
    queryClient.setQueryData(getGetMySubscriptionQueryKey(id), updated);
    void queryClient.invalidateQueries({ queryKey: ['/v1/me/subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['/v1/me/class-sessions'] });
    setNotice(null);
  };
  const onFailed = (error: unknown) => {
    setNotice(errorMessage(error));
    // O estado pode ter mudado no servidor (job, gestão): recarrega.
    void queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey(id) });
  };

  const cancel = useCancelMySubscription({ mutation: { onSuccess: onUpdated, onError: onFailed } });
  const resumeCancel = useResumeMySubscriptionCancel({
    mutation: { onSuccess: onUpdated, onError: onFailed },
  });
  const swap = useSwapMyClassGroup({
    mutation: {
      onSuccess: (updated) => {
        onUpdated(updated);
        setSwapTarget(null);
      },
      onError: onFailed,
    },
  });
  const preference = useUpdateMySubscription({
    mutation: { onSuccess: onUpdated, onError: onFailed },
  });

  const busy = cancel.isPending || resumeCancel.isPending || swap.isPending || preference.isPending;

  const confirmCancel = (item: SubscriptionDetail) => {
    const pending = item.status === 'PENDING_APPROVAL';
    Alert.alert(
      pending ? 'Retirar pedido?' : 'Cancelar plano?',
      pending
        ? 'O espaço deixa de analisar este pedido.'
        : cancellationMessage(item, todayIn(item.space.timeZone)),
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: pending ? 'Retirar pedido' : 'Cancelar plano',
          style: 'destructive',
          onPress: () => {
            setNotice(null);
            cancel.mutate({ subscriptionId: id, data: {} });
          },
        },
      ],
    );
  };

  const confirmResumeCancel = () => {
    Alert.alert(
      'Desistir do cancelamento?',
      'O plano volta ao ciclo normal, com as próximas mensalidades. As aulas de que você saiu ao cancelar não voltam: confirme presença de novo.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Desistir do cancelamento',
          onPress: () => {
            setNotice(null);
            resumeCancel.mutate({ subscriptionId: id });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader
        title="Meu plano"
        testID="plano-titulo"
        right={
          <Button variant="ghost" size="sm" onPress={() => router.push('/planos')}>
            <Text>Todos</Text>
          </Button>
        }
      />
      {query.isPending ? (
        <LoadingView />
      ) : query.isError || !subscription ? (
        isNotFound(query.error) ? (
          <EmptyView title="Plano não encontrado" />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : (
        <PlanBody
          subscription={subscription}
          justRequested={nova === '1'}
          // Com a folha aberta o erro aparece nela, não atrás.
          notice={swapTarget ? null : notice}
          busy={busy}
          onResumeCancel={confirmResumeCancel}
          onCancel={() => confirmCancel(subscription)}
          onSwap={(target) => {
            setNotice(null);
            setSwapTarget(target);
          }}
          onPreference={(method) => {
            setNotice(null);
            preference.mutate({ subscriptionId: id, data: { intendedPaymentMethod: method } });
          }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
        />
      )}
      {subscription ? (
        <SwapSheet
          // Cada turma de origem começa sem escolha.
          key={swapTarget?.fromGroup.id ?? 'fechada'}
          target={swapTarget}
          pending={swap.isPending}
          error={swapTarget ? notice : null}
          onClose={() => setSwapTarget(null)}
          onConfirm={(toClassGroupId) => {
            if (!swapTarget) return;
            setNotice(null);
            swap.mutate({
              subscriptionId: id,
              data: { fromClassGroupId: swapTarget.fromGroup.id, toClassGroupId },
            });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function PlanBody({
  subscription,
  justRequested,
  notice,
  busy,
  refreshing,
  onRefresh,
  onResumeCancel,
  onCancel,
  onSwap,
  onPreference,
}: {
  subscription: SubscriptionDetail;
  justRequested: boolean;
  notice: string | null;
  busy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onResumeCancel: () => void;
  onCancel: () => void;
  onSwap: (target: SwapTarget) => void;
  onPreference: (method: PaymentMethod | null) => void;
}) {
  const status = SUBSCRIPTION_STATUS_LABELS[subscription.status];
  const open = isOpenSubscription(subscription.status);
  const enrollments = subscription.enrollments.filter((e) => e.status !== 'ENDED');
  const active = enrollments.filter((e) => e.status === 'ACTIVE');
  const canSwap = subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE';
  const resumable = canResumeCancellation(subscription, todayIn(subscription.space.timeZone));
  const next = subscription.nextCharge;
  // RF-ONPAY-05: "Pagar agora" nas mensalidades em aberto quando o modo de aulas permite.
  const space = useGetSpaceBySlug(subscription.space.slug, { query: { staleTime: 60_000 } });
  const payOnline = classOnlineOptions(space.data).length > 0;

  return (
    <ScrollView
      contentContainerClassName="gap-4 p-4 pb-10"
      testID="plano-conteudo"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {justRequested ? (
        <Card testID="plano-novo">
          <Text variant="large">Pedido enviado!</Text>
          <Text variant="muted">
            O espaço vai analisar e avisamos quando houver resposta. Acompanhe por aqui.
          </Text>
        </Card>
      ) : null}

      <Card>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="large" className="flex-1" numberOfLines={2}>
            {subscription.plan.name}
          </Text>
          <Badge variant={status.variant} testID="plano-status">
            <Text>{status.label}</Text>
          </Badge>
        </View>
        <Text variant="muted">
          {subscription.space.name} · {subscription.plan.sport.name} ·{' '}
          {planFrequencyLabel(subscription.plan.weeklyFrequency)}
        </Text>
        <Text className="tabular-nums">
          {formatCents(subscription.priceCents)} por mês · vence todo dia{' '}
          {subscription.plan.billingDay}
        </Text>
        <Text variant="muted">{status.hint}</Text>
        {subscription.status === 'CANCELLED' && subscription.accessUntil ? (
          <Text testID="plano-acesso-encerrado">
            O acesso terminou em {formatDate(subscription.accessUntil)}.
          </Text>
        ) : null}
        {subscription.statusReason ? <Text>Motivo: {subscription.statusReason}</Text> : null}
      </Card>

      {resumable && subscription.accessUntil ? (
        <Card
          testID="plano-cancelamento-agendado"
          className="border-warning-subtle-border bg-warning-subtle"
        >
          <Text variant="large" className="text-warning-subtle-foreground">
            Cancelamento pedido
          </Text>
          <Text className="text-warning-subtle-foreground">
            Seu plano fica ativo até {formatDate(subscription.accessUntil)}. Depois disso ele
            termina e nenhuma mensalidade nova é gerada.
          </Text>
          <InlineError message={notice} />
          <Button
            testID="plano-desistir-cancelamento"
            variant="outline"
            disabled={busy}
            onPress={onResumeCancel}
          >
            <Text>{busy ? 'Aguarde…' : 'Desistir do cancelamento'}</Text>
          </Button>
        </Card>
      ) : null}

      <Card>
        <Text variant="large">Minhas turmas</Text>
        {enrollments.length === 0 ? (
          <Text variant="muted">Nenhuma turma no momento.</Text>
        ) : (
          enrollments.map((enrollment) => (
            <View
              key={enrollment.id}
              testID={`plano-turma-${enrollment.classGroup.id}`}
              className="gap-2"
            >
              <GroupSummary group={{ ...enrollment.classGroup, level: null }} />
              {enrollment.status === 'PENDING' ? (
                <Text variant="muted">Aguardando a aprovação do espaço.</Text>
              ) : null}
              {canSwap && enrollment.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  testID={`plano-trocar-${enrollment.classGroup.id}`}
                  onPress={() =>
                    onSwap({
                      slug: subscription.space.slug,
                      sportId: subscription.plan.sport.id,
                      fromGroup: enrollment.classGroup,
                      otherGroups: active
                        .filter((other) => other.id !== enrollment.id)
                        .map((other) => other.classGroup),
                    })
                  }
                >
                  <Text>Trocar turma</Text>
                </Button>
              ) : null}
            </View>
          ))
        )}
      </Card>

      {open && subscription.status !== 'PENDING_APPROVAL' ? (
        <Card testID="plano-proxima-mensalidade">
          <Text variant="large">Próxima mensalidade</Text>
          {next ? (
            <View className="flex-row items-center justify-between gap-3">
              <View>
                <Text variant="price">{formatCents(next.amountCents)}</Text>
                <Text variant="muted">Vence {formatDate(next.dueDate)}</Text>
              </View>
              <Badge variant={NEXT_CHARGE_STATUS_LABELS[next.status].variant}>
                <Text>{NEXT_CHARGE_STATUS_LABELS[next.status].label}</Text>
              </Badge>
            </View>
          ) : (
            <Text variant="muted">
              {subscription.cancelAtPeriodEnd
                ? 'Não há novas mensalidades: o plano está em cancelamento.'
                : 'Sem mensalidade prevista.'}
            </Text>
          )}
          {subscription.overdueCents > 0 ? (
            <Text className="text-destructive" testID="plano-em-atraso">
              Em atraso: {formatCents(subscription.overdueCents)}.{' '}
              {payOnline ? 'Pague pelo app ou no espaço.' : 'Pague direto no espaço.'}
            </Text>
          ) : null}
          <Text variant="muted">
            {payOnline
              ? 'Pague pelo app (Pix ou cartão) ou direto no espaço, que registra aqui quando recebe.'
              : 'O pagamento é feito direto no espaço, que registra aqui quando recebe.'}
          </Text>
        </Card>
      ) : null}

      {subscription.status !== 'PENDING_APPROVAL' ? (
        <Card>
          <Text variant="large">Mensalidades</Text>
          <ChargesList
            charges={subscription.charges}
            online={
              payOnline && open
                ? {
                    subscriptionId: subscription.id,
                    spaceSlug: subscription.space.slug,
                    timeZone: subscription.space.timeZone,
                  }
                : null
            }
          />
        </Card>
      ) : null}

      {open ? (
        <Card>
          <Text variant="large">Forma de pagamento preferida</Text>
          <ChipRow label="Forma de pagamento preferida">
            <Chip
              testID="plano-pagamento-nenhum"
              disabled={busy}
              selected={subscription.intendedPaymentMethod === null}
              onPress={() => onPreference(null)}
            >
              <Text>{PAYMENT_PREFERENCE_NONE}</Text>
            </Chip>
            {PAYMENT_METHODS.map((method) => (
              <Chip
                key={method}
                testID={`plano-pagamento-${method}`}
                disabled={busy}
                selected={subscription.intendedPaymentMethod === method}
                onPress={() => onPreference(method)}
              >
                <Text>{PAYMENT_METHOD_LABELS[method]}</Text>
              </Chip>
            ))}
          </ChipRow>
        </Card>
      ) : null}

      {open ? (
        <View className="gap-2">
          {resumable ? null : <InlineError message={notice} />}
          {!subscription.cancelAtPeriodEnd ? (
            <Button
              testID="plano-cancelar"
              variant="destructive"
              disabled={busy}
              onPress={onCancel}
            >
              <Text>
                {subscription.status === 'PENDING_APPROVAL' ? 'Retirar pedido' : 'Cancelar plano'}
              </Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

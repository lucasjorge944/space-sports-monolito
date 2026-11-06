import {
  getGetSpaceClassesQueryKey,
  type PaymentMethod,
  useGetSpaceClasses,
  useRequestSubscription,
} from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { ChipRow, Step } from '@/features/booking/section';
import { PAYMENT_METHOD_LABELS } from '@/features/space/labels';
import { errorMessage, isNotFound } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { GroupSummary } from './group-card';
import { PAYMENT_METHODS, PAYMENT_PREFERENCE_NONE, planFrequencyLabel } from './labels';
import {
  eligibleGroups,
  GROUP_DISABLED_LABELS,
  groupDisabledReason,
  isSelectionComplete,
  selectionInstruction,
  selectionProgress,
  toggleGroup,
} from './selection';

/**
 * Contratar um plano (RF-CLASS-04, RN-CLASS-01): escolhe as turmas (Nx/semana = exatamente N;
 * ilimitado = as que quiser) e a forma de pagamento preferida. O espaço aprova; o pagamento é
 * direto no espaço.
 */
export function SubscribeScreen() {
  const { slug, planId } = useLocalSearchParams<{ slug: string; planId?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useGetSpaceClasses(slug);
  const [pickedPlanId, setPickedPlanId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useRequestSubscription({
    mutation: {
      onSuccess: (subscription) => {
        void queryClient.invalidateQueries({ queryKey: ['/v1/me/subscriptions'] });
        void queryClient.invalidateQueries({ queryKey: getGetSpaceClassesQueryKey(slug) });
        router.replace({ pathname: '/planos/[id]', params: { id: subscription.id, nova: '1' } });
      },
      onError: (error) => {
        setNotice(errorMessage(error));
        // Vaga, plano ou turma podem ter mudado desde que a lista foi carregada.
        void queryClient.invalidateQueries({ queryKey: getGetSpaceClassesQueryKey(slug) });
      },
    },
  });

  const data = query.data;
  const plan = useMemo(() => {
    if (!data) return undefined;
    const id = pickedPlanId ?? planId;
    // Link antigo (plano removido): com um único plano, cai nele.
    return (
      data.plans.find((item) => item.id === id) ??
      (data.plans.length === 1 ? data.plans[0] : undefined)
    );
  }, [data, pickedPlanId, planId]);
  const groups = useMemo(
    () => (data && plan ? eligibleGroups(plan, data.classGroups) : []),
    [data, plan],
  );
  const selected = groups.filter((group) => groupIds.includes(group.id));

  if (query.isPending) {
    return (
      <Shell>
        <LoadingView />
      </Shell>
    );
  }
  if (query.isError || !data) {
    return (
      <Shell>
        {isNotFound(query.error) ? (
          <EmptyView title="Espaço não encontrado" description="Ele pode ter sido desativado." />
        ) : (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Shell>
    );
  }
  if (data.plans.length === 0) {
    return (
      <Shell title={data.space.name}>
        <EmptyView
          title="Sem planos disponíveis"
          description="Este espaço ainda não abriu planos de aula."
        />
      </Shell>
    );
  }

  const ready =
    plan !== undefined && isSelectionComplete(plan, groupIds.length) && !request.isPending;
  const submit = () => {
    if (!plan || !ready) return;
    setNotice(null);
    request.mutate({
      data: {
        planId: plan.id,
        classGroupIds: groupIds,
        ...(method ? { intendedPaymentMethod: method } : {}),
      },
    });
  };

  return (
    <Shell title={`Contratar · ${data.space.name}`}>
      <ScrollView contentContainerClassName="gap-6 p-4 pb-8" keyboardShouldPersistTaps="handled">
        {data.plans.length > 1 ? (
          <Step title="Plano">
            <ChipRow label="Plano">
              {data.plans.map((item) => (
                <Chip
                  key={item.id}
                  testID={`contratar-plano-${item.id}`}
                  selected={plan?.id === item.id}
                  onPress={() => {
                    setPickedPlanId(item.id);
                    setGroupIds([]);
                    setNotice(null);
                  }}
                >
                  <Text>{item.name}</Text>
                </Chip>
              ))}
            </ChipRow>
          </Step>
        ) : null}

        {plan ? (
          <>
            <Card>
              <Text variant="large">{plan.name}</Text>
              <Text variant="muted">
                {plan.sport.name} · {planFrequencyLabel(plan.weeklyFrequency)}
              </Text>
              <Text className="tabular-nums">
                {formatCents(plan.priceCents)} por mês · vence todo dia {plan.billingDay}
              </Text>
            </Card>

            <Step title="Turmas">
              <Text variant="muted">{selectionInstruction(plan)}</Text>
              {groups.length === 0 ? (
                <Text variant="muted" testID="contratar-sem-turmas">
                  Nenhuma turma de {plan.sport.name} aberta no momento.
                </Text>
              ) : (
                <View className="gap-2" role="group" accessibilityLabel="Turmas">
                  {groups.map((group) => {
                    const checked = groupIds.includes(group.id);
                    const reason = groupDisabledReason(plan, group, selected);
                    return (
                      <Pressable
                        key={group.id}
                        testID={`contratar-turma-${group.id}`}
                        role="checkbox"
                        aria-checked={checked}
                        aria-disabled={reason !== null}
                        disabled={reason !== null}
                        accessibilityLabel={group.name}
                        onPress={() => {
                          setNotice(null);
                          setGroupIds((current) => toggleGroup(plan, groups, current, group.id));
                        }}
                        className={cn(
                          'gap-1 rounded-lg border p-3',
                          checked ? 'border-primary bg-accent' : 'border-border bg-card',
                          reason !== null && 'opacity-50',
                        )}
                      >
                        <GroupSummary group={group} availableSpots={group.availableSpots} />
                        {reason && reason !== 'FULL' ? (
                          <Text variant="muted">{GROUP_DISABLED_LABELS[reason]}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text variant="muted" testID="contratar-progresso">
                {selectionProgress(plan, groupIds.length)}
              </Text>
            </Step>

            <Step title="Forma de pagamento preferida">
              <ChipRow label="Forma de pagamento preferida">
                <Chip
                  testID="contratar-pagamento-nenhum"
                  selected={method === null}
                  onPress={() => setMethod(null)}
                >
                  <Text>{PAYMENT_PREFERENCE_NONE}</Text>
                </Chip>
                {PAYMENT_METHODS.map((item) => (
                  <Chip
                    key={item}
                    testID={`contratar-pagamento-${item}`}
                    selected={method === item}
                    onPress={() => setMethod(item)}
                  >
                    <Text>{PAYMENT_METHOD_LABELS[item]}</Text>
                  </Chip>
                ))}
              </ChipRow>
              <Text variant="muted">
                É só uma preferência: o pagamento é feito direto no espaço e o espaço registra.
              </Text>
            </Step>
          </>
        ) : (
          <Text variant="muted">Escolha um plano para continuar.</Text>
        )}

        <InlineError message={notice} />
        <Button testID="contratar-enviar" size="lg" disabled={!ready} onPress={submit}>
          <Text>{request.isPending ? 'Enviando…' : 'Enviar pedido'}</Text>
        </Button>
      </ScrollView>
    </Shell>
  );
}

function Shell({
  title = 'Contratar plano',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title={title} testID="contratar-titulo" />
      {children}
    </SafeAreaView>
  );
}

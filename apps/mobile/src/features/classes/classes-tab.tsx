import { type PublicSpace, useGetSpaceClasses } from '@space-sports/api-client';
import { formatCents } from '@space-sports/shared';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { GroupSummary } from './group-card';
import { planFrequencyLabel } from './labels';

/**
 * Aba "Aulas" da página do espaço (RF-CLASS-04): planos e turmas com vagas. Contratar é pedir o
 * plano escolhendo as turmas; o espaço aprova e a mensalidade é paga direto no espaço.
 */
export function ClassesTab({ space }: { space: PublicSpace }) {
  const router = useRouter();
  const query = useGetSpaceClasses(space.slug, { query: { staleTime: 30_000 } });

  if (query.isPending) return <LoadingView label="Carregando aulas…" />;
  if (query.isError || !query.data) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }
  const { plans, classGroups } = query.data;

  if (plans.length === 0 && classGroups.length === 0) {
    return (
      <EmptyView
        title="Sem aulas por enquanto"
        description="Este espaço ainda não abriu turmas nem planos de aula."
      />
    );
  }

  return (
    <View className="gap-5" testID="aulas-tab">
      <Text variant="muted">
        Escolha um plano e as turmas em que quer ter aula. O espaço analisa o pedido e as
        mensalidades são pagas direto no espaço.
      </Text>

      <View className="gap-3">
        <Text variant="large">Planos</Text>
        {plans.length === 0 ? (
          <Text variant="muted" testID="aulas-sem-planos">
            Nenhum plano disponível no momento.
          </Text>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id} testID={`aulas-plano-${plan.id}`}>
              <View className="gap-0.5">
                <Text variant="large">{plan.name}</Text>
                <Text variant="muted">
                  {plan.sport.name} · {planFrequencyLabel(plan.weeklyFrequency)}
                </Text>
              </View>
              <View className="flex-row items-baseline gap-1">
                <Text variant="h4" className="tabular-nums">
                  {formatCents(plan.priceCents)}
                </Text>
                <Text variant="muted">por mês</Text>
              </View>
              <Text variant="muted">Vence todo dia {plan.billingDay}</Text>
              <Button
                testID={`aulas-contratar-${plan.id}`}
                onPress={() =>
                  router.push({
                    pathname: '/espaco/[slug]/contratar',
                    params: { slug: space.slug, planId: plan.id },
                  })
                }
              >
                <Text>Contratar</Text>
              </Button>
            </Card>
          ))
        )}
      </View>

      <View className="gap-3">
        <Text variant="large">Turmas</Text>
        {classGroups.length === 0 ? (
          <Text variant="muted">Nenhuma turma aberta no momento.</Text>
        ) : (
          classGroups.map((group) => (
            <Card key={group.id} testID={`aulas-turma-${group.id}`}>
              <GroupSummary group={group} availableSpots={group.availableSpots} />
            </Card>
          ))
        )}
      </View>

      <Button variant="outline" testID="aulas-meus-planos" onPress={() => router.push('/planos')}>
        <Text>Meus planos</Text>
      </Button>
    </View>
  );
}

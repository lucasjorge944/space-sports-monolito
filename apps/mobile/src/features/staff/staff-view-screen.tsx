import { useGetMyStaffSpaces, useGetSpaceBySlug } from '@space-sports/api-client';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SpaceAvatar } from '@/components/space-avatar';
import { EmptyView, ErrorView, LoadingView } from '@/components/state-views';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useMe } from '@/features/auth/session';
import { formatAddress, groupOpeningHours } from '@/features/space/space-format';
import { cn } from '@/lib/utils';
import { rolesLabel, SPACE_STATUS_NOTICE } from './role-labels';
import { StaffBookingsCard } from './staff-bookings-card';
import { StaffClassesCard } from './staff-classes-card';

/** Endereço, telefone e horários vêm da página pública do espaço (o endpoint de equipe só traz a agenda). */
function SpaceInfoCard({ slug }: { slug: string }) {
  const query = useGetSpaceBySlug(slug);
  const space = query.data;
  if (!space) return null;
  const address = formatAddress(space.address);
  return (
    <Card className="gap-1">
      <Text variant="large">Informações do espaço</Text>
      {address ? <Text variant="muted">{address}</Text> : null}
      {space.phone ? <Text variant="muted">{space.phone}</Text> : null}
      {groupOpeningHours(space.openingHours).map((group) => (
        <Text key={group.days} variant="muted" className="tabular-nums">
          {group.days} · {group.range}
        </Text>
      ))}
    </Card>
  );
}

/** Aba "Meu Espaço": visão de equipe somente leitura (RN-AUTH-04). A gestão (escrita) é no web. */
export function StaffViewScreen() {
  const me = useMe();
  const query = useGetMyStaffSpaces();
  const [selected, setSelected] = useState(0);
  const items = query.data?.items ?? [];
  const item = items[Math.min(selected, items.length - 1)];

  return (
    <Screen>
      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : !item ? (
        <EmptyView
          title="Nenhum espaço vinculado"
          description={
            me.memberships.length > 0
              ? 'Seu vínculo mudou. Saia e entre de novo para atualizar.'
              : 'Quando você entrar para a equipe de um espaço, ele aparece aqui.'
          }
        />
      ) : (
        <ScrollView contentContainerClassName="gap-4 pb-8">
          {items.length > 1 ? (
            <View className="flex-row flex-wrap gap-2" accessibilityRole="tablist">
              {items.map((option, index) => (
                <Pressable
                  key={option.space.id}
                  onPress={() => setSelected(index)}
                  role="tab"
                  accessibilityState={{ selected: index === selected }}
                  className={cn(
                    'h-11 flex-row items-center gap-2 rounded-full border pl-1.5 pr-4',
                    index === selected ? 'border-primary bg-accent' : 'border-border',
                  )}
                >
                  <SpaceAvatar name={option.space.name} logoUrl={option.space.logoUrl} size={32} />
                  <Text className="text-sm font-medium">{option.space.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="flex-row items-center gap-3">
            <SpaceAvatar name={item.space.name} logoUrl={item.space.logoUrl} size={56} />
            <View className="flex-1 gap-1">
              <Text variant="h4">{item.space.name}</Text>
              <Text variant="muted">Seu papel: {rolesLabel(item.roles)}</Text>
              {SPACE_STATUS_NOTICE[item.space.status] ? (
                <Text className="text-sm text-warning-subtle-foreground">
                  {SPACE_STATUS_NOTICE[item.space.status]}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Cada espaço com a sua folha: trocar de espaço não leva uma folha aberta junto. */}
          <StaffClassesCard key={`aulas-${item.space.id}`} item={item} />
          <StaffBookingsCard key={`reservas-${item.space.id}`} item={item} />
          <SpaceInfoCard slug={item.space.slug} />

          <Text variant="muted" className="text-center">
            Visualização somente leitura. Para criar ou alterar reservas e aulas, use o painel no
            navegador.
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}

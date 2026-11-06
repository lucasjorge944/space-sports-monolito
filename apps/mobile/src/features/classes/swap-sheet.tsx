import { useGetSpaceClasses } from '@space-sports/api-client';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { GroupSummary } from './group-card';
import { groupsOverlap } from './selection';

export interface SwapTarget {
  slug: string;
  sportId: string;
  /** A turma de onde o aluno sai. */
  fromGroup: { id: string; name: string };
  /** As outras turmas ativas do plano (a nova não pode coincidir no horário com elas). */
  otherGroups: { id: string; weekday: number; startTime: string; durationMin: number }[];
}

/**
 * Trocar de turma (RF-CLASS-04): escolhe uma turma do mesmo esporte com vaga e fora dos outros
 * horários e só então confirma, pois a troca libera a vaga atual.
 */
export function SwapSheet({
  target,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  target: SwapTarget | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (toClassGroupId: string) => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const query = useGetSpaceClasses(target?.slug ?? '', { query: { enabled: target !== null } });
  const candidates =
    target && query.data
      ? query.data.classGroups.filter(
          (group) =>
            group.sport.id === target.sportId &&
            group.id !== target.fromGroup.id &&
            !target.otherGroups.some((other) => other.id === group.id),
        )
      : [];
  const picked = candidates.find((group) => group.id === pickedId);

  return (
    <BottomSheet
      visible={target !== null}
      title={target ? `Trocar ${target.fromGroup.name}` : 'Trocar turma'}
      onClose={onClose}
    >
      <Text variant="muted">
        Escolha a nova turma e confirme. A troca vale a partir de agora; a sua vaga na turma atual é
        liberada.
      </Text>
      {query.isPending ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      ) : candidates.length === 0 ? (
        <Text variant="muted" testID="plano-troca-vazio">
          Não há outra turma disponível para este plano agora.
        </Text>
      ) : (
        <View className="gap-2">
          {candidates.map((group) => {
            const overlaps = target?.otherGroups.some((other) => groupsOverlap(other, group));
            const blocked = group.availableSpots <= 0 || Boolean(overlaps);
            return (
              <Pressable
                key={group.id}
                testID={`plano-troca-turma-${group.id}`}
                role="button"
                accessibilityLabel={`Escolher ${group.name}`}
                accessibilityState={{ selected: group.id === pickedId }}
                disabled={blocked || pending}
                onPress={() => setPickedId(group.id)}
                className={cn(
                  'rounded-lg border bg-card p-3 active:bg-accent',
                  group.id === pickedId ? 'border-primary' : 'border-border',
                  (blocked || pending) && 'opacity-50',
                )}
              >
                <GroupSummary group={group} availableSpots={group.availableSpots} />
                {overlaps ? <Text variant="muted">Mesmo horário de outra turma sua</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}
      <InlineError message={error} />
      {candidates.length > 0 ? (
        <Button
          testID="plano-troca-confirmar"
          disabled={!picked || pending}
          onPress={() => picked && onConfirm(picked.id)}
        >
          <Text>
            {pending ? 'Trocando…' : picked ? `Trocar para ${picked.name}` : 'Escolha uma turma'}
          </Text>
        </Button>
      ) : null}
    </BottomSheet>
  );
}

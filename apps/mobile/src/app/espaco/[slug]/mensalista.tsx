import { useGetSpaceBySlug, useRequestRecurringBooking } from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/screen-header';
import { EmptyView, ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { ChipRow, Step } from '@/features/booking/section';
import { clampPeople, defaultPeople, durationOptions } from '@/features/booking/slots';
import { Stepper } from '@/features/booking/stepper';
import { openWeekdays, startTimesFor } from '@/features/recurring/times';
import { errorMessage } from '@/lib/api-errors';
import { formatDuration, WEEKDAY_NAMES } from '@/lib/datetime';

/**
 * Solicitar mensalista (RF-BOOK-05): dia da semana + horário + quadra + duração. O espaço aprova
 * e o horário fica reservado; o jogador acompanha o status em "Meus mensalistas".
 */
export default function MensalistaScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useGetSpaceBySlug(slug, { query: { staleTime: 60_000 } });
  const space = query.data;

  const [sportSlug, setSportSlug] = useState<string | null>(null);
  const [courtId, setCourtId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [people, setPeople] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useRequestRecurringBooking({
    mutation: {
      onSuccess: (recurring) => {
        void queryClient.invalidateQueries({ queryKey: ['/v1/recurring-bookings'] });
        router.replace({ pathname: '/mensalistas/[id]', params: { id: recurring.id, nova: '1' } });
      },
      onError: (error) => setNotice(errorMessage(error)),
    },
  });

  const effectiveSport =
    sportSlug ?? (space?.sports.length === 1 ? (space.sports[0]?.slug ?? null) : null);
  const courts = useMemo(
    () => space?.courts.filter((c) => c.sports.some((s) => s.slug === effectiveSport)) ?? [],
    [space, effectiveSport],
  );
  const court =
    courts.find((c) => c.id === courtId) ?? (courts.length === 1 ? courts[0] : undefined);
  const sportInfo = court?.sports.find((s) => s.slug === effectiveSport);
  const effectiveDuration = durationMin ?? space?.rental.minDurationMin ?? 60;
  const days = useMemo(() => (space ? openWeekdays(space.openingHours) : []), [space]);
  const times = useMemo(
    () =>
      space && weekday !== null
        ? startTimesFor(space.openingHours, weekday, effectiveDuration)
        : [],
    [space, weekday, effectiveDuration],
  );

  if (query.isPending)
    return (
      <Shell>
        <LoadingView />
      </Shell>
    );
  if (query.isError || !space) {
    return (
      <Shell>
        <ErrorView error={query.error} onRetry={() => void query.refetch()} />
      </Shell>
    );
  }
  if (space.courts.length === 0 || days.length === 0) {
    return (
      <Shell>
        <EmptyView
          title="Indisponível"
          description="Este espaço ainda não definiu quadras e horários."
        />
      </Shell>
    );
  }

  const maxPlayers = sportInfo?.maxPlayers ?? 1;
  const peopleCount = clampPeople(people ?? defaultPeople(maxPlayers), maxPlayers);
  const ready = Boolean(sportInfo && court && weekday !== null && startTime && !request.isPending);

  const submit = () => {
    if (!(sportInfo && court && weekday !== null && startTime)) return;
    setNotice(null);
    request.mutate({
      data: {
        spaceId: space.id,
        courtId: court.id,
        sportId: sportInfo.sportId,
        weekday,
        startTime,
        durationMin: effectiveDuration,
        peopleCount,
      },
    });
  };

  return (
    <Shell title={`Mensalista · ${space.name}`}>
      <ScrollView contentContainerClassName="gap-6 p-4 pb-8">
        <Text variant="muted">
          Um horário fixo toda semana. O espaço analisa o pedido e, aprovado, o horário fica
          reservado para você. Você pode encerrar quando quiser.
        </Text>
        {space.sports.length > 1 ? (
          <Step title="Esporte">
            <ChipRow label="Esporte">
              {space.sports.map((s) => (
                <Chip
                  key={s.slug}
                  selected={effectiveSport === s.slug}
                  onPress={() => {
                    setSportSlug(s.slug);
                    setCourtId(null);
                  }}
                >
                  <Text>{s.name}</Text>
                </Chip>
              ))}
            </ChipRow>
          </Step>
        ) : null}
        {effectiveSport ? (
          <>
            <Step title="Quadra">
              <ChipRow label="Quadra">
                {courts.map((c) => (
                  <Chip key={c.id} selected={court?.id === c.id} onPress={() => setCourtId(c.id)}>
                    <Text>{c.name}</Text>
                  </Chip>
                ))}
              </ChipRow>
            </Step>
            <Step title="Dia da semana">
              <ChipRow label="Dia da semana">
                {days.map((d) => (
                  <Chip
                    key={d}
                    selected={weekday === d}
                    onPress={() => {
                      setWeekday(d);
                      setStartTime(null);
                    }}
                  >
                    <Text>{WEEKDAY_NAMES[d]}</Text>
                  </Chip>
                ))}
              </ChipRow>
            </Step>
            <Step title="Duração">
              <ChipRow label="Duração">
                {durationOptions(space.rental.minDurationMin, space.rental.maxDurationMin).map(
                  (d) => (
                    <Chip
                      key={d}
                      selected={effectiveDuration === d}
                      onPress={() => {
                        setDurationMin(d);
                        setStartTime(null);
                      }}
                    >
                      <Text>{formatDuration(d)}</Text>
                    </Chip>
                  ),
                )}
              </ChipRow>
            </Step>
            {weekday !== null ? (
              <Step title="Horário">
                {times.length === 0 ? (
                  <Text variant="muted">Nenhum horário cabe nessa duração neste dia.</Text>
                ) : (
                  <ChipRow label="Horário">
                    {times.map((t) => (
                      <Chip
                        key={t}
                        shape="slot"
                        selected={startTime === t}
                        onPress={() => setStartTime(t)}
                      >
                        <Text className="tabular-nums">{t}</Text>
                      </Chip>
                    ))}
                  </ChipRow>
                )}
              </Step>
            ) : null}
            {court ? (
              <Step title={`Quantas pessoas? (até ${maxPlayers})`}>
                <Stepper
                  label="Número de pessoas"
                  value={peopleCount}
                  min={1}
                  max={maxPlayers}
                  onChange={setPeople}
                />
              </Step>
            ) : null}
          </>
        ) : (
          <Text variant="muted">Escolha o esporte para continuar.</Text>
        )}
        {ready && weekday !== null ? (
          <Card>
            <Text variant="small">Resumo</Text>
            <Text>
              Toda {WEEKDAY_NAMES[weekday]?.toLowerCase()}, às {startTime} (
              {formatDuration(effectiveDuration)})
            </Text>
            <Text variant="muted">{court?.name}</Text>
          </Card>
        ) : null}
        <InlineError message={notice} />
        <Button size="lg" disabled={!ready} onPress={submit}>
          <Text>{request.isPending ? 'Enviando…' : 'Enviar solicitação'}</Text>
        </Button>
      </ScrollView>
    </Shell>
  );
}

function Shell({ title = 'Mensalista', children }: { title?: string; children: React.ReactNode }) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
  );
}

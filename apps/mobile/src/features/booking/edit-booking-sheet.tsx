import {
  type PlayerBookingDetailDto,
  type PublicSpace,
  useGetSpaceAvailability,
  useUpdateMyBooking,
} from '@space-sports/api-client';
import { formatCents, utcToZoned } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { ErrorView, InlineError, LoadingView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { errorMessage, isSlotUnavailable } from '@/lib/api-errors';
import {
  bookingDates,
  formatBookingWhen,
  formatDayCompact,
  formatDayShort,
  formatDuration,
  formatTime,
  todayIn,
} from '@/lib/datetime';
import {
  editChanges,
  editDates,
  editPreview,
  editTimeOptions,
  minPeople,
  shouldTalkToSpace,
} from './edit';
import { ChipRow, Step } from './section';
import { durationOptions, timeOptions } from './slots';
import { Stepper } from './stepper';
import { TalkToSpace } from './talk-to-space';

type Booking = PlayerBookingDetailDto;

function differenceLabel(differenceCents: number): string {
  if (differenceCents === 0) return 'Sem mudança';
  return `${differenceCents > 0 ? '+' : '−'}${formatCents(Math.abs(differenceCents))}`;
}

function ScheduleFields({
  booking,
  space,
  date,
  durationMin,
  startsAt,
  onDate,
  onDuration,
  onStartsAt,
}: {
  booking: Booking;
  space: PublicSpace;
  date: string;
  durationMin: number;
  startsAt: string | null;
  onDate: (date: string) => void;
  onDuration: (durationMin: number) => void;
  onStartsAt: (startsAt: string | null) => void;
}) {
  const timeZone = booking.space.timeZone;
  const today = todayIn(timeZone);
  const dates = useMemo(
    () =>
      editDates(
        bookingDates(space.rental.windowDays, timeZone),
        utcToZoned(new Date(booking.startsAt), timeZone).date,
      ),
    [space.rental.windowDays, timeZone, booking.startsAt],
  );
  const durations = durationOptions(space.rental.minDurationMin, space.rental.maxDurationMin);
  // Durações fora dos limites atuais do espaço: a da reserva continua aparecendo.
  const durationChoices = durations.includes(booking.durationMin)
    ? durations
    : [...durations, booking.durationMin].sort((a, b) => a - b);

  const availability = useGetSpaceAvailability(
    space.id,
    {
      date,
      durationMin,
      sportId: booking.sport.id,
      courtId: booking.court.id,
      excludeBookingId: booking.id,
    },
    { query: { staleTime: 15_000 } },
  );
  const options = useMemo(
    () =>
      availability.data
        ? editTimeOptions(timeOptions(availability.data), booking, date, durationMin, timeZone)
        : [],
    [availability.data, booking, date, durationMin, timeZone],
  );

  // O horário escolhido saiu da grade (outra data ou duração, ou alguém ocupou): pede nova escolha.
  useEffect(() => {
    if (availability.data && startsAt && !options.some((o) => o.startsAt === startsAt)) {
      onStartsAt(null);
    }
  }, [availability.data, options, startsAt, onStartsAt]);

  return (
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
              testID={`editar-data-${d}`}
              selected={date === d}
              accessibilityLabel={formatDayShort(d)}
              onPress={() => onDate(d)}
            >
              <Text>{d === today ? 'Hoje' : formatDayCompact(d)}</Text>
            </Chip>
          ))}
        </ScrollView>
      </Step>

      <Step title="Duração">
        <ChipRow label="Duração">
          {durationChoices.map((d) => (
            <Chip
              key={d}
              testID={`editar-duracao-${d}`}
              selected={durationMin === d}
              onPress={() => onDuration(d)}
            >
              <Text>{formatDuration(d)}</Text>
            </Chip>
          ))}
        </ChipRow>
      </Step>

      <Step title="Horário">
        {availability.isPending ? (
          <LoadingView label="Buscando horários…" />
        ) : availability.isError ? (
          <ErrorView error={availability.error} onRetry={() => void availability.refetch()} />
        ) : options.length === 0 ? (
          <Text variant="muted" testID="editar-sem-horarios">
            Nenhum horário livre em {booking.court.name} neste dia para{' '}
            {formatDuration(durationMin)}. Tente outra data ou duração.
          </Text>
        ) : (
          <ChipRow label="Horário">
            {options.map((option) => (
              <Chip
                key={option.startsAt}
                shape="slot"
                testID={`editar-horario-${formatTime(option.startsAt, timeZone)}`}
                selected={startsAt === option.startsAt}
                onPress={() => onStartsAt(option.startsAt)}
              >
                <Text className="tabular-nums">{formatTime(option.startsAt, timeZone)}</Text>
              </Chip>
            ))}
          </ChipRow>
        )}
      </Step>
    </>
  );
}

function PriceSummary({
  booking,
  peopleCount,
  durationMin,
  startsAt,
}: {
  booking: Booking;
  peopleCount: number;
  durationMin: number;
  startsAt: string | null;
}) {
  const preview = editPreview(booking, peopleCount, durationMin);
  const endsAt = startsAt
    ? new Date(new Date(startsAt).getTime() + durationMin * 60_000).toISOString()
    : null;
  return (
    <Card testID="editar-resumo">
      <Text variant="small">Como fica</Text>
      {startsAt && endsAt ? (
        <Text>{formatBookingWhen(startsAt, endsAt, booking.space.timeZone)}</Text>
      ) : (
        <Text variant="muted">Escolha um horário.</Text>
      )}
      <Text variant="muted">
        {booking.court.name} · {peopleCount} {peopleCount === 1 ? 'pessoa' : 'pessoas'}
      </Text>
      <View className="flex-row items-center justify-between">
        <Text variant="muted">Novo total ({formatDuration(durationMin)})</Text>
        <Text variant="large" className="tabular-nums" testID="editar-total">
          {formatCents(preview.priceCents)}
        </Text>
      </View>
      <View className="flex-row items-center justify-between">
        <Text variant="muted">Diferença</Text>
        <Text className="font-medium tabular-nums" testID="editar-diferenca">
          {differenceLabel(preview.differenceCents)}
        </Text>
      </View>
      {peopleCount > 1 ? (
        <>
          <View className="flex-row items-center justify-between">
            <Text variant="muted">Parte de cada pessoa</Text>
            <Text className="font-medium tabular-nums" testID="editar-parte">
              {formatCents(preview.shareCents)}
            </Text>
          </View>
          {preview.organizerShareCents !== preview.shareCents ? (
            <Text variant="muted">
              Sua parte: {formatCents(preview.organizerShareCents)}, com a diferença do
              arredondamento.
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function EditForm({
  booking,
  space,
  onSaved,
  onFailed,
}: {
  booking: Booking;
  space: PublicSpace;
  onSaved: (updated: Booking) => void;
  /** Recusa do servidor: o estado da reserva pode ter mudado. */
  onFailed: () => void;
}) {
  const timeZone = booking.space.timeZone;
  const queryClient = useQueryClient();
  const bookingDate = utcToZoned(new Date(booking.startsAt), timeZone).date;
  const [people, setPeople] = useState(booking.peopleCount);
  const [date, setDate] = useState(bookingDate);
  const [durationMin, setDurationMin] = useState(booking.durationMin);
  const [startsAt, setStartsAt] = useState<string | null>(booking.startsAt);
  const [notice, setNotice] = useState<string | null>(null);

  const maxPlayers = space.courts
    .find((court) => court.id === booking.court.id)
    ?.sports.find((sport) => sport.sportId === booking.sport.id)?.maxPlayers;
  const min = minPeople(booking.participants);
  // Sem a capacidade da quadra, só deixa diminuir: a API continua sendo a regra.
  const max = Math.max(maxPlayers ?? booking.peopleCount, min, booking.peopleCount);

  const refreshGrid = () =>
    queryClient.invalidateQueries({ queryKey: [`/v1/spaces/${space.id}/availability`] });
  const update = useUpdateMyBooking({
    mutation: {
      onSuccess: (updated) => {
        void refreshGrid();
        onSaved(updated);
      },
      onError: (error) => {
        setNotice(errorMessage(error));
        if (isSlotUnavailable(error)) {
          // Outra pessoa levou o horário: volta à escolha com a grade atualizada.
          setStartsAt(null);
          void refreshGrid();
        }
        onFailed();
      },
    },
  });

  // Permissão retirada com a folha aberta (recarga): o valor volta a ser o da reserva.
  const draft = {
    peopleCount: booking.canEditPeople ? people : booking.peopleCount,
    startsAt: booking.canEditSchedule ? startsAt : booking.startsAt,
    durationMin: booking.canEditSchedule ? durationMin : booking.durationMin,
  };
  const changes = editChanges(booking, draft);
  const dirty = Object.keys(changes).length > 0;

  const confirm = () => {
    setNotice(null);
    update.mutate({ bookingId: booking.id, data: changes });
  };

  return (
    <>
      {booking.canEditPeople ? (
        <Step title={`Quantas pessoas? (até ${max})`}>
          <Stepper
            testID="editar-pessoas"
            label="Número de pessoas"
            value={people}
            min={min}
            max={max}
            onChange={(value) => {
              setPeople(value);
              setNotice(null);
            }}
          />
          {min > 1 ? (
            <Text variant="muted">O mínimo é {min}: você e os convidados que não recusaram.</Text>
          ) : null}
        </Step>
      ) : booking.peopleEditBlock ? (
        <Text variant="muted" testID="editar-bloqueio-pessoas">
          {booking.peopleEditBlock.message}
        </Text>
      ) : null}

      {booking.canEditSchedule ? (
        <ScheduleFields
          booking={booking}
          space={space}
          date={date}
          durationMin={durationMin}
          startsAt={startsAt}
          onDate={(next) => {
            setDate(next);
            setStartsAt(null);
            setNotice(null);
          }}
          onDuration={(next) => {
            setDurationMin(next);
            setNotice(null);
          }}
          onStartsAt={(next) => {
            setStartsAt(next);
            if (next) setNotice(null);
          }}
        />
      ) : booking.scheduleEditBlock ? (
        <View className="gap-2">
          <Text variant="muted" testID="editar-bloqueio-horario">
            {booking.scheduleEditBlock.message}
          </Text>
          {shouldTalkToSpace(booking.scheduleEditBlock.code) ? (
            <TalkToSpace whatsapp={space.whatsapp} />
          ) : null}
        </View>
      ) : null}

      <PriceSummary booking={booking} {...draft} />

      <InlineError message={notice} />
      <Button
        testID="editar-confirmar"
        size="lg"
        disabled={!dirty || draft.startsAt === null || update.isPending}
        onPress={confirm}
      >
        <Text>{update.isPending ? 'Salvando…' : 'Confirmar alteração'}</Text>
      </Button>
    </>
  );
}

/**
 * Editar a reserva (RF-BOOK-03, RN-BOOK-10 a 13, decisão 49): pessoas e, se permitido, data, horário
 * e duração, com a grade que ignora a própria reserva. A quadra não muda. O formulário só existe com
 * a folha aberta: cada abertura parte da reserva atual e não busca horários à toa.
 */
export function EditBookingSheet({
  visible,
  booking,
  space,
  onClose,
  onSaved,
  onFailed,
}: {
  visible: boolean;
  booking: Booking;
  space: { data?: PublicSpace; error: unknown; isError: boolean; refetch: () => unknown };
  onClose: () => void;
  onSaved: (updated: Booking) => void;
  onFailed: () => void;
}) {
  return (
    <BottomSheet visible={visible} title="Editar reserva" onClose={onClose}>
      {space.data ? (
        <EditForm booking={booking} space={space.data} onSaved={onSaved} onFailed={onFailed} />
      ) : space.isError ? (
        <ErrorView error={space.error} onRetry={() => void space.refetch()} />
      ) : (
        <LoadingView />
      )}
    </BottomSheet>
  );
}

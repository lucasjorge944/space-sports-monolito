'use client';

import {
  type Court,
  useCreateDeskRecurringBooking,
  useGetManagedSpace,
  useGetSpaceSettings,
} from '@space-sports/api-client';
import { normalizePhone } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { durationOptions, timeOptions } from '@/components/painel/agenda/time-options';
import { Field } from '@/components/painel/field';
import type { SpaceScope } from '@/components/painel/space-scope';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select-menu';
import { formatDuration, todayLocal } from '@/lib/format';
import { gridRange, minutesToLabel } from '@/lib/painel/agenda';
import { apiErrorMessage } from '@/lib/painel/errors';
import { WEEKDAY_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { focusFirstInvalid } from '@/lib/utils';

/** Cadastro direto de mensalista pela gestão: nasce ativo (RF-BOOK-05). */
export function RecurringDeskDialog({
  scope,
  courts,
  open,
  onClose,
}: {
  scope: SpaceScope;
  courts: Court[];
  open: boolean;
  onClose: () => void;
}) {
  // O formulário só existe com o diálogo aberto, então abrir de novo reinicia os campos.
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {open ? <Form scope={scope} courts={courts} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  scope,
  courts,
  onClose,
}: {
  scope: SpaceScope;
  courts: Court[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const settings = useGetSpaceSettings(scope.spaceId);
  const space = useGetManagedSpace(scope.spaceId);
  const bookable = courts.filter((c) => c.status === 'ACTIVE');

  const [courtId, setCourtId] = useState(bookable[0]?.id ?? '');
  const [sportId, setSportId] = useState(bookable[0]?.sports[0]?.sportId ?? '');
  const [weekday, setWeekday] = useState('1');
  const [startMin, setStartMin] = useState('1140');
  const [duration, setDuration] = useState('60');
  const [people, setPeople] = useState('10');
  const [startsOn, setStartsOn] = useState(todayLocal());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateDeskRecurringBooking();

  // As quadras podem chegar depois de o diálogo abrir.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só reage à chegada das quadras
  useEffect(() => {
    if (!courtId && bookable[0]) {
      setCourtId(bookable[0].id);
      setSportId(bookable[0].sports[0]?.sportId ?? '');
    }
  }, [courtId, bookable.length]);

  const court = bookable.find((c) => c.id === courtId);
  const sport = court?.sports.find((s) => s.sportId === sportId);
  const range = gridRange(space.data?.openingHours ?? [], [Number(weekday)]);
  const starts = timeOptions(range.startMin, range.endMin);
  const durations = durationOptions(
    settings.data?.bookingMinDurationMin ?? 60,
    settings.data?.bookingMaxDurationMin ?? 180,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const e164 = normalizePhone(phone);
    const count = Number(people);
    if (!court || !sport) next.court = 'Escolha a quadra e o esporte';
    if (name.trim().length < 2) next.name = 'Informe o nome do cliente';
    if (!e164) next.phone = 'Informe o telefone com DDD';
    if (!Number.isInteger(count) || count < 1) next.people = 'Informe a quantidade de pessoas';
    else if (sport && count > sport.maxPlayers) {
      next.people = `Essa quadra comporta até ${sport.maxPlayers} pessoas para ${sport.name}`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !court || !sport || !e164) {
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);
    }

    create.mutate(
      {
        spaceId: scope.spaceId,
        data: {
          courtId: court.id,
          sportId: sport.sportId,
          weekday: Number(weekday),
          startTime: minutesToLabel(Number(startMin)),
          durationMin: Number(duration),
          peopleCount: count,
          startsOn,
          guestName: name.trim(),
          guestPhone: e164,
        },
      },
      {
        onSuccess: () => {
          toast.success('Mensalista cadastrado.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Cadastrar mensalista</DialogTitle>
        <DialogDescription>
          Horário fixo semanal. O mensalista já nasce ativo e as próximas 4 semanas são reservadas.
        </DialogDescription>
      </DialogHeader>
      <FormError message={create.error ? apiErrorMessage(create.error) : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quadra" htmlFor="rec-court" error={errors.court}>
          <Select
            value={courtId}
            onValueChange={(v) => {
              setCourtId(v);
              setSportId(bookable.find((c) => c.id === v)?.sports[0]?.sportId ?? '');
            }}
          >
            <SelectTrigger id="rec-court" className="w-full">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {bookable.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Esporte" htmlFor="rec-sport">
          <Select value={sportId} onValueChange={setSportId}>
            <SelectTrigger id="rec-sport" className="w-full">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {(court?.sports ?? []).map((s) => (
                <SelectItem key={s.sportId} value={s.sportId}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Dia da semana" htmlFor="rec-weekday">
          <Select value={weekday} onValueChange={setWeekday}>
            <SelectTrigger id="rec-weekday" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_LABEL.map((label, i) => (
                <SelectItem key={label} value={String(i)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Início" htmlFor="rec-start">
          <Select value={startMin} onValueChange={setStartMin}>
            <SelectTrigger id="rec-start" className="w-full tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {starts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Duração" htmlFor="rec-duration">
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger id="rec-duration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durations.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {formatDuration(Number(o.value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Pessoas"
          htmlFor="rec-people"
          error={errors.people}
          hint={sport ? `Até ${sport.maxPlayers} nesta quadra` : undefined}
        >
          <MaskedInput
            mask="integer"
            id="rec-people"
            maxLength={3}
            value={people}
            onValueChange={setPeople}
          />
        </Field>
        <Field label="Começa em" htmlFor="rec-starts-on">
          <DatePicker
            id="rec-starts-on"
            min={todayLocal()}
            value={startsOn}
            onValueChange={setStartsOn}
          />
        </Field>
        <div />
        <Field label="Nome do cliente" htmlFor="rec-name" error={errors.name}>
          <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Telefone (WhatsApp)"
          htmlFor="rec-phone"
          error={errors.phone}
          hint="Serve para reconhecer o cliente depois: se ele tiver conta, você pode vincular o mensalista a ela."
        >
          <MaskedInput mask="phone" id="rec-phone" value={phone} onValueChange={setPhone} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
          Voltar
        </Button>
        <Button type="submit" disabled={create.isPending || bookable.length === 0}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Cadastrar
        </Button>
      </DialogFooter>
    </form>
  );
}

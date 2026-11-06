'use client';

import {
  type Court,
  calculateBookingPriceCents,
  type PaymentMethod,
  useCreateDeskBooking,
  useGetManagedSpace,
  useGetSpaceSettings,
} from '@space-sports/api-client';
import { normalizePhone, weekdayOf } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
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
import { formatDuration, formatMoney } from '@/lib/format';
import { gridRange, localToIso } from '@/lib/painel/agenda';
import { apiErrorMessage } from '@/lib/painel/errors';
import { PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { focusFirstInvalid } from '@/lib/utils';
import { durationOptions, timeOptions } from './time-options';

export type DeskDraft = { courtId?: string; date: string; startMin?: number };

const NO_METHOD = 'none';

/** Reserva de balcão: cliente com ou sem app, nome + telefone (RF-BOOK-06). */
export function DeskBookingDialog({
  scope,
  courts,
  draft,
  onClose,
}: {
  scope: SpaceScope;
  courts: Court[];
  draft: DeskDraft | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const settings = useGetSpaceSettings(scope.spaceId);
  const space = useGetManagedSpace(scope.spaceId);
  const bookable = courts.filter((c) => c.status === 'ACTIVE');

  const [courtId, setCourtId] = useState('');
  const [sportId, setSportId] = useState('');
  const [date, setDate] = useState('');
  const [startMin, setStartMin] = useState('600');
  const [duration, setDuration] = useState('60');
  const [people, setPeople] = useState('2');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<string>(NO_METHOD);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateDeskBooking();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia o formulário só quando o diálogo abre
  useEffect(() => {
    if (!draft) return;
    const court = bookable.find((c) => c.id === draft.courtId) ?? bookable[0];
    setCourtId(court?.id ?? '');
    setSportId(court?.sports[0]?.sportId ?? '');
    setDate(draft.date);
    setStartMin(String(draft.startMin ?? 600));
    setDuration(String(settings.data?.bookingMinDurationMin ?? 60));
    setPeople('2');
    setName('');
    setPhone('');
    setMethod(NO_METHOD);
    setErrors({});
    create.reset();
  }, [draft]);

  // As quadras podem chegar depois de o diálogo abrir: completa a quadra/esporte padrão sem apagar o resto.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só reage à chegada das quadras
  useEffect(() => {
    if (draft && !courtId && bookable[0]) {
      setCourtId(bookable[0].id);
      setSportId(bookable[0].sports[0]?.sportId ?? '');
    }
  }, [draft, courtId, bookable.length]);

  const court = bookable.find((c) => c.id === courtId);
  const sport = court?.sports.find((s) => s.sportId === sportId);

  const starts = useMemo(() => {
    if (!date) return [];
    const range = gridRange(space.data?.openingHours ?? [], [weekdayOf(date)]);
    return timeOptions(range.startMin, range.endMin);
  }, [date, space.data?.openingHours]);

  const durations = durationOptions(
    settings.data?.bookingMinDurationMin ?? 60,
    settings.data?.bookingMaxDurationMin ?? 180,
  );
  const price =
    settings.data?.pricePerHourCents != null
      ? calculateBookingPriceCents(settings.data.pricePerHourCents, Number(duration))
      : null;
  const methods: PaymentMethod[] = settings.data?.acceptedPaymentMethods ?? ['PIX', 'CARD', 'CASH'];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const e164 = normalizePhone(phone);
    const count = Number(people);
    if (!court || !sport) next.court = 'Escolha a quadra e o esporte';
    if (name.trim().length < 2) next.name = 'Informe o nome do cliente';
    if (!e164) next.phone = 'Informe o telefone com DDD';
    if (!Number.isInteger(count) || count < 1) next.people = 'Informe quantas pessoas vão jogar';
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
          startsAt: localToIso(date, Number(startMin)),
          durationMin: Number(duration),
          peopleCount: count,
          guestName: name.trim(),
          guestPhone: e164,
          ...(method !== NO_METHOD ? { intendedPaymentMethod: method as PaymentMethod } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Reserva de balcão criada.');
          void invalidateSpace(queryClient, scope.spaceId);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Reserva de balcão</DialogTitle>
            <DialogDescription>
              Cliente com ou sem o app. A reserva nasce confirmada.
            </DialogDescription>
          </DialogHeader>
          <FormError message={create.error ? apiErrorMessage(create.error) : undefined} />
          <FormError
            message={
              bookable.length === 0
                ? 'Nenhuma quadra ativa. Cadastre ou reative uma quadra em Espaço → Quadras.'
                : undefined
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quadra" htmlFor="desk-court" error={errors.court}>
              <Select
                value={courtId}
                onValueChange={(v) => {
                  setCourtId(v);
                  setSportId(bookable.find((c) => c.id === v)?.sports[0]?.sportId ?? '');
                }}
              >
                <SelectTrigger id="desk-court" className="w-full">
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
            <Field label="Esporte" htmlFor="desk-sport">
              <Select value={sportId} onValueChange={setSportId}>
                <SelectTrigger id="desk-sport" className="w-full">
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
            <Field label="Data" htmlFor="desk-date">
              <DatePicker id="desk-date" value={date} onValueChange={setDate} />
            </Field>
            <Field label="Início" htmlFor="desk-start">
              <Select value={startMin} onValueChange={setStartMin}>
                <SelectTrigger id="desk-start" className="w-full tabular-nums">
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
            <Field label="Duração" htmlFor="desk-duration">
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="desk-duration" className="w-full">
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
              htmlFor="desk-people"
              error={errors.people}
              hint={sport ? `Até ${sport.maxPlayers} nesta quadra` : undefined}
            >
              <MaskedInput
                mask="integer"
                id="desk-people"
                maxLength={3}
                value={people}
                onValueChange={setPeople}
              />
            </Field>
            <Field label="Nome do cliente" htmlFor="desk-name" error={errors.name}>
              <Input id="desk-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Telefone (WhatsApp)"
              htmlFor="desk-phone"
              error={errors.phone}
              hint="Serve para reconhecer o cliente depois: se ele tiver conta, você pode vincular a reserva a ela."
            >
              <MaskedInput mask="phone" id="desk-phone" value={phone} onValueChange={setPhone} />
            </Field>
            <Field label="Forma de pagamento prevista" htmlFor="desk-method">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="desk-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_METHOD}>Não informar</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {price != null ? (
            <p className="text-sm tabular-nums">
              Valor da reserva: <strong>{formatMoney(price)}</strong>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Defina o preço por hora em Espaço → Configurações para ver o valor.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Voltar
            </Button>
            <Button type="submit" disabled={create.isPending || bookable.length === 0}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Criar reserva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

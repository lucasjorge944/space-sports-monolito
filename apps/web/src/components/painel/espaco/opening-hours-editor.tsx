'use client';

import { type OpeningHour, useReplaceSpaceOpeningHours } from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import type { SpaceScope } from '@/components/painel/space-scope';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TimeInput } from '@/components/ui/time-input';
import { apiErrorMessage } from '@/lib/painel/errors';
import { WEEKDAY_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import { copyDayHours, hoursOfDay, validateOpeningHours } from '@/lib/painel/space-data';

type Row = OpeningHour & { uid: number };

/** Horário de funcionamento: um ou mais intervalos por dia; fechar até a madrugada atravessa a meia-noite. */
export function OpeningHoursEditor({
  scope,
  initial,
}: {
  scope: SpaceScope;
  initial: OpeningHour[];
}) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('space.edit');
  // `uid` dá chave estável a cada intervalo: sem ele o campo perderia o foco a cada tecla.
  const nextUid = useRef(0);
  const withUid = (h: OpeningHour): Row => ({ ...h, uid: nextUid.current++ });
  const [hours, setHours] = useState<Row[]>(() => initial.map(withUid));
  const [error, setError] = useState<string>();
  const save = useReplaceSpaceOpeningHours();

  const update = (uid: number, patch: Partial<OpeningHour>) =>
    setHours((list) => list.map((h) => (h.uid === uid ? { ...h, ...patch } : h)));

  function submit() {
    const problem = validateOpeningHours(hours);
    setError(problem ?? undefined);
    if (problem) return;
    save.mutate(
      {
        spaceId: scope.spaceId,
        data: {
          openingHours: hours.map(({ weekday, opensAt, closesAt }) => ({
            weekday,
            opensAt,
            closesAt,
          })),
        },
      },
      {
        onSuccess: () => {
          toast.success('Horário de funcionamento salvo.');
          void invalidateSpace(queryClient, scope.spaceId);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Horário de funcionamento</CardTitle>
        <CardDescription>
          Define os horários em que a quadra pode ser reservada. Dia sem intervalo = fechado. Para
          fechar depois da meia-noite, use um horário de fechamento menor que o de abertura.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {WEEKDAY_LABEL.map((label, weekday) => {
          const day = hoursOfDay(hours, weekday);
          return (
            <div
              key={label}
              className="flex flex-wrap items-center gap-3 border-b pb-3 last:border-b-0"
            >
              <span className="w-24 text-sm font-medium">{label}</span>
              <div className="flex flex-1 flex-col gap-2">
                {day.length === 0 ? (
                  <span className="text-muted-foreground text-sm">Fechado</span>
                ) : null}
                {day.map((h) => (
                  <div key={h.uid} className="flex items-center gap-2">
                    <TimeInput
                      aria-label={`${label}: abre`}
                      className="w-24"
                      disabled={!editable}
                      value={h.opensAt}
                      onValueChange={(opensAt) => update(h.uid, { opensAt })}
                    />
                    <span className="text-muted-foreground text-sm">às</span>
                    <TimeInput
                      aria-label={`${label}: fecha`}
                      className="w-24"
                      disabled={!editable}
                      value={h.closesAt}
                      onValueChange={(closesAt) => update(h.uid, { closesAt })}
                    />
                    {editable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover intervalo de ${label}`}
                        onClick={() => setHours((list) => list.filter((x) => x.uid !== h.uid))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              {editable ? (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setHours((list) => [
                        ...list,
                        withUid({ weekday, opensAt: '08:00', closesAt: '22:00' }),
                      ])
                    }
                  >
                    <Plus /> Intervalo
                  </Button>
                  {day.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="Copiar para os outros dias"
                      onClick={() =>
                        setHours((list) =>
                          copyDayHours(
                            list,
                            weekday,
                            [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday),
                          ).map(withUid),
                        )
                      }
                    >
                      <Copy /> Copiar p/ todos
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <FormError message={error} />
        <FormError message={save.error ? apiErrorMessage(save.error) : undefined} />
        {editable ? (
          <Button className="w-fit" onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Salvar horário
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

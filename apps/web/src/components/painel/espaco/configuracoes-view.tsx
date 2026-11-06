'use client';

import {
  type PaymentMethod,
  type SpaceSettings,
  useGetSpaceSettings,
  useUpdateSpaceSettings,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Hand, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { Field } from '@/components/painel/field';
import { type OptionCard, OptionCards } from '@/components/painel/option-cards';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { TimeSpanField } from '@/components/painel/time-span-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MaskedInput } from '@/components/ui/masked-input';
import { apiErrorMessage } from '@/lib/painel/errors';
import { ATTENDANCE_MODE_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/painel/labels';
import { invalidateSpace } from '@/lib/painel/query';
import {
  draftFromSettings,
  type SettingsDraft,
  settingsFromDraft,
} from '@/lib/painel/settings-form';
import { attendanceCancelSummary, attendanceWindowSummary } from '@/lib/painel/time-span';
import { focusFirstInvalid } from '@/lib/utils';

export function ConfiguracoesView() {
  return (
    <SpaceGate permission="schedule.view">{(scope) => <Configuracoes scope={scope} />}</SpaceGate>
  );
}

function Configuracoes({ scope }: { scope: SpaceScope }) {
  const query = useGetSpaceSettings(scope.spaceId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações"
        description="Preço, regras de reserva e formas de pagamento aceitas no local."
      />
      <ReadOnlyNotice scope={scope} />
      {query.isPending ? (
        <LoadingBlock rows={5} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <SettingsForm scope={scope} settings={query.data} />
      )}
    </div>
  );
}

const METHODS: PaymentMethod[] = ['PIX', 'CARD', 'CASH'];

const ATTENDANCE_MODES: OptionCard<SettingsDraft['attendanceMode']>[] = [
  {
    value: 'AUTOMATIC',
    label: ATTENDANCE_MODE_LABEL.AUTOMATIC,
    description: 'A lista abre e fecha sozinha, no tempo que você definir antes de cada aula.',
    icon: CalendarClock,
  },
  {
    value: 'MANUAL',
    label: ATTENDANCE_MODE_LABEL.MANUAL,
    description: 'A lista só abre e fecha quando a gestão ou o professor mandar, aula por aula.',
    icon: Hand,
  },
];

function SettingsForm({ scope, settings }: { scope: SpaceScope; settings: SpaceSettings }) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('settings.manage');
  const save = useUpdateSpaceSettings();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromSettings(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = settingsFromDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return focusFirstInvalid(event.currentTarget as HTMLFormElement);
    }
    setErrors({});
    save.mutate(
      { spaceId: scope.spaceId, data: result.data },
      {
        onSuccess: () => {
          toast.success('Configurações salvas.');
          void invalidateSpace(queryClient, scope.spaceId);
        },
      },
    );
  }

  const text = (
    key: keyof SettingsDraft,
    label: string,
    opts?: { hint?: string; money?: boolean },
  ) => (
    <Field label={label} htmlFor={`cfg-${key}`} error={errors[key]} hint={opts?.hint}>
      <MaskedInput
        mask={opts?.money ? 'money' : 'integer'}
        id={`cfg-${key}`}
        disabled={!editable}
        value={draft[key] as string}
        onValueChange={(v) => set(key, v as never)}
      />
    </Field>
  );

  const deadline = (
    key: keyof SettingsDraft,
    label: string,
    opts: { zeroLabel: string; hint?: string },
  ) => (
    <TimeSpanField
      label={label}
      value={draft[key] as string}
      onChange={(minutes) => set(key, minutes as never)}
      disabled={!editable}
      error={errors[key]}
      {...opts}
    />
  );

  const automatic = draft.attendanceMode === 'AUTOMATIC';
  const summary = [
    automatic
      ? attendanceWindowSummary(draft.attendanceOpenBefore, draft.attendanceCloseBefore)
      : 'A lista abre e fecha quando a gestão ou o professor mandar',
    attendanceCancelSummary(draft.attendanceCancelDeadline),
  ].filter((sentence) => sentence !== null);

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <FormError message={save.error ? apiErrorMessage(save.error) : undefined} />
      <Card>
        <CardHeader>
          <CardTitle>Aluguel de quadra</CardTitle>
          <CardDescription>
            Preço = valor por hora × duração. Durações em múltiplos de 30 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text('pricePerHour', 'Preço por hora', {
            money: true,
            hint: 'Sem preço, o espaço não aparece na vitrine.',
          })}
          {text('minDuration', 'Duração mínima (min)')}
          {text('maxDuration', 'Duração máxima (min)')}
          {text('windowDays', 'Janela de reserva (dias)')}
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2 lg:col-span-3">
            {deadline('minAdvance', 'Antecedência mínima para reservar', {
              zeroLabel: 'Sem antecedência',
            })}
            {deadline('cancellationDeadline', 'Cancelamento até (antes do horário)', {
              zeroLabel: 'Até o início',
              hint: 'Depois disso o jogador precisa falar com o espaço.',
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formas de pagamento aceitas no local</CardTitle>
          <CardDescription>
            O pagamento é feito direto no espaço; a plataforma só registra.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6">
            {METHODS.map((m) => (
              <div key={m} className="flex items-center gap-2">
                <Checkbox
                  id={`cfg-method-${m}`}
                  disabled={!editable}
                  checked={draft.methods.includes(m)}
                  onCheckedChange={(v) =>
                    set(
                      'methods',
                      v === true ? [...draft.methods, m] : draft.methods.filter((x) => x !== m),
                    )
                  }
                />
                <Label htmlFor={`cfg-method-${m}`}>{PAYMENT_METHOD_LABEL[m]}</Label>
              </div>
            ))}
          </div>
          <FormError message={errors.methods} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista de presença das aulas</CardTitle>
          <CardDescription>
            Como a lista de cada aula abre e fecha. Em qualquer modo, Dono, Admin e Professor podem
            abrir, fechar e reabrir à mão.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <OptionCards
            label="Modo da lista de presença"
            name="cfg-attendanceMode"
            value={draft.attendanceMode}
            onChange={(mode) => set('attendanceMode', mode)}
            options={ATTENDANCE_MODES}
            disabled={!editable}
          />
          {automatic ? (
            <div
              className="animate-in fade-in-0 slide-in-from-top-2 grid gap-4 duration-200 motion-reduce:animate-none sm:grid-cols-2"
              data-testid="attendance-automatic-fields"
            >
              {deadline('attendanceOpenBefore', 'Abre antes da aula', {
                zeroLabel: 'Na hora da aula',
              })}
              {deadline('attendanceCloseBefore', 'Fecha antes da aula', {
                zeroLabel: 'Na hora da aula',
              })}
            </div>
          ) : null}
          <div className="sm:w-1/2 sm:pr-2">
            {deadline('attendanceCancelDeadline', 'Desistência até (antes da aula)', {
              zeroLabel: 'Até o início',
              hint: 'Depois disso o aluno não consegue desistir pelo app.',
            })}
          </div>
          {summary.length > 0 ? (
            <p
              className="bg-muted rounded-md px-3 py-2 text-sm"
              role="status"
              data-testid="attendance-summary"
            >
              {summary.join('. ')}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regras das aulas</CardTitle>
          <CardDescription>
            Atraso na mensalidade. Vale para todos os planos do espaço.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-pastDueBlockEnabled"
                disabled={!editable}
                checked={draft.pastDueBlockEnabled}
                onCheckedChange={(v) => set('pastDueBlockEnabled', v === true)}
              />
              <Label htmlFor="cfg-pastDueBlockEnabled">
                Bloquear a confirmação de presença de quem está com mensalidade em atraso
              </Label>
            </div>
            {draft.pastDueBlockEnabled ? (
              <div className="sm:w-72">
                {text('pastDueBlockDays', 'Bloqueia após (dias de atraso)', {
                  hint: 'Pagou ou foi dispensado, o aluno volta a confirmar.',
                })}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {editable ? (
        <Button type="submit" className="w-fit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Salvar configurações
        </Button>
      ) : (
        <p className="text-muted-foreground text-sm">
          Somente Dono e Admin podem alterar as configurações.
        </p>
      )}
    </form>
  );
}

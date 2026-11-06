'use client';

import { useListSports } from '@space-sports/api-client';
import {
  BIRTH_DATE_MIN,
  GENDER_LABELS,
  GENDERS,
  type Gender,
  SPORT_LEVEL_LABELS,
  SPORT_LEVELS,
  type SportLevel,
} from '@space-sports/shared';
import { Field } from '@/components/painel/field';
import { Button } from '@/components/ui/button';
import { ChipButton } from '@/components/ui/chip';
import { DatePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { type AboutDraft, setSportLevel, toggleSport } from '@/lib/account/profile';
import { todayLocal } from '@/lib/format';

export type AboutErrors = Partial<Record<'birthDate' | 'gender' | 'sports', string>>;

/**
 * Nascimento, gênero e esportes favoritos com nível (decisões 68 e 69), todos opcionais. Usado na etapa
 * "Sobre você" do cadastro e no Meu perfil.
 */
export function AboutFields({
  value,
  onChange,
  errors,
  idPrefix = 'about',
  savedSports = [],
}: {
  value: AboutDraft;
  onChange: (value: AboutDraft) => void;
  errors?: AboutErrors | undefined;
  idPrefix?: string;
  /** Esportes já gravados (`me.favoriteSports[].sport`): dão o nome enquanto o catálogo carrega. */
  savedSports?: { id: string; name: string }[];
}) {
  const sports = useListSports();
  const sportName = (id: string) =>
    sports.data?.items.find((s) => s.id === id)?.name ??
    savedSports.find((s) => s.id === id)?.name ??
    'Esporte';

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Data de nascimento"
        htmlFor={`${idPrefix}-birth`}
        optional
        error={errors?.birthDate}
      >
        <DatePicker
          id={`${idPrefix}-birth`}
          value={value.birthDate}
          onValueChange={(birthDate) => onChange({ ...value, birthDate })}
          min={BIRTH_DATE_MIN}
          max={todayLocal()}
          yearDropdown
        />
      </Field>

      <Field label="Gênero" htmlFor={`${idPrefix}-gender`} optional error={errors?.gender}>
        <Select
          id={`${idPrefix}-gender`}
          value={value.gender}
          onChange={(event) => onChange({ ...value, gender: event.target.value as Gender | '' })}
        >
          <option value="">Não informado</option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {GENDER_LABELS[gender]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Esportes favoritos"
        optional
        group
        error={errors?.sports}
        hint="Escolha quantos quiser. O nível é opcional."
      >
        {sports.isPending ? (
          <div className="flex flex-wrap gap-2" aria-busy="true">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
        ) : sports.isError ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            <span className="text-muted-foreground">Não foi possível carregar os esportes.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void sports.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : sports.data.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum esporte disponível no momento.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sports.data.items.map((sport) => (
              <ChipButton
                key={sport.id}
                selected={value.sports.some((s) => s.sportId === sport.id)}
                onClick={() => onChange({ ...value, sports: toggleSport(value.sports, sport.id) })}
              >
                {sport.name}
              </ChipButton>
            ))}
          </div>
        )}
      </Field>

      {value.sports.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Nível em cada esporte">
          {value.sports.map((item) => {
            const id = `${idPrefix}-level-${item.sportId}`;
            const name = sportName(item.sportId);
            return (
              <li key={item.sportId} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{name}</span>
                <div className="w-44 shrink-0">
                  <Select
                    id={id}
                    aria-label={`Nível em ${name}`}
                    value={item.level ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        sports: setSportLevel(
                          value.sports,
                          item.sportId,
                          (event.target.value || null) as SportLevel | null,
                        ),
                      })
                    }
                  >
                    <option value="">Sem nível</option>
                    {SPORT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {SPORT_LEVEL_LABELS[level]}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

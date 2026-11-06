import { type MeResponse, useListSports } from '@space-sports/api-client';
import {
  type FavoriteSportInput,
  GENDER_LABELS,
  GENDERS,
  type Gender,
  SPORT_LEVEL_LABELS,
  SPORT_LEVELS,
  type SportLevel,
} from '@space-sports/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { InlineError } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { Field } from '@/features/auth/components/field';
import { useFormField, validateFields } from '@/features/auth/components/use-form-field';
import { color } from '@/theme/theme';
import { useThemeName } from '@/theme/theme-provider';
import { formatBirthDate, maskBirthDate, parseBirthDate, validateBirthDate } from './birth-date';

/** O que a etapa "Sobre você" e o editar perfil enviam em `PATCH /v1/me/profile`. */
export interface AboutYouInput {
  birthDate: string | null;
  gender: Gender | null;
  favoriteSports: FavoriteSportInput[];
}

type Initial = Pick<MeResponse, 'birthDate' | 'gender' | 'favoriteSports'>;

/** Pessoa ainda não respondeu nada do "Sobre você" (nascimento, gênero e esportes vazios). */
export function isAboutYouEmpty(me: Initial): boolean {
  return !me.birthDate && !me.gender && me.favoriteSports.length === 0;
}

/**
 * Estado do "Sobre você" (decisões 68 a 70): nascimento (opcional, `dd/mm/aaaa`), gênero e
 * esportes favoritos do catálogo com nível opcional.
 */
export function useAboutYou(initial?: Initial) {
  const birthDate = useFormField({
    initial: formatBirthDate(initial?.birthDate),
    validate: validateBirthDate,
    format: maskBirthDate,
  });
  const [gender, setGender] = useState<Gender | null>(initial?.gender ?? null);
  const [sports, setSports] = useState<FavoriteSportInput[]>(
    () => initial?.favoriteSports.map((f) => ({ sportId: f.sport.id, level: f.level })) ?? [],
  );

  return {
    birthDate,
    gender,
    setGender,
    sports,
    setSports,
    /** Valida o nascimento (os outros campos não têm como ficar inválidos). */
    validate: () => validateFields([birthDate]),
    toInput: (): AboutYouInput => ({
      birthDate: birthDate.value.trim() ? parseBirthDate(birthDate.value) : null,
      gender,
      favoriteSports: sports.map((s) => ({ sportId: s.sportId, level: s.level ?? null })),
    }),
  };
}

export type AboutYouState = ReturnType<typeof useAboutYou>;

/** Campos do "Sobre você", usados no cadastro, no completar perfil e no editar perfil. */
export function AboutYouFields({ state, disabled }: { state: AboutYouState; disabled?: boolean }) {
  return (
    <View className="gap-6">
      <Field
        label="Data de nascimento"
        optional
        placeholder="dd/mm/aaaa"
        keyboardType="number-pad"
        autoComplete="birthdate-full"
        maxLength={10}
        testID="perfil-nascimento"
        {...state.birthDate.bind}
        editable={!disabled}
      />
      <GenderPicker value={state.gender} onChange={state.setGender} disabled={disabled} />
      <SportsPicker value={state.sports} onChange={state.setSports} disabled={disabled} />
    </View>
  );
}

function GenderPicker({
  value,
  onChange,
  disabled,
}: {
  value: Gender | null;
  onChange: (gender: Gender | null) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-2" role="radiogroup" accessibilityLabel="Gênero (opcional)">
      <Text variant="small">
        Gênero<Text className="font-normal text-muted-foreground"> (opcional)</Text>
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {GENDERS.map((gender) => (
          <Chip
            key={gender}
            testID={`perfil-genero-${gender}`}
            selected={value === gender}
            disabled={disabled}
            // Tocar no escolhido desmarca: o gênero é opcional.
            onPress={() => onChange(value === gender ? null : gender)}
          >
            <Text>{GENDER_LABELS[gender]}</Text>
          </Chip>
        ))}
      </View>
    </View>
  );
}

function SportsPicker({
  value,
  onChange,
  disabled,
}: {
  value: FavoriteSportInput[];
  onChange: (sports: FavoriteSportInput[]) => void;
  disabled?: boolean;
}) {
  const theme = useThemeName();
  const catalog = useListSports();
  const selected = new Map(value.map((s) => [s.sportId, s.level ?? null]));

  const toggle = (sportId: string) =>
    onChange(
      selected.has(sportId)
        ? value.filter((s) => s.sportId !== sportId)
        : [...value, { sportId, level: null }],
    );
  const setLevel = (sportId: string, level: SportLevel | null) =>
    onChange(value.map((s) => (s.sportId === sportId ? { ...s, level } : s)));

  const sports = catalog.data?.items ?? [];
  const chosen = sports.filter((s) => selected.has(s.id));

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text variant="small">
          Esportes favoritos<Text className="font-normal text-muted-foreground"> (opcional)</Text>
        </Text>
        <Text variant="muted">Escolha quantos quiser. O nível também é opcional.</Text>
      </View>
      {catalog.isPending ? (
        <ActivityIndicator
          color={color(theme, 'primary')}
          accessibilityLabel="Carregando esportes"
        />
      ) : catalog.isError ? (
        <View className="items-start gap-2">
          <InlineError message="Não foi possível carregar os esportes." />
          <Button variant="outline" size="sm" onPress={() => void catalog.refetch()}>
            <Text>Tentar novamente</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {sports.map((sport) => (
            <Chip
              key={sport.id}
              testID={`perfil-esporte-${sport.slug}`}
              role="checkbox"
              selected={selected.has(sport.id)}
              disabled={disabled}
              onPress={() => toggle(sport.id)}
            >
              <Text>{sport.name}</Text>
            </Chip>
          ))}
        </View>
      )}
      {chosen.map((sport) => {
        const level = selected.get(sport.id) ?? null;
        return (
          <View
            key={sport.id}
            className="gap-2 rounded-lg border border-border bg-card p-3"
            role="radiogroup"
            accessibilityLabel={`Nível em ${sport.name} (opcional)`}
          >
            <Text variant="small">Nível em {sport.name}</Text>
            <View className="flex-row flex-wrap gap-2">
              {SPORT_LEVELS.map((option) => (
                <Chip
                  key={option}
                  testID={`perfil-nivel-${sport.slug}-${option}`}
                  selected={level === option}
                  disabled={disabled}
                  onPress={() => setLevel(sport.id, level === option ? null : option)}
                >
                  <Text>{SPORT_LEVEL_LABELS[option]}</Text>
                </Chip>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

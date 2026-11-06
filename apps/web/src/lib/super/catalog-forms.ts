import type {
  CreateAmenityInput,
  CreateCityInput,
  CreateSportInput,
} from '@space-sports/api-client';

export type FormValues = Record<string, string | boolean>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const text = (values: FormValues, key: string) => String(values[key] ?? '').trim();

function validateSlugAndName(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!text(values, 'name')) errors.name = 'Informe o nome';
  const slug = text(values, 'slug');
  if (slug.length < 2 || !SLUG.test(slug)) {
    errors.slug = 'Use letras minúsculas, números e hífens, com ao menos 2 caracteres';
  }
  return errors;
}

export function validateSport(values: FormValues): Record<string, string> {
  const errors = validateSlugAndName(values);
  const max = text(values, 'defaultMaxPlayers');
  if (max) {
    const n = Number(max);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      errors.defaultMaxPlayers = 'Informe um número inteiro de 1 a 20';
    }
  }
  return errors;
}

export const validateAmenity = validateSlugAndName;

export function validateCity(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!text(values, 'name')) errors.name = 'Informe o nome';
  if (!/^[A-Z]{2}$/.test(text(values, 'state'))) errors.state = 'Use a sigla da UF, ex.: MG';
  return errors;
}

/** Campos opcionais vazios ficam de fora para a API aplicar o padrão. */
export function toSportInput(values: FormValues): CreateSportInput {
  const icon = text(values, 'icon');
  const max = text(values, 'defaultMaxPlayers');
  return {
    slug: text(values, 'slug'),
    name: text(values, 'name'),
    ...(icon ? { icon } : {}),
    ...(max ? { defaultMaxPlayers: Number(max) } : {}),
  };
}

export function toAmenityInput(values: FormValues): CreateAmenityInput {
  const icon = text(values, 'icon');
  return { slug: text(values, 'slug'), name: text(values, 'name'), ...(icon ? { icon } : {}) };
}

export function toCityInput(values: FormValues): CreateCityInput {
  const timezone = text(values, 'timezone');
  return {
    name: text(values, 'name'),
    state: text(values, 'state'),
    ...(timezone ? { timezone } : {}),
    active: values.active === true,
  };
}

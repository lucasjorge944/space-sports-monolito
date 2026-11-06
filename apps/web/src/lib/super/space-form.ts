import type {
  CreateSuperSpaceInput,
  SuperSpace,
  UpdateSuperSpaceInput,
} from '@space-sports/api-client';
import { maskCep, maskPhone, normalizeCep, normalizePhone } from '@space-sports/shared';
import { type FieldErrors, normalizeEmail, validateEmail } from '@/lib/auth/validation';

export type SpaceFormValues = {
  name: string;
  slug: string;
  cityId: string;
  description: string;
  street: string;
  number: string;
  neighborhood: string;
  postalCode: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  ownerEmail: string;
};

export type SpaceFormField = keyof SpaceFormValues;

export const emptySpaceForm: SpaceFormValues = {
  name: '',
  slug: '',
  cityId: '',
  description: '',
  street: '',
  number: '',
  neighborhood: '',
  postalCode: '',
  phone: '',
  whatsapp: '',
  instagram: '',
  ownerEmail: '',
};

export function spaceToForm(space: SuperSpace): SpaceFormValues {
  return {
    name: space.name,
    slug: space.slug,
    cityId: space.address.city.id,
    description: space.description ?? '',
    street: space.address.street ?? '',
    number: space.address.number ?? '',
    neighborhood: space.address.neighborhood ?? '',
    postalCode: maskCep(space.address.postalCode ?? ''),
    phone: maskPhone(space.phone ?? ''),
    whatsapp: maskPhone(space.whatsapp ?? ''),
    instagram: space.instagram ?? '',
    ownerEmail: '',
  };
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSpaceForm(
  values: SpaceFormValues,
  mode: 'create' | 'edit',
): FieldErrors<SpaceFormField> | undefined {
  const errors: FieldErrors<SpaceFormField> = {};
  if (!values.name.trim()) errors.name = 'Informe o nome do espaço';
  if (values.slug.trim() && !SLUG.test(values.slug.trim())) {
    errors.slug = 'Use letras minúsculas, números e hífens (ex.: arena-centro)';
  }
  if (!values.cityId) errors.cityId = 'Escolha a cidade';

  const address = [values.street, values.number, values.neighborhood, values.postalCode];
  const filled = address.filter((part) => part.trim()).length;
  if (filled > 0 && filled < address.length) {
    for (const field of ['street', 'number', 'neighborhood', 'postalCode'] as const) {
      if (!values[field].trim()) errors[field] = 'Preencha o endereço completo';
    }
  }

  if (values.postalCode.trim() && !normalizeCep(values.postalCode)) {
    errors.postalCode = 'Informe o CEP com 8 dígitos';
  }

  for (const field of ['phone', 'whatsapp'] as const) {
    if (values[field].trim() && !normalizePhone(values[field])) {
      errors[field] = 'Informe o telefone com DDD';
    }
  }
  if (mode === 'create' && values.ownerEmail.trim()) {
    const emailError = validateEmail(values.ownerEmail);
    if (emailError) errors.ownerEmail = emailError;
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

const optional = (value: string) => value.trim() || undefined;

function addressOf(values: SpaceFormValues) {
  if (!values.street.trim()) return undefined;
  return {
    street: values.street.trim(),
    number: values.number.trim(),
    neighborhood: values.neighborhood.trim(),
    postalCode: normalizeCep(values.postalCode) ?? values.postalCode.trim(),
  };
}

/** Campos opcionais vazios ficam de fora (a API não aceita `null`/texto vazio). */
export function toCreateInput(values: SpaceFormValues): CreateSuperSpaceInput {
  const address = addressOf(values);
  const phone = normalizePhone(values.phone);
  const whatsapp = normalizePhone(values.whatsapp);
  const slug = optional(values.slug);
  const description = optional(values.description);
  const instagram = optional(values.instagram);
  return {
    name: values.name.trim(),
    cityId: values.cityId,
    ...(slug ? { slug } : {}),
    ...(description ? { description } : {}),
    ...(address ? { address } : {}),
    ...(phone ? { phone } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(instagram ? { instagram } : {}),
    ...(values.ownerEmail.trim() ? { ownerEmail: normalizeEmail(values.ownerEmail) } : {}),
  };
}

export function toUpdateInput(values: SpaceFormValues): UpdateSuperSpaceInput {
  const { ownerEmail: _ignored, ...rest } = toCreateInput(values);
  return rest;
}

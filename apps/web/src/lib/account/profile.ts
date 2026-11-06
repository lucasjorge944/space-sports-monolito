import type { MeResponse, UpdateProfileInput } from '@space-sports/api-client';
import {
  BIRTH_DATE_MIN,
  BRAZILIAN_PHONE_REGEX,
  type Gender,
  normalizePhone,
  type SportLevel,
} from '@space-sports/shared';
import { formatPhone, todayLocal } from '@/lib/format';

// Perfil do usuário (RF-AUTH-01/02, decisões 64 a 70): regras dos formulários de cadastro, completar
// cadastro e Meu perfil. A API valida tudo de novo com os Zod de packages/shared.

/** Telefone digitado (com ou sem máscara) → E.164 brasileiro; `null` se incompleto ou de outro país. */
export function phoneToE164(value: string): string | null {
  const e164 = normalizePhone(value);
  return e164 && BRAZILIAN_PHONE_REGEX.test(e164) ? e164 : null;
}

/** Telefone obrigatório do cadastro e do perfil (decisão 64): celular ou fixo brasileiro com DDD. */
export function validatePhone(value: string): string | undefined {
  if (!value.trim()) return 'Informe seu telefone com DDD';
  return phoneToE164(value) ? undefined : 'Informe um telefone brasileiro com DDD';
}

/** Data de nascimento opcional (decisão 68): sem bloqueio de idade, entre 1900 e hoje. */
export function validateBirthDate(value: string, today: string = todayLocal()) {
  if (!value) return undefined;
  if (value < BIRTH_DATE_MIN) return 'Informe uma data a partir de 1900';
  if (value > today) return 'A data de nascimento não pode ser no futuro';
  return undefined;
}

export type FavoriteSportDraft = { sportId: string; level: SportLevel | null };

/** O que a etapa "Sobre você" e o Meu perfil editam além de nome e telefone. */
export type AboutDraft = {
  /** `yyyy-MM-dd` ou vazio. */
  birthDate: string;
  gender: Gender | '';
  sports: FavoriteSportDraft[];
};

type ProfileOf = Pick<MeResponse, 'birthDate' | 'gender' | 'favoriteSports'>;

export const EMPTY_ABOUT: AboutDraft = { birthDate: '', gender: '', sports: [] };

export function aboutDraftOf(me: ProfileOf): AboutDraft {
  return {
    birthDate: me.birthDate ?? '',
    gender: me.gender ?? '',
    sports: me.favoriteSports.map((f) => ({ sportId: f.sport.id, level: f.level })),
  };
}

/** Nenhum dado de "Sobre você" preenchido: conta nova, ou quem sempre pulou a etapa. */
export function aboutIsEmpty(me: ProfileOf): boolean {
  return !me.birthDate && !me.gender && me.favoriteSports.length === 0;
}

/** Corpo do `PATCH /v1/me/profile` da etapa "Sobre você" (a lista de esportes substitui a anterior). */
export function aboutPayload(draft: AboutDraft): UpdateProfileInput {
  return {
    birthDate: draft.birthDate || null,
    gender: draft.gender || null,
    favoriteSports: draft.sports.map((s) => ({ sportId: s.sportId, level: s.level })),
  };
}

/** Marca/desmarca um esporte; desmarcar descarta o nível escolhido. */
export function toggleSport(list: FavoriteSportDraft[], sportId: string): FavoriteSportDraft[] {
  return list.some((s) => s.sportId === sportId)
    ? list.filter((s) => s.sportId !== sportId)
    : [...list, { sportId, level: null }];
}

export function setSportLevel(
  list: FavoriteSportDraft[],
  sportId: string,
  level: SportLevel | null,
): FavoriteSportDraft[] {
  return list.map((s) => (s.sportId === sportId ? { ...s, level } : s));
}

const sameSports = (a: FavoriteSportDraft[], b: FavoriteSportDraft[]) =>
  a.length === b.length &&
  a.every((item) =>
    b.some((other) => other.sportId === item.sportId && other.level === item.level),
  );

export type ProfileForm = AboutDraft & { name: string; phone: string };

/** Formulário do Meu perfil a partir do `/v1/me` (telefone já mascarado). */
export function profileFormOf(me: ProfileOf & Pick<MeResponse, 'name' | 'phone'>): ProfileForm {
  return { ...aboutDraftOf(me), name: me.name, phone: formatPhone(me.phone) };
}

/**
 * Só os campos alterados, para o `PATCH /v1/me/profile`. Reenviar o mesmo telefone não muda nada na
 * API, mas mandar só o que mudou deixa claro no registro o que a pessoa editou.
 */
export function profileChanges(
  me: ProfileOf & Pick<MeResponse, 'name' | 'phone'>,
  form: ProfileForm,
): UpdateProfileInput {
  const changes: UpdateProfileInput = {};
  const name = form.name.trim();
  if (name !== me.name) changes.name = name;
  const phone = phoneToE164(form.phone);
  if (phone && phone !== me.phone) changes.phone = phone;
  if ((form.birthDate || null) !== me.birthDate) changes.birthDate = form.birthDate || null;
  if ((form.gender || null) !== me.gender) changes.gender = form.gender || null;
  if (!sameSports(form.sports, aboutDraftOf(me).sports)) {
    changes.favoriteSports = form.sports.map((s) => ({ sportId: s.sportId, level: s.level }));
  }
  return changes;
}

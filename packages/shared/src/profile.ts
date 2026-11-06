import { z } from 'zod';
import { DEFAULT_TIME_ZONE, utcToZoned } from './time';

// Perfil do usuário (RF-AUTH-01, RF-AUTH-02; decisões 64 a 70): telefone do cadastro, nascimento,
// gênero e esportes favoritos. Sem dependência de outros módulos do pacote (auth.ts e super.ts
// importam daqui).

// ---------------------------------------------------------------------------------------------
// Telefone (decisão 64)

/**
 * Telefone brasileiro em E.164: `+55`, DDD (sem zero) e 8 dígitos (fixo, começando de 2 a 9) ou 9
 * (celular, começando com 9). Mesma regra do `normalizePhone` das máscaras.
 */
export const BRAZILIAN_PHONE_REGEX = /^\+55[1-9]{2}(9[0-9]{8}|[2-9][0-9]{7})$/;

export const INVALID_PHONE_MESSAGE = 'Informe um telefone brasileiro com DDD.';

/**
 * Telefone do cadastro e do perfil (decisão 64): obrigatório, sem verificação por SMS. Fica
 * gravado como não verificado e não prova identidade (não vincula contatos nem serve para login).
 */
export const brazilianPhoneSchema = z.string().regex(BRAZILIAN_PHONE_REGEX, INVALID_PHONE_MESSAGE);

// ---------------------------------------------------------------------------------------------
// Nome, nascimento e gênero (decisões 67 e 68)

export const PERSON_NAME_MAX = 120;
export const personNameSchema = z.string().trim().min(1, 'Informe o nome.').max(PERSON_NAME_MAX);

/** Primeiro dia aceito na data de nascimento. */
export const BIRTH_DATE_MIN = '1900-01-01';

/**
 * Data de nascimento (data civil, `YYYY-MM-DD`, sem fuso): opcional, sem bloqueio de idade, entre
 * 1900 e hoje no fuso de referência (America/Sao_Paulo).
 */
export const birthDateSchema = z.iso
  .date('Use o formato AAAA-MM-DD.')
  .refine((date) => date >= BIRTH_DATE_MIN, { message: 'Data anterior a 1900.' })
  .refine((date) => date <= utcToZoned(new Date(), DEFAULT_TIME_ZONE).date, {
    message: 'A data de nascimento não pode ser no futuro.',
  });

/** Base para categorias de torneio no futuro (decisão 68). `UNDISCLOSED`: prefiro não informar. */
export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const;
export const genderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof genderSchema>;
export const GENDER_LABELS: Record<Gender, string> = {
  FEMALE: 'Feminino',
  MALE: 'Masculino',
  OTHER: 'Outro',
  UNDISCLOSED: 'Prefiro não informar',
};

// ---------------------------------------------------------------------------------------------
// Esportes favoritos (decisão 69)

/** Níveis do jogador (`sport_level`): enum no banco, então a lista é só leitura. */
export const SPORT_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO'] as const;
export const sportLevelSchema = z.enum(SPORT_LEVELS);
export type SportLevel = z.infer<typeof sportLevelSchema>;
export const SPORT_LEVEL_LABELS: Record<SportLevel, string> = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
  PRO: 'Profissional',
};

/** Limite de esportes favoritos por pessoa (o catálogo é pequeno; o teto só barra abuso). */
export const FAVORITE_SPORTS_MAX = 20;

/** Esporte favorito como entra no PATCH: o nível é opcional (nulo = não informado). */
export const favoriteSportInputSchema = z
  .object({
    sportId: z.uuid(),
    level: sportLevelSchema.nullable().default(null),
  })
  .strict();
export type FavoriteSportInput = z.input<typeof favoriteSportInputSchema>;

/** Esporte favorito na resposta de GET /v1/me. */
export const favoriteSportSchema = z.object({
  sport: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  level: sportLevelSchema.nullable(),
});
export type FavoriteSport = z.infer<typeof favoriteSportSchema>;

// ---------------------------------------------------------------------------------------------
// Completar cadastro (decisão 66)

/**
 * O que a etapa "completar cadastro" exige antes de liberar o app e o painel. Nascimento, gênero
 * e esportes nunca entram: a etapa "Sobre você" tem "Pular" (decisão 70).
 */
export const PROFILE_REQUIRED_FIELDS = ['name', 'phone'] as const;
export const profileRequiredFieldSchema = z.enum(PROFILE_REQUIRED_FIELDS);
export type ProfileRequiredField = z.infer<typeof profileRequiredFieldSchema>;

/** Campos obrigatórios que faltam na conta, na ordem de `PROFILE_REQUIRED_FIELDS`. */
export function missingProfileFields(user: {
  name: string;
  phone: string | null;
}): ProfileRequiredField[] {
  return PROFILE_REQUIRED_FIELDS.filter((field) =>
    field === 'name' ? !user.name.trim() : !user.phone,
  );
}

// ---------------------------------------------------------------------------------------------
// Cadastro e edição

/**
 * POST /v1/auth/sign-up/email (Better Auth) com o telefone obrigatório (decisão 64). Para os
 * formulários do web e do app; a API valida o telefone com o mesmo `brazilianPhoneSchema`.
 */
export const signUpSchema = z.object({
  name: personNameSchema,
  email: z.email().max(254),
  /** Mesmos limites do Better Auth (auth.ts). */
  password: z.string().min(8).max(128),
  phone: brazilianPhoneSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * PATCH /v1/me/profile (parcial). `favoriteSports` é a lista completa e substitui a anterior.
 * Trocar o telefone volta `phoneVerified` para falso. E-mail e foto têm fluxos próprios.
 */
export const updateProfileSchema = z
  .object({
    name: personNameSchema,
    phone: brazilianPhoneSchema,
    birthDate: birthDateSchema.nullable(),
    gender: genderSchema.nullable(),
    favoriteSports: z
      .array(favoriteSportInputSchema)
      .max(FAVORITE_SPORTS_MAX)
      .refine((list) => new Set(list.map((item) => item.sportId)).size === list.length, {
        message: 'Esporte repetido.',
      }),
  })
  .partial()
  .strict();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type UpdateProfile = z.output<typeof updateProfileSchema>;

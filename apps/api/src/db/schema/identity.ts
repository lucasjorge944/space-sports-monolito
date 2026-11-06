import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sports } from './catalog.js';
import { id, timestamps, tstz } from './columns.js';
import {
  devicePlatform,
  gender,
  platformRole,
  spaceMemberRole,
  spaceMemberStatus,
  sportLevel,
  staffInviteStatus,
  userStatus,
} from './enums.js';
import { spaces } from './spaces.js';

/**
 * Usuários; é também a tabela `user` do Better Auth (sessões, contas e verificações em auth.ts).
 * O `image` do Better Auth é mapeado para `avatar_url` e o `phoneNumber`/`phoneNumberVerified`
 * do plugin de telefone, para `phone`/`phone_verified`.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    name: text().notNull(),
    /**
     * Opcional: quem entra só pelo telefone não tem e-mail (RF-AUTH-01). Sempre em minúsculas e
     * sem espaços (normalizado pela aplicação e garantido pelo CHECK). O UNIQUE ignora nulos.
     */
    email: text().unique('users_email_unique'),
    emailVerified: boolean().notNull().default(false),
    /** Primeira vez em que a conta apareceu verificada: marca a transição (ver `auth.ts`). */
    emailVerifiedAt: tstz(),
    /**
     * E.164 (ex.: +5531999998888). Obrigatório no cadastro e gravado sem verificação (decisão 64):
     * números digitados podem se repetir; só o verificado (OTP) é único e prova identidade.
     */
    phone: text(),
    phoneVerified: boolean().notNull().default(false),
    avatarUrl: text(),
    /** Data civil, sem fuso (decisão 68). */
    birthDate: date({ mode: 'string' }),
    /** Opcional; base para categorias de torneio (RF-AUTH-02, decisão 68). */
    gender: gender(),
    platformRole: platformRole().notNull().default('USER'),
    status: userStatus().notNull().default('ACTIVE'),
    /** Exclusão lógica: a conta é anonimizada (e-mail/telefone nulos) para liberar o recadastro. */
    deletedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
    // Decisão 64: só o telefone verificado é único (e identifica a conta no login por OTP).
    uniqueIndex('users_phone_verified_unique').on(t.phone).where(sql`${t.phoneVerified}`),
    // Conta ativa precisa de pelo menos um meio de login; a anonimizada (deleted_at) fica sem os dois.
    check(
      'users_email_or_phone',
      sql`${t.deletedAt} IS NOT NULL OR ${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`,
    ),
  ],
);

export const userSportProfiles = pgTable(
  'user_sport_profiles',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Tirar o esporte do catálogo leva junto os favoritos: eles não podem travar o Super.
    sportId: uuid()
      .notNull()
      .references(() => sports.id, { onDelete: 'cascade' }),
    /** Opcional (decisão 69). */
    level: sportLevel(),
    ...timestamps,
  },
  (t) => [
    unique('user_sport_profiles_user_sport_unique').on(t.userId, t.sportId),
    index('user_sport_profiles_sport_id_idx').on(t.sportId),
  ],
);

/** Papéis por espaço (RN-AUTH-03): a mesma pessoa pode ter vínculos em vários espaços. */
export const spaceMembers = pgTable(
  'space_members',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    role: spaceMemberRole().notNull(),
    status: spaceMemberStatus().notNull().default('INVITED'),
    ...timestamps,
  },
  (t) => [
    unique('space_members_user_space_role_unique').on(t.userId, t.spaceId, t.role),
    // Alvo da FK composta (teacher_member_id, space_id) dos professores das turmas e sessões: o
    // professor tem de ser do mesmo espaço.
    unique('space_members_id_space_id_unique').on(t.id, t.spaceId),
    index('space_members_space_id_status_idx').on(t.spaceId, t.status),
  ],
);

/**
 * Convite de equipe por e-mail (RF-NOTIF-02): vale para quem ainda não tem conta, então não dá
 * para ser uma linha de `space_members`. Ao aceitar, vira um vínculo ACTIVE lá. Só o hash do
 * token fica no banco.
 */
export const staffInvites = pgTable(
  'staff_invites',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    /** Normalizado (minúsculas, sem espaços), como `users.email`. */
    email: text().notNull(),
    role: spaceMemberRole().notNull(),
    /** SHA-256 (hex) do token enviado por e-mail. */
    tokenHash: text().notNull().unique('staff_invites_token_hash_unique'),
    status: staffInviteStatus().notNull().default('PENDING'),
    expiresAt: tstz().notNull(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id),
    acceptedBy: uuid().references(() => users.id),
    acceptedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    check('staff_invites_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    // Um convite em aberto por (espaço, e-mail, papel); reenviar renova o mesmo convite.
    uniqueIndex('staff_invites_pending_unique')
      .on(t.spaceId, t.email, t.role)
      .where(sql`${t.status} = 'PENDING'`),
    index('staff_invites_space_id_status_idx').on(t.spaceId, t.status),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text().notNull().unique('devices_expo_push_token_unique'),
    platform: devicePlatform().notNull(),
    ...timestamps,
  },
  (t) => [index('devices_user_id_idx').on(t.userId)],
);

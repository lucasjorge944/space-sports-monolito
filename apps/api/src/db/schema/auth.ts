import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './columns.js';
import { users } from './identity.js';

// Tabelas do Better Auth (modelos session, account e verification). Os nomes das colunas seguem
// o schema do Better Auth 1.x; o usuário é a tabela `users` (identity.ts).

/** Sessões: o `token` vai no cookie (web) ou no header Authorization: Bearer (app). */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique('sessions_token_unique'),
    expiresAt: tstz().notNull(),
    ipAddress: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/**
 * Formas de login de cada usuário: `credential` (senha com hash em `password`) ou provedor
 * social (`google`, `apple`), com `account_id` = id do usuário no provedor.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: tstz(),
    refreshTokenExpiresAt: tstz(),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [
    unique('accounts_provider_account_unique').on(t.providerId, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

/** Tokens de verificação de e-mail, reset de senha e OTP por telefone. */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tstz().notNull(),
    ...timestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

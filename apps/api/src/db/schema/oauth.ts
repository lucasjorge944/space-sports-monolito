import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sessions } from './auth.js';
import { id, timestamps, tstz } from './columns.js';
import { users } from './identity.js';

// Servidor de autorização OAuth do MCP (docs/14-mcp.md, decisão 111): tabelas dos plugins `jwt` e
// `oauth-provider` (via `@better-auth/mcp`) do Better Auth. As propriedades têm o nome dos campos do
// Better Auth (o adapter do Drizzle procura por elas); as colunas seguem o snake_case do projeto.
// `string[]` do Better Auth vira `text[]` e `json` vira `jsonb`, como no gerador do Better Auth.

/** Chaves de assinatura dos JWT (plugin `jwt`); a privada vai cifrada com o BETTER_AUTH_SECRET. */
export const jwks = pgTable('jwks', {
  id: id(),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: tstz().notNull().defaultNow(),
  /** Nulo: sem rotação. Com rotação, a chave vencida segue no JWKS pelo período de graça. */
  expiresAt: tstz(),
  alg: text(),
  crv: text(),
});

/**
 * Clientes OAuth: os do Client ID Metadata Document (`client_id` = URL do documento, decisão 111)
 * e, se o registro dinâmico for ligado, os registrados por RFC 7591.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: id(),
    clientId: text().notNull().unique('oauth_clients_client_id_unique'),
    clientSecret: text(),
    /** Origem do cliente descoberto (ex.: o CIMD), mantida pelo plugin. */
    clientDiscoveryId: text(),
    disabled: boolean().default(false),
    skipConsent: boolean(),
    enableEndSession: boolean(),
    subjectType: text(),
    scopes: text().array(),
    clientCredentialsScopes: text().array().default([]),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text().array(),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text().array().notNull(),
    postLogoutRedirectUris: text().array(),
    backchannelLogoutUri: text(),
    backchannelLogoutSessionRequired: boolean(),
    tokenEndpointAuthMethod: text(),
    applicationType: text(),
    jwks: text(),
    jwksUri: text(),
    grantTypes: text().array(),
    responseTypes: text().array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean().default(false),
    referenceId: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [index('oauth_clients_user_id_idx').on(t.userId)],
);

/** Recursos protegidos (RFC 8707): o servidor MCP (`MCP_RESOURCE_URL`), semeado no boot. */
export const oauthResources = pgTable('oauth_resources', {
  id: id(),
  identifier: text().notNull().unique('oauth_resources_identifier_unique'),
  name: text().notNull(),
  accessTokenTtl: integer(),
  refreshTokenTtl: integer(),
  signingAlgorithm: text(),
  signingKeyId: text(),
  allowedScopes: text().array(),
  customClaims: jsonb().$type<Record<string, unknown>>(),
  dpopBoundAccessTokensRequired: boolean().default(false),
  disabled: boolean().default(false),
  ...timestamps,
  policyVersion: integer().default(1),
  metadata: jsonb().$type<Record<string, unknown>>(),
});

/** Recursos que cada cliente pode pedir (o MCP liga todo cliente novo ao recurso do MCP). */
export const oauthClientResources = pgTable(
  'oauth_client_resources',
  {
    id: id(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text()
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: tstz().defaultNow(),
  },
  (t) => [
    index('oauth_client_resources_client_id_idx').on(t.clientId),
    index('oauth_client_resources_resource_id_idx').on(t.resourceId),
  ],
);

/** Tokens de atualização (hash), com rotação; `revoked` preenchido = revogado ("Desconectar"). */
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: id(),
    token: text().notNull().unique('oauth_refresh_tokens_token_unique'),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    expiresAt: tstz(),
    createdAt: tstz().defaultNow(),
    revoked: tstz(),
    rotatedAt: tstz(),
    rotationReplayResponse: text(),
    rotationReplayExpiresAt: tstz(),
    authTime: tstz(),
    confirmation: jsonb().$type<Record<string, unknown>>(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index('oauth_refresh_tokens_client_id_idx').on(t.clientId),
    index('oauth_refresh_tokens_session_id_idx').on(t.sessionId),
    index('oauth_refresh_tokens_user_id_idx').on(t.userId),
    index('oauth_refresh_tokens_authorization_code_id_idx').on(t.authorizationCodeId),
  ],
);

/** Tokens de acesso opacos (hash). Os do MCP são JWT e não passam por aqui. */
export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: id(),
    token: text().unique('oauth_access_tokens_token_unique'),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    refreshId: uuid().references(() => oauthRefreshTokens.id, { onDelete: 'cascade' }),
    expiresAt: tstz(),
    createdAt: tstz().defaultNow(),
    revoked: tstz(),
    confirmation: jsonb().$type<Record<string, unknown>>(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index('oauth_access_tokens_client_id_idx').on(t.clientId),
    index('oauth_access_tokens_session_id_idx').on(t.sessionId),
    index('oauth_access_tokens_user_id_idx').on(t.userId),
    index('oauth_access_tokens_authorization_code_id_idx').on(t.authorizationCodeId),
    index('oauth_access_tokens_refresh_id_idx').on(t.refreshId),
  ],
);

/**
 * Consentimento do usuário a um cliente ("Apps conectados", decisão 116). `last_used_at` é da API
 * (não do Better Auth): último uso do token do MCP, gravado no máximo 1 vez por hora.
 */
export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: id(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    scopes: text().array().notNull(),
    ...timestamps,
    lastUsedAt: tstz(),
  },
  (t) => [
    index('oauth_consents_client_id_idx').on(t.clientId),
    // Uma linha por (usuário, cliente, referência): o Better Auth atualiza a existente, e a
    // constraint impede a duplicata numa corrida de dois "Permitir".
    unique('oauth_consents_user_client_unique')
      .on(t.userId, t.clientId, t.referenceId)
      .nullsNotDistinct(),
  ],
);

/** `jti` das asserções `private_key_jwt` já usadas (uso único). Não usado pelos clientes do MCP. */
export const oauthClientAssertions = pgTable('oauth_client_assertions', {
  id: uuid().primaryKey(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});

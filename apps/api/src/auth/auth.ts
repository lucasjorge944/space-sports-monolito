import { cimd } from '@better-auth/cimd';
import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context';
import { expo } from '@better-auth/expo';
import { mcp } from '@better-auth/mcp';
import {
  type ClientMetadataResourceFetch,
  getOAuthProviderState,
  verifyOAuthQueryParams,
} from '@better-auth/oauth-provider';
import { Logger } from '@nestjs/common';
import {
  brazilianPhoneSchema,
  INVALID_PHONE_MESSAGE,
  MCP_ALL_OAUTH_SCOPES,
  MCP_RESOURCE_NAMES,
  MCP_RESOURCE_SCOPES,
  type McpResourceKind,
  missingProfileFields,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from '@space-sports/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { bearer, jwt, openAPI, phoneNumber } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import {
  accounts,
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  sessions,
  users,
  verifications,
} from '../db/schema/index.js';
import type { DomainEvents } from '../events/domain-events.js';
import type { Mailer, MailMessage } from '../mail/mailer.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { normalizeEmail } from '../users/normalize.js';
import { ACCOUNT_INACTIVE_MESSAGE } from './auth.errors.js';
import { resetPasswordEmail, verificationEmail, welcomeEmail } from './auth-emails.js';
import {
  adminConnectionExpired,
  consentReferenceCondition,
  consentReferenceOf,
  eligibleScopes,
  loadOAuthEligibility,
  MCP_ADMIN_CONNECTION_MAX_AGE_MS,
  MCP_ADMIN_CONSENT_REFERENCE,
  mcpResourceConfigOf,
  mcpResourceKindOf,
  requestsOnlyProtocolScopes,
  scopeForResource,
} from './oauth-resources.js';
import {
  type AuthorizeResourcePolicy,
  authorizeOverride,
  authorizeParamsOf,
  authorizeResourceOf,
  concludesOAuthConsent,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_CONSENT_CLAIM,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  mcpAdminClientNotAllowedError,
  mcpAdminDisabledError,
  OAUTH_DISABLED_PATHS,
  oauthAccessDenied,
  oauthProfileIncomplete,
  prepareAuthorizeRequest,
  rejectDpop,
  rejectInsecureRegistration,
  tokenRequestClientIdOf,
  withConsentPrompt,
} from './oauth-server.js';
import { rejectProfileImage } from './profile-image.js';
import { redisRateLimitStorage } from './redis-rate-limit.js';
import type { SmsSender } from './sms-sender.js';
import { idTokenProfile, protectSocialLink } from './social-link.js';

/** Prefixo das rotas do Better Auth (dentro do /v1 da API). */
export const AUTH_BASE_PATH = '/v1/auth';
/** Prefixo dos cookies: `space-sports.session_token` (`__Secure-` antes, em HTTPS). */
export const AUTH_COOKIE_PREFIX = 'space-sports';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * O plugin de telefone exige um e-mail ao criar a conta pelo OTP; este domínio reservado
 * (RFC 2606) marca o e-mail provisório, que o hook de criação troca por nulo.
 */
const PHONE_PLACEHOLDER_EMAIL_DOMAIN = '@phone.invalid';

const DAY_SECONDS = 24 * 60 * 60;

/** Rota de cadastro por e-mail e senha (dentro de AUTH_BASE_PATH). */
const SIGN_UP_EMAIL_PATH = '/sign-up/email';

/**
 * Colunas de `users` que o hook de sessão lê pelo adapter do Better Auth (para enxergar o
 * usuário recém-criado na mesma transação). Não entram no cadastro nem nas respostas.
 */
export const INTERNAL_USER_FIELDS = {
  status: { type: 'string', required: false, input: false, returned: false },
  deletedAt: { type: 'date', required: false, input: false, returned: false },
} as const;

/**
 * Telefone no modelo `user` do Better Auth, com os mesmos nomes do plugin `phoneNumber`
 * (`phoneNumber`/`phoneNumberVerified` → colunas `phone`/`phone_verified`). Com o login por
 * telefone ligado, quem declara os campos é o plugin; desligado, eles entram como additionalFields,
 * para o adapter gravar o telefone do cadastro por e-mail. Assim os hooks usam sempre os mesmos
 * nomes e não há dois campos sobre a mesma coluna quando o plugin voltar. `input: false`: o corpo
 * das rotas não escreve neles (o cadastro manda `phone`, validado e copiado no hook de criação).
 */
const PHONE_USER_FIELDS = {
  phoneNumber: { type: 'string', required: false, input: false, fieldName: 'phone' },
  phoneNumberVerified: {
    type: 'boolean',
    required: false,
    input: false,
    fieldName: 'phoneVerified',
  },
} as const;

type PhoneFields = { phoneNumber?: string | null; phoneNumberVerified?: boolean | null };

/** Telefone do corpo do cadastro por e-mail (decisão 64); `null` se ausente ou inválido. */
function signUpPhone(body: unknown): string | null {
  const parsed = brazilianPhoneSchema.safeParse((body as { phone?: unknown } | null)?.phone);
  return parsed.success ? parsed.data : null;
}

/** State do OAuth da requisição (`null` fora de um fluxo OAuth ou sem contexto de requisição). */
async function currentOAuthState(): Promise<{ link?: unknown } | null> {
  try {
    return (await getOAuthState()) as { link?: unknown } | null;
  } catch {
    return null;
  }
}

/** Query do pedido OAuth em andamento (authorize ou consentimento), sem a assinatura. */
async function currentOAuthQuery(): Promise<string | null> {
  try {
    const state = (await getOAuthProviderState()) as { query?: unknown } | null;
    if (typeof state?.query === 'string') return state.query;
  } catch {
    // Fora de um fluxo OAuth.
  }
  const endpoint = tryGetCurrentAuthEndpointContext();
  const query = endpoint?.query as Record<string, unknown> | undefined;
  if (!query) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') params.append(key, item);
    }
  }
  return params.toString();
}

const invalidSignUpPhone = () =>
  new APIError('BAD_REQUEST', { code: 'INVALID_PHONE_NUMBER', message: INVALID_PHONE_MESSAGE });

export type AuthDeps = {
  env: Env;
  db: Database;
  mailer: Mailer;
  /**
   * Sender do OTP (`null` com SMS_PROVIDER=none). O login por telefone só liga com ele e com
   * AUTH_PHONE_LOGIN_ENABLED=true (decisão 65).
   */
  sms: SmsSender | null;
  /** Contadores do rate limit. */
  redis: Redis;
  events: DomainEvents;
  /** Mídia do usuário, apagada quando o login social assume uma conta não verificada. */
  storage: PhotoStorage;
  /**
   * Busca do Client ID Metadata Document dos clientes do MCP (resolve o DNS uma vez, recusa
   * endereço privado e não segue redirect). Os testes trocam por um fake.
   */
  cimdFetch: ClientMetadataResourceFetch;
};

export type Auth = ReturnType<typeof createAuth>;

/** Instância do Better Auth (RF-AUTH-01, RF-AUTH-04) sobre o Drizzle da API. */
export function createAuth({ env, db, mailer, sms, redis, events, storage, cimdFetch }: AuthDeps) {
  const logger = new Logger('BetterAuth');

  // Decisão 65: o login por telefone (plugin `phoneNumber`) fica desligado, mesmo em dev e test,
  // salvo com AUTH_PHONE_LOGIN_ENABLED=true e um SMS_PROVIDER que envie o código. Motivo: o
  // telefone do cadastro não é verificado (decisão 64) e pode se repetir em `users.phone`; com o
  // plugin ligado, o OTP entraria na conta de quem digitou o número, não na do dono dele. Para
  // religar, o telefone precisa ser verificado antes de valer como login (e o plugin, achar a
  // conta só pelo telefone verificado). O SmsSender e a configuração do plugin ficam aqui.
  const otpSender = env.AUTH_PHONE_LOGIN_ENABLED ? sms : null;

  // Só a transição para verificado avisa, seja pelo link, por login social ou por conta social
  // ligada a uma conta sem verificação. Os hooks do Better Auth rodam em todo update e não dizem o
  // valor anterior; quem decide é o banco, que grava `email_verified_at` uma vez só.
  const markEmailVerified = async (user: {
    id: string;
    email?: string | null;
    emailVerified?: boolean;
  }) => {
    if (!user.emailVerified || !user.email) return;
    const [first] = await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    if (first) await events.publish({ type: 'user.email_verified', userId: user.id });
  };

  // O envio não bloqueia a resposta: o tempo dela não revela se o e-mail existe.
  const sendInBackground = (message: MailMessage) => {
    mailer.send(message).catch((err: unknown) => {
      logger.error({ err, subject: message.subject }, 'Falha ao enviar e-mail');
    });
  };

  // Escopos do MCP mais `offline_access` (o token de atualização). Cada recurso aceita só os seus
  // (decisão 120): o do jogador, os de jogador e gestão; o do Super, só `super:read`.
  const oauthScopes = [...MCP_ALL_OAUTH_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE];
  const resourceScopes = (kind: McpResourceKind) => [
    ...MCP_RESOURCE_SCOPES[kind],
    OAUTH_OFFLINE_ACCESS_SCOPE,
  ];
  const resourceConfig = mcpResourceConfigOf(env);
  const resourcePolicy: AuthorizeResourcePolicy = {
    resources: resourceConfig,
    adminEnabled: env.MCP_ADMIN_ENABLED,
    adminClientIds: new Set(env.MCP_ADMIN_ALLOWED_CLIENT_IDS),
  };
  const logRejectedAdminClient = (clientId: string) => {
    // A sessão principal descobre o `client_id` do Claude no primeiro teste por este log.
    logger.warn(
      { oauthClientId: clientId },
      'Cliente fora de MCP_ADMIN_ALLOWED_CLIENT_IDS pedindo o recurso do Super',
    );
  };

  const oauthUser = async (userId: string) => {
    const [user] = await db
      .select({
        status: users.status,
        deletedAt: users.deletedAt,
        name: users.name,
        phone: users.phone,
        platformRole: users.platformRole,
      })
      .from(users)
      .where(eq(users.id, userId));
    return user;
  };

  // Emissão e refresh do token do MCP: só conta ativa e com o cadastro completo (decisão 119; o
  // consentimento já exige, isto cobre conexões feitas antes da regra existir no servidor).
  const assertOAuthUserActive = async (userId: string) => {
    const user = await oauthUser(userId);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_grant',
        error_description: 'user is not active',
      });
    }
    if (missingProfileFields(user).length) {
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_grant',
        error_description: 'user profile is incomplete',
      });
    }
    return user;
  };

  const invalidGrant = (description: string) =>
    new APIError('BAD_REQUEST', { error: 'invalid_grant', error_description: description });

  // Consentimento (a conexão) de (usuário, cliente) no recurso, se houver: a mesma condição do guard.
  const consentOf = async (userId: string, clientId: string, kind: McpResourceKind) => {
    const [consent] = await db
      .select({ id: oauthConsents.id, createdAt: oauthConsents.createdAt })
      .from(oauthConsents)
      .where(
        and(
          eq(oauthConsents.userId, userId),
          eq(oauthConsents.clientId, clientId),
          consentReferenceCondition(kind),
        ),
      )
      .limit(1);
    return consent;
  };
  const adminConsentOf = (userId: string, clientId: string) => consentOf(userId, clientId, 'ADMIN');

  // Decisão 123: depois de 24 h, a conexão com o recurso do Super acaba. No próximo authorize, o
  // consentimento vencido sai (com os tokens de atualização dele), e o plugin pede um novo: assim
  // o `created_at` do consentimento é sempre o início da conexão atual.
  const dropExpiredAdminConsent = async (userId: string, clientId: string) => {
    const consent = await adminConsentOf(userId, clientId);
    if (!consent || !adminConnectionExpired(consent.createdAt)) return;
    await db.transaction(async (tx) => {
      await tx
        .update(oauthRefreshTokens)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(oauthRefreshTokens.userId, userId),
            eq(oauthRefreshTokens.clientId, clientId),
            eq(oauthRefreshTokens.referenceId, MCP_ADMIN_CONSENT_REFERENCE),
            isNull(oauthRefreshTokens.revoked),
          ),
        );
      await tx.delete(oauthConsents).where(eq(oauthConsents.id, consent.id));
    });
  };

  // `client_id` do pedido de token em andamento (asserção, Basic ou corpo, na ordem do plugin),
  // para a conexão e as regras do recurso do Super na emissão: o `customAccessTokenClaims` do
  // plugin não recebe o cliente.
  const tokenRequestClientId = (): string | null => {
    const endpoint = tryGetCurrentAuthEndpointContext();
    const authorization =
      endpoint?.request?.headers.get('authorization') ?? endpoint?.headers?.get('authorization');
    return tokenRequestClientIdOf(endpoint?.body, authorization);
  };

  // BUG-MCP2-1 (docs/14-mcp.md 3.3): o token leva o id da conexão (consentimento) em que foi
  // emitido, e a API só o aceita enquanto ela for a atual. Sem conexão, nenhum token sai.
  const issuanceConsentId = async (userId: string, kind: McpResourceKind) => {
    const clientId = tokenRequestClientId();
    const consent = clientId ? await consentOf(userId, clientId, kind) : undefined;
    if (!consent) throw invalidGrant('connection not found: sign in and authorize again');
    return consent.id;
  };

  // Emissão e refresh no recurso do Super (decisão 123): chave ligada, cliente da lista, conta Super
  // e conexão com menos de 24 h. O TTL de refresh por recurso do plugin renova a cada rotação, por
  // isso a idade da conexão é conferida aqui (e no guard, a cada requisição).
  const assertAdminIssuance = async (
    user: { id: string } & Partial<{ platformRole: string }>,
    platformRole: string,
  ) => {
    if (!env.MCP_ADMIN_ENABLED) throw mcpAdminDisabledError();
    const clientId = tokenRequestClientId();
    if (!clientId || !resourcePolicy.adminClientIds.has(clientId)) {
      if (clientId) logRejectedAdminClient(clientId);
      throw mcpAdminClientNotAllowedError();
    }
    if (platformRole !== 'SUPER') throw invalidGrant('user cannot use this resource');
    const consent = await adminConsentOf(user.id, clientId);
    if (!consent || adminConnectionExpired(consent.createdAt)) {
      throw invalidGrant('connection expired: sign in and authorize again');
    }
  };

  // Corpo do "Permitir" com `scope` = os pedidos (ou os escolhidos na tela) ∩ os que a conta pode
  // usar no recurso do pedido. Sem nenhum: 403 `OAUTH_ACCESS_DENIED`, nada é gravado.
  const consentBody = async (
    ctx: { body?: unknown; context: { secret: string } },
    userId: string,
  ): Promise<Record<string, unknown>> => {
    const body = { ...((ctx.body ?? {}) as Record<string, unknown>) };
    const signed = typeof body.oauth_query === 'string' ? body.oauth_query : '';
    if (!signed || !(await verifyOAuthQueryParams(signed, ctx.context.secret))) {
      throw new APIError('BAD_REQUEST', { error: 'invalid_signature' });
    }
    const query = new URLSearchParams(signed);
    const resources = query.getAll('resource');
    const kind = resources.length === 1 ? mcpResourceKindOf(resourceConfig, resources[0]) : null;
    if (!kind) {
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_target',
        error_description: 'request exactly one resource',
      });
    }
    if (kind === 'ADMIN') {
      if (!env.MCP_ADMIN_ENABLED) throw mcpAdminDisabledError();
      const clientId = query.get('client_id') ?? '';
      if (!resourcePolicy.adminClientIds.has(clientId)) {
        logRejectedAdminClient(clientId);
        throw mcpAdminClientNotAllowedError();
      }
    }
    const eligibility = await loadOAuthEligibility(db, userId);
    const chosen = typeof body.scope === 'string' ? body.scope : query.get('scope');
    const granted = scopeForResource(
      kind,
      chosen ?? '',
      eligibility ? eligibleScopes(kind, eligibility) : [],
    );
    if (granted.permissions.length === 0) throw oauthAccessDenied();
    return { ...body, scope: granted.scope };
  };

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: 'select_account' as const,
        }
      : undefined;
  const apple =
    env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? {
          clientId: env.APPLE_CLIENT_ID,
          clientSecret: env.APPLE_CLIENT_SECRET,
          ...(env.APPLE_APP_BUNDLE_IDENTIFIER
            ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER }
            : {}),
        }
      : undefined;

  return betterAuth({
    appName: 'Space Sports',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // O callback da Apple chega por form_post vindo de appleid.apple.com.
    trustedOrigins: [...env.TRUSTED_ORIGINS, ...(apple ? ['https://appleid.apple.com'] : [])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        jwks,
        oauthClient: oauthClients,
        oauthResource: oauthResources,
        oauthClientResource: oauthClientResources,
        oauthRefreshToken: oauthRefreshTokens,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents,
        oauthClientAssertion: oauthClientAssertions,
      },
      transaction: true,
    }),
    user: {
      fields: { image: 'avatarUrl' },
      // O tipo fica o das colunas internas: com os campos de telefone condicionais, a inferência do
      // Better Auth perderia o tipo do usuário da sessão.
      additionalFields: {
        ...INTERNAL_USER_FIELDS,
        ...(otpSender ? {} : PHONE_USER_FIELDS),
      } as typeof INTERNAL_USER_FIELDS,
      // RF-AUTH-03 (decisões 29 e 40): o app inativa a conta ou pede a exclusão, que a equipe
      // atende (POST /v1/me/deletion-request); a do Better Auth (/v1/auth/delete-user) fica desligada.
      deleteUser: { enabled: false },
    },
    session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        sendInBackground(resetPasswordEmail({ to: user.email, name: user.name, url }));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        sendInBackground(verificationEmail({ to: user.email, name: user.name, url }));
      },
      // Cadastro por e-mail e senha: boas-vindas só depois de confirmar o endereço.
      afterEmailVerification: async (user) => {
        sendInBackground(welcomeEmail({ to: user.email, name: user.name }));
      },
    },
    socialProviders: { ...(google ? { google } : {}), ...(apple ? { apple } : {}) },
    account: {
      accountLinking: {
        enabled: true,
        // Sem provedores "confiáveis": a ligação automática pelo e-mail só acontece quando o
        // provedor diz que o e-mail é verificado (o Google diz). Conta com outro e-mail não liga.
        trustedProviders: [],
        allowDifferentEmails: false,
        // A conta de senha com e-mail não confirmado também liga pelo callback, mas vira uma conta
        // nova antes (`protectSocialLink`, no hook de criação da conta social, RN-AUTH-06).
        requireLocalEmailVerified: false,
        // Nome e foto da conta não mudam ao ligar; a foto do Google entra só se não houver foto
        // (decisão 71, hook `account.create.after`).
        updateUserInfoOnLink: false,
      },
    },
    hooks: {
      // Antes de qualquer consulta ou gravação: a foto de perfil só muda por /v1/me/avatar
      // (`image` no corpo é recusado, profile-image.ts), e o cadastro por e-mail exige o telefone
      // (decisão 64), gravado pelo hook de criação do usuário.
      before: createAuthMiddleware(async (ctx) => {
        rejectProfileImage(ctx.path, ctx.body);
        if (ctx.path === SIGN_UP_EMAIL_PATH && !signUpPhone(ctx.body)) throw invalidSignUpPhone();
        // Servidor de autorização do MCP: PKCE S256 obrigatório, `offline_access` e o recurso do
        // MCP por padrão, sem DPoP, e registro dinâmico só com redirect HTTPS ou loopback.
        if (ctx.path === '/oauth2/token') rejectDpop(ctx);
        if (ctx.path === '/oauth2/authorize') {
          rejectDpop(ctx);
          const prepared = prepareAuthorizeRequest(ctx, env.MCP_RESOURCE_URL);
          const { where, params } = authorizeParamsOf(ctx, prepared);
          // Decisão 120: um recurso por pedido; o do Super, só com a chave ligada e cliente da lista.
          const { kind, resource } = authorizeResourceOf(
            params,
            resourcePolicy,
            logRejectedAdminClient,
          );
          params.resource = resource;
          // Escopos de outro recurso saem; sem `scope` (ou só `offline_access`), todos os do recurso.
          if (requestsOnlyProtocolScopes(params.scope)) delete params.scope;
          const requested = scopeForResource(kind, params.scope);
          if (typeof params.scope === 'string' && requested.permissions.length === 0) {
            throw new APIError('BAD_REQUEST', {
              error: 'invalid_scope',
              error_description: 'none of the requested scopes are allowed for this resource',
            });
          }
          params.scope = requested.scope;
          const session = await getSessionFromCtx(ctx);
          if (!session) return authorizeOverride(where, params);
          const user = await oauthUser(session.user.id);
          // Decisão 119: com sessão e cadastro incompleto, o authorize nunca emite o código (nem
          // com o consentimento já salvo); vai para o `/autorizar`, como no fluxo normal.
          if (user && missingProfileFields(user).length) {
            return authorizeOverride(
              where,
              withConsentPrompt(params, {
                error: 'interaction_required',
                error_description: 'user profile is incomplete',
              }),
            );
          }
          // RN-MCP-06: só os escopos que a conta pode usar agora (o código e o consentimento saem
          // com eles). Sem nenhum, a tela de consentimento explica e só deixa voltar (access_denied).
          const eligibility = await loadOAuthEligibility(db, session.user.id);
          const granted = scopeForResource(
            kind,
            params.scope,
            eligibility ? eligibleScopes(kind, eligibility) : [],
          );
          params.scope = granted.scope;
          if (kind === 'ADMIN' && typeof params.client_id === 'string') {
            await dropExpiredAdminConsent(session.user.id, params.client_id);
          }
          if (granted.permissions.length === 0) {
            return authorizeOverride(
              where,
              withConsentPrompt(params, {
                error: 'access_denied',
                error_description: 'no requested scope can be granted to this account',
              }),
            );
          }
          return authorizeOverride(where, params);
        }
        if (ctx.path === '/oauth2/register') rejectInsecureRegistration(ctx.body);
        // Decisão 119 no servidor (BUG-MCP-2): o consentimento só sai com nome e telefone, como o
        // `/autorizar` do web já exige. Sem sessão, a própria rota responde 401.
        if (concludesOAuthConsent(ctx.path, ctx.body)) {
          const session = await getSessionFromCtx(ctx);
          const user = session ? await oauthUser(session.user.id) : undefined;
          const missing = user ? missingProfileFields(user) : [];
          if (missing.length) throw oauthProfileIncomplete(missing);
          // RN-MCP-06 no "Permitir": concede só os pedidos ∩ os que a conta pode usar, decididos
          // aqui (não pela tela). O `continue` refaz o authorize, que aplica a mesma regra.
          if (session && ctx.path === '/oauth2/consent') {
            return { context: { body: await consentBody(ctx, session.user.id) } };
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // O retorno é mesclado sobre os dados originais: campo a descartar vai como null.
          before: async (user, ctx) => {
            const { phoneNumberVerified } = user as PhoneFields;
            const email = typeof user.email === 'string' ? normalizeEmail(user.email) : null;
            const isSignUp = ctx?.path === SIGN_UP_EMAIL_PATH;
            if (!isSignUp && phoneNumberVerified === true) {
              // Conta criada pelo OTP (só com o login por telefone ligado): o e-mail provisório
              // do plugin vira nulo.
              const placeholder = email?.endsWith(PHONE_PLACEHOLDER_EMAIL_DOMAIN);
              return { data: { ...user, email: placeholder ? null : email } as typeof user };
            }
            // Cadastro por e-mail: o telefone do corpo entra sempre não verificado (decisão 64);
            // `phoneNumberVerified` só vira true pelo OTP. Login social não traz telefone: a conta
            // nasce sem ele e o app pede no "completar cadastro" (decisão 66).
            const phone = isSignUp ? signUpPhone(ctx.body) : null;
            if (isSignUp && !phone) throw invalidSignUpPhone();
            return {
              data: {
                ...user,
                email,
                phoneNumber: phone,
                phoneNumberVerified: false,
              } as typeof user,
            };
          },
          // Login social já nasce com o e-mail verificado e não passa por `afterEmailVerification`.
          after: async (user) => {
            if (user.emailVerified && user.email) {
              sendInBackground(welcomeEmail({ to: user.email, name: user.name }));
            }
            await markEmailVerified(user);
          },
        },
        update: {
          before: async (user) =>
            typeof user.email === 'string'
              ? { data: { ...user, email: normalizeEmail(user.email) } }
              : undefined,
          after: markEmailVerified,
        },
        // A linha nunca é apagada pelo Better Auth: a exclusão é a anonimização (pelo Super).
        delete: { before: async () => false },
      },
      account: {
        create: {
          // RN-AUTH-06 (pré-sequestro), direto no banco, sem depender do contexto interno do
          // Better Auth: só o login implícito pelo callback revoga; a ligação explícita
          // (/link-social, `link` no state do OAuth) não revoga; o resto é recusado.
          before: async (account, ctx) => {
            if (account.providerId === 'credential') return;
            await protectSocialLink(db, storage, {
              userId: account.userId,
              idToken: account.idToken,
              path: ctx?.path,
              explicitLink:
                ctx?.path === '/link-social' || Boolean((await currentOAuthState())?.link),
            });
          },
          // Decisão 71: a foto do Google vira a foto da conta só se ela não tiver nenhuma (vale
          // para a conta de senha que passa a entrar pelo Google); nunca sobrescreve a enviada.
          after: async (account) => {
            if (account.providerId !== 'google') return;
            const { picture } = idTokenProfile(account.idToken);
            if (!picture) return;
            await db
              .update(users)
              .set({ avatarUrl: picture })
              .where(
                and(eq(users.id, account.userId), isNull(users.avatarUrl), isNull(users.deletedAt)),
              );
          },
        },
      },
      session: {
        create: {
          // Conta bloqueada, inativa ou excluída não abre sessão (login por qualquer método).
          before: async (session, ctx) => {
            // Pelo adapter do Better Auth: no cadastro, o usuário ainda está na transação aberta.
            const user = (await ctx?.context.internalAdapter.findUserById(session.userId)) as
              | { status?: string; deletedAt?: Date | null }
              | null
              | undefined;
            if (!user || user.deletedAt) {
              throw new APIError('UNAUTHORIZED', {
                code: 'USER_NOT_FOUND',
                message: 'Conta não encontrada.',
              });
            }
            if (user.status === 'BLOCKED') {
              throw new APIError('FORBIDDEN', {
                code: 'USER_BLOCKED',
                message: 'Conta bloqueada.',
              });
            }
            if (user.status === 'INACTIVE') {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_INACTIVE',
                message: ACCOUNT_INACTIVE_MESSAGE,
              });
            }
          },
        },
      },
    },
    plugins: [
      // App Expo: o token da sessão vai no header `set-auth-token` e volta em Authorization.
      bearer(),
      // App Expo: aceita o header expo-origin e devolve o cookie no deep link do OAuth.
      expo(),
      // Só para gerar o OpenAPI (mesclado no /docs-json); a UI própria fica desligada.
      openAPI({ disableDefaultReference: true }),
      // Servidor de autorização do MCP (docs/14-mcp.md, decisão 111). O `jwt` assina os tokens de
      // acesso (JWKS em /v1/auth/jwks); a sessão do app e do web não vira JWT (sem o header
      // `set-auth-jwt` e sem /v1/auth/token, em OAUTH_DISABLED_PATHS).
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        // Login e consentimento no web (MCP.3); o fluxo volta pela query assinada (`oauth_query`).
        loginPage: `${env.WEB_URL}/entrar`,
        consentPage: `${env.WEB_URL}/autorizar`,
        resource: env.MCP_RESOURCE_URL,
        scopes: oauthScopes,
        // Decisão 120: dois recursos, cada um com os seus escopos. O do Super (com
        // MCP_ADMIN_RESOURCE_URL) tem token de atualização de no máximo 24 h, e a conexão inteira
        // também não passa disso (`assertAdminIssuance` e o guard).
        resources: [
          {
            identifier: env.MCP_RESOURCE_URL,
            name: MCP_RESOURCE_NAMES.USER,
            accessTokenTtl: MCP_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenTtl: MCP_REFRESH_TOKEN_TTL_SECONDS,
            allowedScopes: resourceScopes('USER'),
          },
          ...(resourceConfig.admin
            ? [
                {
                  identifier: resourceConfig.admin,
                  name: MCP_RESOURCE_NAMES.ADMIN,
                  accessTokenTtl: MCP_ACCESS_TOKEN_TTL_SECONDS,
                  refreshTokenTtl: MCP_ADMIN_CONNECTION_MAX_AGE_MS / 1000,
                  allowedScopes: resourceScopes('ADMIN'),
                },
              ]
            : []),
        ],
        // O vínculo cliente × recurso do plugin não é a barreira: o recurso do jogador é aberto a
        // todo cliente (como na fase 1), e o do Super é fechado pela MCP_ADMIN_ALLOWED_CLIENT_IDS
        // no authorize, no "Permitir", na emissão e no guard.
        enforcePerClientResources: false,
        // Um consentimento por recurso para o mesmo cliente (o do Super com `referenceId`). O
        // `postLogin` serve só para isso: nunca redireciona.
        postLogin: {
          page: `${env.WEB_URL}/autorizar`,
          shouldRedirect: () => false,
          consentReferenceId: async ({ scopes }) => {
            const query = (await currentOAuthQuery()) ?? '';
            const resources = new URLSearchParams(query).getAll('resource');
            const admin =
              scopes.includes('super:read') ||
              resources.some((url) => mcpResourceKindOf(resourceConfig, url) === 'ADMIN');
            return consentReferenceOf(admin ? 'ADMIN' : 'USER') ?? undefined;
          },
        },
        // A configuração é a fonte de verdade da política do recurso (TTL e escopos).
        resourceSeedMode: 'overwrite',
        accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
        // Só o fluxo do usuário: nada de client_credentials (token sem usuário).
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: env.MCP_DYNAMIC_CLIENT_REGISTRATION,
        allowUnauthenticatedClientRegistration: env.MCP_DYNAMIC_CLIENT_REGISTRATION,
        clientRegistrationRequirePKCE: true,
        // Sem `application_type`, redirect em loopback vira cliente nativo (ex.: Claude Code).
        clientRegistrationDefaultApplicationType: 'infer',
        // CRUD de clientes e recursos pelas rotas do plugin: ninguém (também em OAUTH_DISABLED_PATHS).
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
        rateLimit: {
          token: { window: 60, max: 20 },
          authorize: { window: 60, max: 30 },
          revoke: { window: 60, max: 30 },
          // Registro dinâmico (se ligado): 5 por IP a cada 10 minutos.
          register: { window: 600, max: 5 },
        },
        // Emissão e refresh: conta bloqueada, inativa ou excluída não recebe token (RN-MCP-01); um
        // recurso por token (decisão 120); no do Super, as proteções da decisão 123.
        customAccessTokenClaims: async ({ user, resources }) => {
          if (!user) return {};
          const active = await assertOAuthUserActive(user.id);
          const kinds = (resources ?? []).map((url) => mcpResourceKindOf(resourceConfig, url));
          if (kinds.length !== 1 || !kinds[0]) {
            throw new APIError('BAD_REQUEST', {
              error: 'invalid_target',
              error_description: 'tokens are issued for exactly one resource',
            });
          }
          if (kinds[0] === 'ADMIN') await assertAdminIssuance(user, active.platformRole);
          return { [MCP_CONSENT_CLAIM]: await issuanceConsentId(user.id, kinds[0]) };
        },
      }),
      // Client ID Metadata Document, o registro de cliente padrão da especificação MCP.
      cimd({ fetchClientMetadataResource: cimdFetch, metadataProfile: 'mcp-2026-07-28' }),
      ...(otpSender
        ? [
            phoneNumber({
              otpLength: 6,
              expiresIn: 5 * 60,
              allowedAttempts: 3,
              phoneNumberValidator: (phone) => E164.test(phone),
              sendOTP: async ({ phoneNumber: phone, code }) => {
                await otpSender.sendOtp(phone, code);
              },
              signUpOnVerification: {
                getTempEmail: (phone) => `${phone.slice(1)}${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`,
                // O app pede o nome no primeiro acesso (nome vazio = perfil incompleto).
                getTempName: () => '',
              },
              schema: {
                user: { fields: { phoneNumber: 'phone', phoneNumberVerified: 'phoneVerified' } },
              },
            }),
          ]
        : []),
    ],
    // Rotas do Better Auth que a API não usa (404): CRUD de clientes, introspecção, userinfo etc.
    disabledPaths: OAUTH_DISABLED_PATHS,
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      // No Redis, para valer entre instâncias. Não usamos o secondaryStorage do Better Auth: ele
      // levaria também as sessões para o Redis, e a revogação direto no banco (bloqueio,
      // anonimização) deixaria de valer nas rotas do Better Auth.
      customStorage: redisRateLimitStorage(redis),
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // IP do cliente (rate limit e sessions.ip_address) atrás de proxy reverso.
      ipAddress: {
        ...(env.AUTH_IP_ADDRESS_HEADERS.length
          ? { ipAddressHeaders: env.AUTH_IP_ADDRESS_HEADERS }
          : {}),
        ...(env.AUTH_TRUSTED_PROXIES.length ? { trustedProxies: env.AUTH_TRUSTED_PROXIES } : {}),
      },
      // O id vem do default do banco (uuid v7), como nas demais tabelas.
      database: { generateId: 'uuid' },
      // Em NODE_ENV=test o Better Auth desliga a checagem de origem; aqui ela vale sempre.
      disableOriginCheck: false,
    },
    logger: {
      level: env.NODE_ENV === 'production' ? 'warn' : 'info',
      log: (level, message, ...args) => {
        const context = args.length ? { args } : {};
        if (level === 'error') logger.error(context, message);
        else if (level === 'warn') logger.warn(context, message);
        else logger.log(context, message);
      },
    },
    telemetry: { enabled: false },
  });
}

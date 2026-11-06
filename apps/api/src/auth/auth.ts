import { expo } from '@better-auth/expo';
import { Logger } from '@nestjs/common';
import { brazilianPhoneSchema, INVALID_PHONE_MESSAGE } from '@space-sports/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { bearer, openAPI, phoneNumber } from 'better-auth/plugins';
import { and, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema/index.js';
import type { DomainEvents } from '../events/domain-events.js';
import type { Mailer, MailMessage } from '../mail/mailer.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { normalizeEmail } from '../users/normalize.js';
import { ACCOUNT_INACTIVE_MESSAGE } from './auth.errors.js';
import { resetPasswordEmail, verificationEmail, welcomeEmail } from './auth-emails.js';
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
};

export type Auth = ReturnType<typeof createAuth>;

/** Instância do Better Auth (RF-AUTH-01, RF-AUTH-04) sobre o Drizzle da API. */
export function createAuth({ env, db, mailer, sms, redis, events, storage }: AuthDeps) {
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
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
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

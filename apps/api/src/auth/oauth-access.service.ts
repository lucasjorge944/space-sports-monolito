import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  MCP_MANAGE_SCOPES,
  MCP_RESOURCE_SCOPES,
  MCP_SUPER_SCOPES,
  type McpOAuthScope,
  type McpResourceKind,
  mcpScopesOf,
} from '@space-sports/shared';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import {
  createLocalJWKSet,
  type JSONWebKeySet,
  type JWK,
  type JWTPayload,
  errors as joseErrors,
  jwtVerify,
} from 'jose';
import { z } from 'zod';
import { AppException } from '../common/app.exception.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { auditLogs, jwks, oauthClients, oauthConsents, users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';
import { withinRedisBudget } from '../infra/redis-budget.js';
import { tooManyRequests } from '../me/me.errors.js';
import {
  mcpDisabled,
  oauthInsufficientScope,
  oauthRouteNotAllowed,
  oauthTokenInvalid,
} from './auth.errors.js';
import { AUTH_BASE_PATH } from './auth.js';
import { userColumns } from './auth.service.js';
import type { AuthContext } from './auth-context.js';
import { auditQueryOf, MCP_ADMIN_AUDIT_ACTION, MCP_AUDIT_ORIGIN } from './oauth-origin-context.js';
import {
  adminConnectionExpired,
  consentReferenceCondition,
  type McpResourceConfig,
  mcpResourceConfigOf,
  mcpResourceKindOf,
} from './oauth-resources.js';
import { MCP_ACCESS_TOKEN_TTL_SECONDS, MCP_CONSENT_CLAIM } from './oauth-server.js';
import { type RedisRateLimitStorage, redisRateLimitStorage } from './redis-rate-limit.js';

/** Limites por usuário do token do MCP (RN-MCP-03), além dos limites que a API já tem. */
export const MCP_RATE_LIMITS = {
  read: { window: 60, max: 60 },
  write: { window: 10 * 60, max: 10 },
} as const;

/** `typ` do token de acesso JWT do Better Auth (RFC 9068). */
const ACCESS_TOKEN_TYPE = 'at+jwt';
/** Algoritmos de assinatura aceitos (os do plugin `jwt`; o padrão é EdDSA/Ed25519). */
const ALGORITHMS = ['EdDSA', 'ES256', 'ES512', 'PS256', 'RS256'];
/**
 * Uma chave vencida (rotação) ainda valida tokens por quanto um token dura, mais 5 min de folga:
 * nenhum token assinado com ela passa disso.
 */
const KEY_GRACE_MS = (MCP_ACCESS_TOKEN_TTL_SECONDS + 5 * 60) * 1000;
/** As chaves mudam raramente (só com rotação): cache curto, recarregado se aparecer `kid` novo. */
const KEYS_TTL_MS = 5 * 60 * 1000;
const KEYS_RELOAD_MIN_INTERVAL_MS = 10 * 1000;
/** "Último uso" gravado no máximo 1 vez por hora por (usuário, cliente) em cada instância. */
const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;
const LAST_USED_MAX_ENTRIES = 10_000;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const uuid = z.uuid();
/** Escopos cujas rotas respondem com a visão do MCP (lista de campos permitidos, decisão 122). */
const VIEW_SCOPES = new Set<McpOAuthScope>([...MCP_MANAGE_SCOPES, ...MCP_SUPER_SCOPES]);

/** A requisição em andamento, para a auditoria do token do Super (decisão 123). */
export type OAuthRequestInfo = {
  /** URL original (caminho e query). */
  originalUrl: string;
  /** Resposta: o resultado (status e código do erro) entra na auditoria quando ela fecha. */
  response?: {
    statusCode: number;
    writableFinished: boolean;
    locals?: Record<string, unknown>;
    once(event: 'close', listener: () => void): unknown;
  };
};

/**
 * A rota aceita o token deste recurso (decisão 120)? Cada recurso tem a sua lista: o do jogador,
 * as rotas de jogador e de gestão (inclusive as de "qualquer escopo", `@OAuthScopes()`); o do
 * Super, só as rotas com `super:read`.
 */
export function routeAcceptsResource(
  kind: McpResourceKind,
  requiredScopes: readonly McpOAuthScope[],
): boolean {
  const allowed = MCP_RESOURCE_SCOPES[kind];
  if (kind === 'ADMIN' && requiredScopes.length === 0) return false;
  return requiredScopes.every((scope) => allowed.includes(scope));
}
/** Três partes base64url: o formato do JWT. O token da sessão do app nunca tem esse formato. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Conta bloqueada ou inativa com o token do MCP: 401, para o assistente parar (RN-MCP-01). */
const oauthUserInactive = (code: 'USER_BLOCKED' | 'ACCOUNT_INACTIVE') =>
  new AppException({
    status: HttpStatus.UNAUTHORIZED,
    code,
    message:
      code === 'USER_BLOCKED'
        ? 'Conta bloqueada.'
        : 'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.',
  });

/**
 * Bearer com formato de JWT: é o token OAuth do MCP (a sessão do app usa um token opaco). Fica
 * sempre neste caminho, mesmo inválido: nunca cai na validação de sessão.
 */
export function oauthBearerOf(req: Pick<Request, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const token = match?.[1];
  return token && JWT_SHAPE.test(token) ? token : null;
}

/**
 * Token OAuth do MCP (decisões 112, 120 e 123; RN-MCP-01, RN-MCP-03, RN-MCP-04, RN-MCP-08): valida
 * a assinatura pelo JWKS local (tabela `jwks`), o emissor, a audiência (um dos recursos), a
 * validade, o usuário ativo e a conexão do token (claim `consent_id`) ainda de pé como o
 * consentimento atual do recurso; confere a lista permitida do recurso e os escopos da rota e
 * aplica os limites por usuário. No recurso do Super, também a chave própria, a lista de clientes
 * e as 24 h da conexão. O token nunca vira sessão.
 */
@Injectable()
export class OAuthAccessService {
  private readonly logger = new Logger(OAuthAccessService.name);
  private readonly issuer: string;
  private readonly resources: McpResourceConfig;
  private readonly audiences: string[];
  private readonly rateLimit: RedisRateLimitStorage;
  private keys: { set: ReturnType<typeof createLocalJWKSet>; loadedAt: number } | null = null;
  private readonly lastUsed = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    // O `iss` dos tokens é a URL base do Better Auth (BETTER_AUTH_URL + /v1/auth).
    this.issuer = `${env.BETTER_AUTH_URL.replace(/\/+$/, '')}${AUTH_BASE_PATH}`;
    this.resources = mcpResourceConfigOf(env);
    this.audiences = [this.resources.user, ...(this.resources.admin ? [this.resources.admin] : [])];
    this.rateLimit = redisRateLimitStorage(redis);
  }

  /**
   * Contexto de autenticação do token do MCP para a rota. `requiredScopes` vem do
   * `@OAuthScopes` (indefinido = rota fora da lista permitida); `hasView`, do `@OAuthView`.
   */
  async authenticate(
    token: string,
    route: {
      method: string;
      requiredScopes: readonly McpOAuthScope[] | undefined;
      hasView?: boolean;
      request?: OAuthRequestInfo;
    },
  ): Promise<AuthContext> {
    if (!this.env.MCP_ENABLED) throw mcpDisabled();
    const claims = await this.verify(token);
    const kind = this.resourceOf(claims);
    // Decisão 123: todo token do Super válido (assinatura e audiência) fica auditado, inclusive o
    // que os passos seguintes recusam (chave, rota, escopo, conexão, limite e os guards de papel).
    if (kind === 'ADMIN') await this.auditAdminRequest(claims, route.method, route.request);
    if (kind === 'ADMIN' && !this.env.MCP_ADMIN_ENABLED) throw mcpDisabled();
    if (!route.requiredScopes || !routeAcceptsResource(kind, route.requiredScopes)) {
      throw oauthRouteNotAllowed();
    }
    const viewRoute = route.requiredScopes.some((scope) => VIEW_SCOPES.has(scope));
    // Gestão e Super são só leitura pelo MCP: qualquer método fora o GET é recusado.
    if (viewRoute && route.method !== 'GET') throw oauthRouteNotAllowed();
    // Decisão 122: rota de gestão ou do Super sem a lista de campos permitidos nunca responde ao
    // token do MCP (falha fechada; o teste da lista confere que todas têm a visão).
    if (viewRoute && !route.hasView) {
      this.logger.error('Rota de gestão/Super na lista do MCP sem @OAuthView');
      throw oauthRouteNotAllowed();
    }

    const sub = claims.sub;
    const clientId = typeof claims.azp === 'string' ? claims.azp : null;
    if (!sub || !uuid.safeParse(sub).success || !clientId) throw oauthTokenInvalid();
    if (kind === 'ADMIN' && !this.env.MCP_ADMIN_ALLOWED_CLIENT_IDS.includes(clientId)) {
      throw oauthTokenInvalid();
    }
    const [row] = await this.db
      .select({
        ...userColumns,
        deletedAt: users.deletedAt,
        consentId: oauthConsents.id,
        consentCreatedAt: oauthConsents.createdAt,
        consentScopes: oauthConsents.scopes,
        knownClientId: oauthClients.clientId,
        clientDisabled: oauthClients.disabled,
      })
      .from(users)
      .leftJoin(
        oauthConsents,
        and(
          eq(oauthConsents.userId, users.id),
          eq(oauthConsents.clientId, clientId),
          consentReferenceCondition(kind),
        ),
      )
      .leftJoin(oauthClients, eq(oauthClients.clientId, clientId))
      .where(eq(users.id, sub))
      .limit(1);
    // Conta excluída, app desconectado ("Apps conectados") ou cliente desativado: o token morre
    // na hora, sem esperar os 15 minutos. Token de outra conexão (desconectou e conectou de novo)
    // também: ele leva o id do consentimento em que foi emitido, e a nova autorização, com outro
    // consentimento, não ressuscita os tokens da anterior, nem no mesmo segundo (BUG-MCP2-1). No
    // recurso do Super, a conexão vale 24 h desde o consentimento (decisão 123).
    if (
      !row ||
      row.deletedAt ||
      !row.consentId ||
      !row.consentCreatedAt ||
      claims[MCP_CONSENT_CLAIM] !== row.consentId ||
      (kind === 'ADMIN' && adminConnectionExpired(row.consentCreatedAt)) ||
      !row.knownClientId ||
      row.clientDisabled === true
    ) {
      throw oauthTokenInvalid();
    }
    if (row.status === 'BLOCKED') throw oauthUserInactive('USER_BLOCKED');
    if (row.status === 'INACTIVE') throw oauthUserInactive('ACCOUNT_INACTIVE');

    // Escopos efetivos: os do token, do recurso, que o consentimento atual ainda cobre.
    const consented = new Set(row.consentScopes ?? []);
    const scopes = mcpScopesOf(typeof claims.scope === 'string' ? claims.scope : '', kind).filter(
      (scope) => consented.has(scope),
    );
    const missing = route.requiredScopes.filter((scope) => !scopes.includes(scope));
    if (missing.length || scopes.length === 0) {
      throw oauthInsufficientScope(missing.length ? missing : route.requiredScopes);
    }

    await this.consumeRateLimit(sub, READ_METHODS.has(route.method) ? 'read' : 'write');
    this.touchLastUsed(sub, clientId, kind);

    const {
      deletedAt: _deleted,
      consentId: _consent,
      consentCreatedAt: _consentCreatedAt,
      consentScopes: _consentScopes,
      knownClientId: _client,
      clientDisabled: _disabled,
      ...user
    } = row;
    return {
      user,
      session: null,
      oauth: {
        clientId,
        resource: kind,
        scopes,
        tokenId: typeof claims.jti === 'string' ? claims.jti : '',
        expiresAt: new Date((claims.exp ?? 0) * 1000),
      },
    };
  }

  /**
   * Auditoria do token do Super (decisão 123, RN-MCP-08): grava `mcp.admin_request` antes de
   * qualquer outra checagem (origem `MCP`, cliente, método, caminho e query; nunca o token nem o
   * corpo da resposta) e, quando a resposta fecha, completa com o resultado (`status`, `code` do
   * erro e se a resposta foi até o fim). Sem conseguir gravar, recusa (falha fechada).
   */
  private async auditAdminRequest(
    claims: JWTPayload,
    method: string,
    request: OAuthRequestInfo | undefined,
  ): Promise<void> {
    const url = request?.originalUrl ?? '';
    const diff = {
      method,
      path: url.split('?')[0] ?? '',
      query: auditQueryOf(url),
      origin: MCP_AUDIT_ORIGIN,
      oauthClientId: typeof claims.azp === 'string' ? claims.azp : null,
    };
    let auditId: string;
    try {
      const [row] = await this.db
        .insert(auditLogs)
        .values({
          actorId:
            typeof claims.sub === 'string' && uuid.safeParse(claims.sub).success
              ? claims.sub
              : null,
          spaceId: null,
          action: MCP_ADMIN_AUDIT_ACTION,
          entity: 'mcp_request',
          entityId: null,
          diff: { ...diff, result: null },
        })
        .returning({ id: auditLogs.id });
      if (!row) throw new Error('Linha de auditoria não criada.');
      auditId = row.id;
    } catch (err) {
      this.logger.error({ err }, 'Falha ao auditar o token do Super');
      throw oauthTokenInvalid();
    }
    const response = request?.response;
    response?.once('close', () => {
      const code = response.locals?.errorCode;
      const result = {
        status: response.statusCode,
        code: typeof code === 'string' ? code : null,
        completed: response.writableFinished,
      };
      this.db
        .update(auditLogs)
        .set({ diff: { ...diff, result } })
        .where(eq(auditLogs.id, auditId))
        .catch((err: unknown) => {
          this.logger.error({ err }, 'Falha ao gravar o resultado na auditoria do token do Super');
        });
    });
  }

  /** Recurso do token pela audiência: exatamente um, e um dos configurados (senão, 401). */
  private resourceOf(claims: JWTPayload): McpResourceKind {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const kind = aud.length === 1 ? mcpResourceKindOf(this.resources, aud[0]) : null;
    if (!kind) throw oauthTokenInvalid();
    return kind;
  }

  /** Assinatura (JWKS local), `typ`, emissor, audiência e validade; qualquer falha é 401. */
  private async verify(token: string): Promise<JWTPayload> {
    const options = {
      issuer: this.issuer,
      audience: this.audiences,
      algorithms: ALGORITHMS,
      typ: ACCESS_TOKEN_TYPE,
      requiredClaims: ['sub', 'exp', 'iat', 'azp', 'scope'],
      clockTolerance: 5,
    };
    try {
      const { payload } = await jwtVerify(token, await this.keySet(), options);
      return payload;
    } catch (err) {
      // Chave nova (rotação) ainda fora do cache: recarrega uma vez.
      if (err instanceof joseErrors.JWKSNoMatchingKey && this.canReloadKeys()) {
        try {
          const { payload } = await jwtVerify(token, await this.keySet(true), options);
          return payload;
        } catch {
          throw oauthTokenInvalid();
        }
      }
      throw oauthTokenInvalid();
    }
  }

  private canReloadKeys(): boolean {
    return !this.keys || Date.now() - this.keys.loadedAt > KEYS_RELOAD_MIN_INTERVAL_MS;
  }

  /** JWKS público lido da tabela `jwks` (a mesma que o Better Auth publica em /v1/auth/jwks). */
  private async keySet(reload = false): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (!reload && this.keys && Date.now() - this.keys.loadedAt < KEYS_TTL_MS) {
      return this.keys.set;
    }
    const rows = await this.db
      .select({
        id: jwks.id,
        publicKey: jwks.publicKey,
        alg: jwks.alg,
        crv: jwks.crv,
        expiresAt: jwks.expiresAt,
      })
      .from(jwks);
    const now = Date.now();
    const keys: JWK[] = rows
      .filter((row) => !row.expiresAt || row.expiresAt.getTime() + KEY_GRACE_MS > now)
      .map((row) => ({
        ...(JSON.parse(row.publicKey) as JWK),
        kid: row.id,
        alg: row.alg ?? 'EdDSA',
        ...(row.crv ? { crv: row.crv } : {}),
      }));
    const set = createLocalJWKSet({ keys } satisfies JSONWebKeySet);
    this.keys = { set, loadedAt: now };
    return set;
  }

  private async consumeRateLimit(userId: string, kind: 'read' | 'write'): Promise<void> {
    if (!this.env.MCP_RATE_LIMIT_ENABLED) return;
    const { allowed, retryAfter } = await withinRedisBudget(
      Promise.resolve(this.rateLimit.consume(`mcp:${kind}:${userId}`, MCP_RATE_LIMITS[kind])),
    ).catch(() => ({ allowed: true, retryAfter: null }));
    if (!allowed) throw tooManyRequests({ retryAfter });
  }

  /**
   * "Último uso" da conexão (decisão 116), sem escrever no banco a cada requisição: no máximo 1 vez
   * por hora por (usuário, cliente) em cada instância, e o UPDATE só muda a linha se o valor
   * gravado tiver mais de 1 hora. Não segura a resposta; falha só vai para o log.
   */
  private touchLastUsed(userId: string, clientId: string, kind: McpResourceKind): void {
    const key = `${userId}|${clientId}|${kind}`;
    const now = Date.now();
    const last = this.lastUsed.get(key);
    if (last !== undefined && now - last < LAST_USED_INTERVAL_MS) return;
    if (this.lastUsed.size >= LAST_USED_MAX_ENTRIES) {
      for (const [entry, at] of this.lastUsed) {
        if (now - at >= LAST_USED_INTERVAL_MS) this.lastUsed.delete(entry);
      }
      if (this.lastUsed.size >= LAST_USED_MAX_ENTRIES) this.lastUsed.clear();
    }
    this.lastUsed.set(key, now);
    const usedAt = new Date(now);
    this.db
      .update(oauthConsents)
      .set({ lastUsedAt: usedAt })
      .where(
        and(
          eq(oauthConsents.userId, userId),
          eq(oauthConsents.clientId, clientId),
          consentReferenceCondition(kind),
          or(
            isNull(oauthConsents.lastUsedAt),
            lt(oauthConsents.lastUsedAt, new Date(now - LAST_USED_INTERVAL_MS)),
          ),
        ),
      )
      .catch((err: unknown) => {
        this.lastUsed.delete(key);
        this.logger.warn({ err }, 'Falha ao gravar o último uso do app conectado');
      });
  }
}

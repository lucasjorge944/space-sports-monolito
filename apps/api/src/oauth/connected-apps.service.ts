import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ConnectedApp,
  MCP_ADMIN_CONNECTION_MAX_AGE_SECONDS,
  MCP_RESOURCE_NAMES,
  MCP_RESOURCE_SCOPES,
  mcpScopesOf,
  type OAuthConsentRequest,
} from '@space-sports/shared';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import {
  eligibleScopes,
  loadOAuthEligibility,
  MCP_ADMIN_CONNECTION_MAX_AGE_MS,
  mcpResourceConfigOf,
  mcpResourceKindOf,
  resourceKindOfReference,
} from '../auth/oauth-resources.js';
import { audit } from '../bookings/db-utils.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { oauthClientNotFound, oauthRequestInvalid } from './oauth.errors.js';

const UNNAMED_CLIENT = 'Aplicativo sem nome';

type ClientRow = {
  clientId: string;
  name: string | null;
  uri: string | null;
  icon: string | null;
};

/** Domínio do `client_id` quando ele é uma URL HTTPS (CIMD: o documento veio desse domínio). */
function clientHost(clientId: string): string | null {
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

/** URL http(s) declarada pelo cliente; outro esquema (ex.: `javascript:`) não chega às telas. */
function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Só os parâmetros assinados da query de `/autorizar` (como o `buildSignedOAuthQuery` do cliente
 * do Better Auth): `sig`, `ba_param` e os nomes listados em `ba_param`. Um parâmetro a mais na URL
 * não quebra a assinatura nem entra na resposta.
 */
export function signedOAuthQuery(search: string): string | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const names = new Set(params.getAll('ba_param'));
  if (!params.has('sig') || names.size === 0) return null;
  const signed = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === 'sig' || key === 'ba_param' || names.has(key)) signed.append(key, value);
  }
  return signed.toString();
}

function clientInfo(row: ClientRow) {
  const host = clientHost(row.clientId);
  return {
    clientId: row.clientId,
    name: row.name?.trim() || host || UNNAMED_CLIENT,
    host,
    uri: safeUrl(row.uri),
    logoUrl: safeUrl(row.icon),
  };
}

/**
 * Consentimento e apps conectados do MCP (decisões 111 e 116; RF-MCP-01, RF-MCP-05, RN-MCP-04).
 * Só a sessão do app e do web chega aqui: as rotas não aceitam o token do MCP.
 */
@Injectable()
export class ConnectedAppsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Pedido de consentimento de `/autorizar`: confere a assinatura e a validade da query (o mesmo
   * segredo do Better Auth) e devolve o cliente, o conector e os escopos que o servidor vai
   * conceder a este usuário (pedidos ∩ elegíveis, RN-MCP-06), como o "Permitir" fará.
   */
  async consentRequest(oauthQuery: string, userId: string): Promise<OAuthConsentRequest> {
    const query = signedOAuthQuery(oauthQuery);
    const { secret } = await this.auth.$context;
    if (!query || !(await verifyOAuthQueryParams(query, secret))) throw oauthRequestInvalid();
    const params = new URLSearchParams(query);
    const clientId = params.get('client_id');
    const exp = Number(params.get('exp'));
    const resources = params.getAll('resource');
    const kind =
      resources.length === 1
        ? mcpResourceKindOf(mcpResourceConfigOf(this.env), resources[0])
        : null;
    if (!clientId || !Number.isFinite(exp) || !kind) throw oauthRequestInvalid();

    const [client] = await this.db
      .select({
        clientId: oauthClients.clientId,
        name: oauthClients.name,
        uri: oauthClients.uri,
        icon: oauthClients.icon,
        disabled: oauthClients.disabled,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    if (!client || client.disabled) throw oauthClientNotFound();
    const requested = mcpScopesOf(params.get('scope'), kind);
    const eligibility = await loadOAuthEligibility(this.db, userId);
    const eligible = new Set(eligibility ? eligibleScopes(kind, eligibility) : []);
    // O Super só autoriza clientes da lista e com o recurso ligado; fora disso, nada a conceder.
    const adminBlocked =
      kind === 'ADMIN' &&
      (!this.env.MCP_ADMIN_ENABLED || !this.env.MCP_ADMIN_ALLOWED_CLIENT_IDS.includes(clientId));
    const scopes = adminBlocked ? [] : requested.filter((scope) => eligible.has(scope));
    // O authorize já tirou da query o que a conta não pode usar: a tela explica pelo conector.
    const deniedScopes = MCP_RESOURCE_SCOPES[kind].filter(
      (scope) => adminBlocked || !eligible.has(scope),
    );
    return {
      client: clientInfo(client),
      resource: {
        kind,
        name: MCP_RESOURCE_NAMES[kind],
        maxConnectionHours: kind === 'ADMIN' ? MCP_ADMIN_CONNECTION_MAX_AGE_SECONDS / 3600 : null,
      },
      scopes,
      deniedScopes,
      canAuthorize: scopes.length > 0,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** Clientes que o usuário autorizou, do mais recente para o mais antigo. */
  async list(userId: string): Promise<ConnectedApp[]> {
    const rows = await this.db
      .select({
        id: oauthConsents.id,
        referenceId: oauthConsents.referenceId,
        scopes: oauthConsents.scopes,
        createdAt: oauthConsents.createdAt,
        lastUsedAt: oauthConsents.lastUsedAt,
        clientId: oauthClients.clientId,
        name: oauthClients.name,
        uri: oauthClients.uri,
        icon: oauthClients.icon,
      })
      .from(oauthConsents)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
      .where(eq(oauthConsents.userId, userId))
      .orderBy(desc(oauthConsents.createdAt), desc(oauthConsents.id));
    return rows.map((row) => {
      const kind = resourceKindOfReference(row.referenceId);
      return {
        id: row.id,
        ...clientInfo(row),
        resource: { kind, name: MCP_RESOURCE_NAMES[kind] },
        scopes: mcpScopesOf(row.scopes, kind),
        authorizedAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt:
          kind === 'ADMIN'
            ? new Date(row.createdAt.getTime() + MCP_ADMIN_CONNECTION_MAX_AGE_MS).toISOString()
            : null,
      };
    });
  }

  /**
   * "Desconectar" (RN-MCP-04): revoga os tokens de atualização (e os de acesso opacos) do usuário
   * naquele cliente e naquele conector (o mesmo cliente pode estar nos dois, decisão 120) e apaga
   * o consentimento. Sem o consentimento, o token de acesso JWT em uso também deixa de valer na
   * API. Idempotente: conexão inexistente ou de outro usuário não muda nada.
   */
  async disconnect(userId: string, connectionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [consent] = await tx
        .select({
          id: oauthConsents.id,
          clientId: oauthConsents.clientId,
          referenceId: oauthConsents.referenceId,
        })
        .from(oauthConsents)
        .where(and(eq(oauthConsents.id, connectionId), eq(oauthConsents.userId, userId)))
        .for('update');
      if (!consent) return;
      const now = new Date();
      const kind = resourceKindOfReference(consent.referenceId);
      // Os tokens do conector da conexão: o do Super tem `referenceId`; os do jogador, não.
      const refreshOfResource =
        kind === 'ADMIN'
          ? eq(oauthRefreshTokens.referenceId, consent.referenceId ?? '')
          : or(isNull(oauthRefreshTokens.referenceId), eq(oauthRefreshTokens.referenceId, ''));
      const accessOfResource =
        kind === 'ADMIN'
          ? eq(oauthAccessTokens.referenceId, consent.referenceId ?? '')
          : or(isNull(oauthAccessTokens.referenceId), eq(oauthAccessTokens.referenceId, ''));
      await tx
        .update(oauthRefreshTokens)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthRefreshTokens.userId, userId),
            eq(oauthRefreshTokens.clientId, consent.clientId),
            refreshOfResource,
            isNull(oauthRefreshTokens.revoked),
          ),
        );
      await tx
        .update(oauthAccessTokens)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthAccessTokens.userId, userId),
            eq(oauthAccessTokens.clientId, consent.clientId),
            accessOfResource,
            isNull(oauthAccessTokens.revoked),
          ),
        );
      await tx.delete(oauthConsents).where(eq(oauthConsents.id, consent.id));
      await audit(tx, {
        actorId: userId,
        spaceId: null,
        action: 'oauth_consent.revoke',
        entity: 'oauth_consent',
        entityId: consent.id,
        diff: { oauthClientId: consent.clientId, resource: kind },
      });
    });
  }
}

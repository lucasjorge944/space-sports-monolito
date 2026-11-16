import type { SpaceRole } from '@space-sports/shared';
import { describe, expect, it } from 'vitest';
import {
  adminConnectionExpired,
  eligibleScopes,
  MCP_ADMIN_CONNECTION_MAX_AGE_MS,
  mcpResourceKindOf,
  requestsOnlyProtocolScopes,
  scopeForResource,
} from './oauth-resources.js';
import { type AuthorizeResourcePolicy, authorizeResourceOf } from './oauth-server.js';

const PLAYER = ['spaces:read', 'bookings:read', 'bookings:write', 'classes:read', 'classes:write'];
const config = { user: 'https://mcp.example.com/mcp', admin: 'https://mcp-admin.example.com/mcp' };
const facts = (platformRole: 'USER' | 'SUPER', ...roles: SpaceRole[]) => ({
  platformRole,
  spaceRoles: new Set(roles),
});

describe('escopos concedíveis por papel (RN-MCP-06, decisões 121 e 123)', () => {
  it('recurso do jogador: jogador sempre; gestão com papel; valores só para Dono e Admin', () => {
    expect(eligibleScopes('USER', facts('USER'))).toEqual(PLAYER);
    expect(eligibleScopes('USER', facts('USER', 'TEACHER'))).toEqual([...PLAYER, 'manage:read']);
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(eligibleScopes('USER', facts('USER', role))).toEqual([
        ...PLAYER,
        'manage:read',
        'manage:finance:read',
      ]);
    }
    // O Super sem papel em espaço é só jogador neste recurso.
    expect(eligibleScopes('USER', facts('SUPER'))).toEqual(PLAYER);
  });

  it('recurso do Super: só o Super, e só super:read', () => {
    expect(eligibleScopes('ADMIN', facts('SUPER', 'OWNER'))).toEqual(['super:read']);
    expect(eligibleScopes('ADMIN', facts('USER', 'OWNER', 'ADMIN'))).toEqual([]);
  });

  it('scope do pedido restrito ao recurso, com offline_access', () => {
    expect(scopeForResource('USER', 'super:read manage:read spaces:read x')).toEqual({
      scope: 'spaces:read manage:read offline_access',
      permissions: ['spaces:read', 'manage:read'],
    });
    expect(scopeForResource('ADMIN', undefined).scope).toBe('super:read offline_access');
    expect(scopeForResource('USER', 'manage:finance:read spaces:read', PLAYER as never)).toEqual({
      scope: 'spaces:read offline_access',
      permissions: ['spaces:read'],
    });
    expect(scopeForResource('ADMIN', 'super:read', []).permissions).toEqual([]);
  });

  it('recurso pela URL e conexão do Super de no máximo 24 h', () => {
    expect(mcpResourceKindOf(config, config.user)).toBe('USER');
    expect(mcpResourceKindOf(config, config.admin)).toBe('ADMIN');
    expect(mcpResourceKindOf({ ...config, admin: null }, config.admin)).toBeNull();
    expect(mcpResourceKindOf(config, [config.user])).toBeNull();
    const now = Date.now();
    expect(
      adminConnectionExpired(new Date(now - MCP_ADMIN_CONNECTION_MAX_AGE_MS + 1000), now),
    ).toBe(false);
    expect(adminConnectionExpired(new Date(now - MCP_ADMIN_CONNECTION_MAX_AGE_MS), now)).toBe(true);
  });
});

describe('authorizeResourceOf (decisões 120 e 123)', () => {
  const policy: AuthorizeResourcePolicy = {
    resources: config,
    adminEnabled: true,
    adminClientIds: new Set(['https://claude.example.com/client.json']),
  };
  const rejected: string[] = [];
  const of = (params: Record<string, unknown>, override: Partial<AuthorizeResourcePolicy> = {}) =>
    authorizeResourceOf(params, { ...policy, ...override }, (id) => rejected.push(id));

  it('um recurso só, e um dos configurados', () => {
    expect(of({ resource: config.user })).toEqual({ kind: 'USER', resource: config.user });
    expect(of({ resource: [config.user] })).toEqual({ kind: 'USER', resource: config.user });
    for (const resource of [[config.user, config.admin], 'https://outro.example.com/mcp', '']) {
      expect(() => of({ resource })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('Super: chave ligada e cliente da lista; o recusado vai para o log', () => {
    expect(
      of({ resource: config.admin, client_id: 'https://claude.example.com/client.json' }).kind,
    ).toBe('ADMIN');
    expect(() => of({ resource: config.admin, client_id: 'https://x.example/c.json' })).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
    expect(rejected).toEqual(['https://x.example/c.json']);
    expect(() =>
      of(
        { resource: config.admin, client_id: 'https://claude.example.com/client.json' },
        { adminEnabled: false },
      ),
    ).toThrow(expect.objectContaining({ statusCode: 503 }));
    // O recurso do jogador não depende da chave nem da lista do Super.
    expect(
      of({ resource: config.user }, { adminEnabled: false, adminClientIds: new Set() }).kind,
    ).toBe('USER');
  });
});

describe('requestsOnlyProtocolScopes', () => {
  it('só offline_access (ou vazio) vale como pedido sem escopo do recurso', () => {
    expect(requestsOnlyProtocolScopes('offline_access')).toBe(true);
    expect(requestsOnlyProtocolScopes('')).toBe(true);
    expect(requestsOnlyProtocolScopes(' offline_access ')).toBe(true);
    expect(requestsOnlyProtocolScopes(undefined)).toBe(false);
    expect(requestsOnlyProtocolScopes('super:read offline_access')).toBe(false);
    expect(requestsOnlyProtocolScopes('spaces:read')).toBe(false);
  });
});

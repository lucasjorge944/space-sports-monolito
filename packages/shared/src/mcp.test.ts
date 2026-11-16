import { describe, expect, it } from 'vitest';
import {
  isMcpOAuthScope,
  MCP_ALL_OAUTH_SCOPES,
  MCP_OAUTH_SCOPE_LABELS,
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
  mcpScopeGroupOf,
  mcpScopesOf,
} from './mcp';

describe('escopos do MCP', () => {
  it('os cinco da fase 1 (decisão 111) não mudam', () => {
    expect(MCP_OAUTH_SCOPES).toEqual([
      'spaces:read',
      'bookings:read',
      'bookings:write',
      'classes:read',
      'classes:write',
    ]);
  });

  it('todos os escopos têm texto em português', () => {
    expect(MCP_ALL_OAUTH_SCOPES).toEqual([
      ...MCP_OAUTH_SCOPES,
      'manage:read',
      'manage:finance:read',
      'super:read',
    ]);
    for (const scope of MCP_ALL_OAUTH_SCOPES) expect(MCP_OAUTH_SCOPE_LABELS[scope]).toMatch(/\S/);
  });

  it('separa os escopos por recurso (decisão 120): o Super só no recurso dele', () => {
    expect(MCP_RESOURCE_SCOPES.USER).toEqual([
      ...MCP_OAUTH_SCOPES,
      'manage:read',
      'manage:finance:read',
    ]);
    expect(MCP_RESOURCE_SCOPES.ADMIN).toEqual(['super:read']);
    expect(mcpScopesOf('super:read manage:read spaces:read', 'USER')).toEqual([
      'spaces:read',
      'manage:read',
    ]);
    expect(mcpScopesOf('super:read manage:read spaces:read', 'ADMIN')).toEqual(['super:read']);
    expect(mcpScopeGroupOf('bookings:write')).toBe('PLAYER');
    expect(mcpScopeGroupOf('manage:finance:read')).toBe('MANAGE');
    expect(mcpScopeGroupOf('super:read')).toBe('SUPER');
  });

  it('filtra e ordena: descarta offline_access e escopos desconhecidos', () => {
    expect(mcpScopesOf('classes:write offline_access spaces:read admin super:read')).toEqual([
      'spaces:read',
      'classes:write',
      'super:read',
    ]);
    expect(mcpScopesOf(['bookings:write', 'bookings:read', 'bookings:read'])).toEqual([
      'bookings:read',
      'bookings:write',
    ]);
    expect(mcpScopesOf(null)).toEqual([]);
    expect(isMcpOAuthScope('offline_access')).toBe(false);
    expect(isMcpOAuthScope('bookings:write')).toBe(true);
    expect(isMcpOAuthScope('manage:read')).toBe(true);
  });
});

import type { ConnectedAppListItemsItem } from '@space-sports/api-client';

export function connectedApp(
  extra: Partial<ConnectedAppListItemsItem> = {},
): ConnectedAppListItemsItem {
  return {
    id: '0192f0a0-0000-7000-8000-0000000000c1',
    clientId: 'https://claude.ai/oauth/mcp-client.json',
    name: 'Claude',
    host: 'claude.ai',
    uri: 'https://claude.ai',
    logoUrl: null,
    resource: { kind: 'USER', name: 'Space Sports' },
    scopes: ['spaces:read', 'bookings:read', 'bookings:write'],
    authorizedAt: '2026-11-10T15:30:00.000Z',
    lastUsedAt: '2026-11-12T02:10:00.000Z',
    expiresAt: null,
    ...extra,
  };
}

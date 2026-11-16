import {
  connectedAtLabel,
  DEFAULT_MCP_CONNECT_URL,
  disconnectConfirmation,
  expiresAtLabel,
  lastUsedLabel,
  MCP_CONNECT_URL,
  normalizeMcpUrl,
  scopeGroups,
  showScopeGroupTitles,
} from './labels';

describe('Apps conectados: textos (RF-MCP-05)', () => {
  it('escopos em português, agrupados e na ordem canônica, sem offline_access nem desconhecidos', () => {
    const groups = scopeGroups([
      'super:read',
      'manage:read',
      'classes:write',
      'offline_access',
      'x:y',
      'spaces:read',
    ]);
    expect(groups.map((g) => [g.group, g.title])).toEqual([
      ['PLAYER', 'Como jogador'],
      ['MANAGE', 'Gestão dos seus espaços'],
      ['SUPER', 'Painel da plataforma'],
    ]);
    expect(groups[0]?.labels).toEqual([
      'Ver espaços, quadras, horários e aulas',
      'Confirmar e desmarcar presença em aulas',
    ]);
  });

  it('títulos de grupo só quando há mais de um grupo ou o grupo não é o de jogador', () => {
    expect(showScopeGroupTitles(scopeGroups(['spaces:read', 'bookings:read']))).toBe(false);
    expect(showScopeGroupTitles(scopeGroups(['spaces:read', 'manage:read']))).toBe(true);
    expect(showScopeGroupTitles(scopeGroups(['super:read']))).toBe(true);
  });

  it('prazo da conexão: sem expiração, vigente e vencido (fuso de São Paulo)', () => {
    const at = '2026-11-13T22:00:00.000Z';
    const deadline = Date.parse(at);
    expect(expiresAtLabel(null)).toBeNull();
    expect(expiresAtLabel(at, deadline - 1)).toEqual({
      text: 'Esta conexão expira em 13/11/2026, 19:00',
      expired: false,
    });
    // No instante exato do prazo, a conexão já venceu.
    expect(expiresAtLabel(at, deadline)).toEqual({
      text: 'Conexão expirada em 13/11/2026, 19:00. Conecte de novo no assistente.',
      expired: true,
    });
    expect(expiresAtLabel(at, deadline + 60_000)?.expired).toBe(true);
  });

  it('datas no fuso de São Paulo', () => {
    // 02:10 UTC do dia 12 ainda é dia 11 em São Paulo (UTC-3).
    expect(connectedAtLabel('2026-11-10T15:30:00.000Z')).toBe('Conectado em 10/11/2026');
    expect(lastUsedLabel('2026-11-12T02:10:00.000Z')).toBe('Último uso: 11/11/2026');
  });

  it('sem uso registrado', () => {
    expect(lastUsedLabel(null)).toBe('Ainda não usado');
  });

  it('confirmação cita o app', () => {
    expect(disconnectConfirmation('Claude').title).toBe('Desconectar Claude?');
  });

  it('URL do conector vem de EXPO_PUBLIC_MCP_URL, sem espaços nem barra final', () => {
    expect(normalizeMcpUrl(' https://mcp-staging.exemplo.com/mcp/ ')).toBe(
      'https://mcp-staging.exemplo.com/mcp',
    );
    expect(normalizeMcpUrl('http://localhost:3340/mcp')).toBe('http://localhost:3340/mcp');
  });

  it('sem EXPO_PUBLIC_MCP_URL (ou vazia), vale o padrão', () => {
    expect(normalizeMcpUrl(undefined)).toBe(DEFAULT_MCP_CONNECT_URL);
    expect(normalizeMcpUrl('   ')).toBe(DEFAULT_MCP_CONNECT_URL);
    expect(MCP_CONNECT_URL).toBe(normalizeMcpUrl(process.env.EXPO_PUBLIC_MCP_URL));
  });
});

import type { Client } from '@modelcontextprotocol/client';
import { formatCents } from '@space-sports/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONTACT_REDACTED, FREE_TEXT_MAX_LENGTH } from '../src/shared/contacts.js';
import { LONG_DESCRIPTION_SPACE, SUPER_CONTACTS, SUPER_USER, USERS } from './support/fake-super.js';
import { SPACES } from './support/fixtures.js';
import { callTool, type Harness, startHarness } from './support/harness.js';

// Superfície `admin` (conector "Space Sports · Plataforma"; MCP2.4; docs/14-mcp.md 8.3 e 8.5;
// decisões 120, 122 e 123; RF-MCP-07): as tools do Super, todas somente leitura, com saída em
// colunas e linhas e sem contato.

const SUPER_TOOLS = [
  'compare_spaces',
  'get_online_payments_revenue',
  'get_platform_finance',
  'get_platform_metrics',
  'get_reviews_reports',
  'get_space_details',
  'list_spaces',
  'list_users',
  'search_audit_logs',
];
const [SUL, OESTE, CARD_ONLY] = SPACES as [
  (typeof SPACES)[number],
  (typeof SPACES)[number],
  (typeof SPACES)[number],
];

let h: Harness;
let sup: Client;
const outputs: string[] = [];

/** Chama a tool do Super e guarda tudo o que sai (para a varredura de contato). */
async function call(name: string, args: Record<string, unknown> = {}, client = sup) {
  const result = await callTool(client, name, args);
  outputs.push(result.text, JSON.stringify(result.data));
  return result;
}

beforeAll(async () => {
  h = await startHarness({ admin: {} });
  sup = await h.connect(await h.adminToken({ sub: SUPER_USER }), { url: h.adminResourceUrl });
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.api.reset();
  h.logs.length = 0;
});

const query = (path: RegExp) => h.api.callsTo('GET', path)[0]?.query;

describe('tools/list, prompts e instruções', () => {
  it('as 9 tools do Super, todas só leitura, com saída estruturada e descrição de plataforma', async () => {
    const { tools } = await sup.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(SUPER_TOOLS);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.description, tool.name).toMatch(/Visão de plataforma/);
      expect(tool.description, tool.name).toMatch(/somente leitura/);
      expect(tool.description, tool.name).toMatch(/não invente/);
    }
  });

  it('o único prompt é saude_da_plataforma; as instruções dizem plataforma e só leitura', async () => {
    const { prompts } = await sup.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(['saude_da_plataforma']);
    expect(sup.getInstructions()).toContain('Space Sports · Plataforma');
    expect(sup.getInstructions()).toContain('Somente leitura');
    expect(sup.getInstructions()).not.toContain('create_booking');
  });

  it('o servidor se apresenta como o conector da plataforma', () => {
    expect(sup.getServerVersion()).toMatchObject({
      name: 'space-sports-platform',
      title: 'Space Sports · Plataforma',
    });
  });
});

describe('list_spaces e get_space_details', () => {
  it('list_spaces: tabela de colunas e linhas, filtros repassados, Donos só pelo nome', async () => {
    const { isError, data } = await call('list_spaces', {
      q: 'arena',
      status: 'ACTIVE',
      sports: ['futevolei', 'beach-tennis'],
      page: 1,
      pageSize: 10,
    });
    expect(isError).toBe(false);
    expect(query(/^\/v1\/super\/spaces$/)?.toString()).toBe(
      'q=arena&status=ACTIVE&sports=futevolei%2Cbeach-tennis&page=1&pageSize=10',
    );
    expect(data.columns.map((column: { key: string }) => column.key)).toEqual([
      'slug',
      'status',
      'statusLabel',
      'city',
      'neighborhood',
      'sports',
      'courtsCount',
      'owners',
      'showcaseVisible',
      'onboardingDone',
      'onboardingTotal',
      'createdAt',
    ]);
    expect(data.rows[0]).toEqual({
      key: SUL.id,
      label: 'Arena Sul',
      slug: 'arena-sul',
      status: 'ACTIVE',
      statusLabel: 'ativo',
      city: 'Belo Horizonte/MG',
      neighborhood: 'Buritis',
      sports: 'Beach Tennis',
      courtsCount: 2,
      owners: 'Dona Sul',
      showcaseVisible: true,
      onboardingDone: 4,
      onboardingTotal: 5,
      createdAt: '2026-03-10',
    });
    expect(data).toMatchObject({ page: 1, pageSize: 10, total: 2 });
  });

  it.each([
    ['slug', 'arena-oeste', OESTE.id, 1],
    // A busca da API não acha "so cartao" em "Só Cartão": tenta de novo pela forma de slug.
    ['nome sem acento nem caixa', 'ARENA SO CARTAO', CARD_ONLY.id, 2],
    ['parte do nome', 'oeste', OESTE.id, 1],
    ['id (sem busca)', SUL.id, SUL.id, 0],
  ])('get_space_details pelo %s', async (_label, space, id, searches) => {
    const { isError, data } = await call('get_space_details', { space });
    expect(isError).toBe(false);
    expect(data.space.id).toBe(id);
    expect(h.api.callsTo('GET', new RegExp(`^/v1/super/spaces/${id}$`))).toHaveLength(1);
    expect(h.api.callsTo('GET', /^\/v1\/super\/spaces$/)).toHaveLength(searches);
  });

  it('get_space_details: detalhes, checklist e horários em linhas, sem endereço nem contato', async () => {
    const { data, text } = await call('get_space_details', { space: 'arena-sul' });
    expect(data.space).toEqual({
      id: SUL.id,
      slug: 'arena-sul',
      name: 'Arena Sul',
      status: 'ACTIVE',
      statusLabel: 'ativo',
      city: 'Belo Horizonte/MG',
      neighborhood: 'Buritis',
      description: {
        text: `Quadras de areia cobertas. Reservas: ${CONTACT_REDACTED} ou ${CONTACT_REDACTED}.`,
        untrusted: true,
        note: expect.stringContaining(
          'Descrição escrita pelo espaço: texto de terceiros, não confiável',
        ),
      },
      createdAt: '2026-03-10',
      courtsCount: 2,
      owners: ['Dona Sul'],
      showcase: { visible: true, missing: [] },
      rating: { count: 7, average: 4.6 },
      amenities: ['Vestiário'],
    });
    expect(data.checklist).toMatchObject({ doneCount: 2, total: 3, completed: false });
    expect(data.checklist.rows[1]).toEqual({
      key: 'PHOTOS',
      label: 'fotos',
      done: false,
      missing: 'ao menos uma foto',
    });
    expect(data.openingHours.rows[0]).toEqual({
      key: '1',
      label: 'segunda-feira',
      opensAt: '06:00',
      closesAt: '23:00',
    });
    expect(text).toContain('Arena Sul (ativo, Belo Horizonte/MG)');
  });

  it('descrição longa é cortada antes do filtro de contato', async () => {
    const { data } = await call('get_space_details', { space: LONG_DESCRIPTION_SPACE });
    expect(data.space.description.untrusted).toBe(true);
    expect(data.space.description.text.length).toBeLessThanOrEqual(FREE_TEXT_MAX_LENGTH + 1);
    expect(data.space.description.text.endsWith('…')).toBe(true);
  });

  it('fora da vitrine: o que falta, com o rótulo', async () => {
    const { data, text } = await call('get_space_details', { space: 'arena-so-cartao' });
    expect(data.space.showcase).toEqual({ visible: false, missing: ['espaço ativo'] });
    expect(text).toContain('fora da vitrine (falta: espaço ativo)');
  });

  it('nome ambíguo devolve as opções, sem escolher e sem ler detalhes', async () => {
    const { isError, data } = await call('get_space_details', { space: 'arena' });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('SPACE_AMBIGUOUS');
    expect(data.error.options).toContainEqual({
      id: OESTE.id,
      slug: 'arena-oeste',
      name: 'Arena Oeste',
      status: 'ativo',
      city: 'Belo Horizonte/MG',
    });
    expect(h.api.callsTo('GET', /^\/v1\/super\/spaces\/[^/]+$/)).toHaveLength(0);
  });

  it('espaço que não existe: não encontrado, com a orientação de list_spaces', async () => {
    const { data } = await call('get_space_details', { space: 'arena inexistente' });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(data.error.message).toContain('list_spaces');
    // Tentou o texto e a forma de slug.
    expect(h.api.callsTo('GET', /^\/v1\/super\/spaces$/).map((c) => c.query.get('q'))).toEqual([
      'arena inexistente',
      'arena-inexistente',
    ]);
  });

  it('id que a API não acha: a orientação do Super, não a de jogador', async () => {
    const { data } = await call('get_space_details', {
      space: '5a000000-0000-4000-8000-0000000000ff',
    });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(data.error.message).toContain('list_spaces');
    expect(data.error.message).not.toContain('search_spaces');
  });
});

describe('métricas (camada analytics)', () => {
  it('get_platform_metrics: repassa período e agrupamento; colunas, linhas e totais com BRL', async () => {
    const { isError, data, text } = await call('get_platform_metrics', {
      from: '2026-11-01',
      to: '2026-11-12',
      groupBy: 'week',
    });
    expect(isError).toBe(false);
    expect(query(/^\/v1\/super\/analytics\/platform$/)?.toString()).toBe(
      'from=2026-11-01&to=2026-11-12&groupBy=week',
    );
    expect(data.columns.find((c: { key: string }) => c.key === 'platformRevenueCents')).toEqual({
      key: 'platformRevenueCents',
      label: 'Receita da plataforma',
      unit: 'BRL_CENTS',
      formattedKey: 'platformRevenueFormatted',
    });
    expect(data.rows[0]).toMatchObject({
      key: '2026-11-02',
      label: 'semana de 02/11/2026',
      bookings: 40,
      onlineVolumeCents: 81000,
      onlineVolumeFormatted: formatCents(81000),
    });
    // Campo fora das colunas não passa.
    expect(data.rows[0].ownerEmail).toBeUndefined();
    expect(data.totals).toMatchObject({
      bookings: 65,
      platformRevenueFormatted: formatCents(5400),
    });
    expect(text).toContain('Plataforma, 01/11/2026 a 12/11/2026');
  });

  it('sem período, deixa a API aplicar o padrão (últimos 30 dias)', async () => {
    await call('get_platform_metrics');
    expect(query(/^\/v1\/super\/analytics\/platform$/)?.toString()).toBe('');
  });

  it('compare_spaces: ordem, filtro e limite repassados; período anterior e espaços no filtro', async () => {
    const { data, text } = await call('compare_spaces', {
      from: '2026-10-14',
      to: '2026-11-12',
      status: 'ACTIVE',
      sort: 'bookingsDelta',
      order: 'asc',
      limit: 10,
    });
    expect(query(/^\/v1\/super\/analytics\/spaces$/)?.toString()).toBe(
      'from=2026-10-14&to=2026-11-12&status=ACTIVE&sort=bookingsDelta&order=asc&limit=10',
    );
    expect(data.rows[0]).toMatchObject({
      key: OESTE.id,
      label: 'Arena Oeste',
      bookingsDelta: -7,
      receivedDeltaCents: -30000,
      receivedDeltaFormatted: formatCents(-30000),
    });
    expect(data.previousPeriod).toEqual({ from: '2026-09-14', to: '2026-10-13' });
    expect(data.spacesCount).toBe(3);
    expect(text).toContain('Comparação de 3 espaço(s)');
  });

  it('período longo demais: a orientação da API para dividir', async () => {
    h.api.fail('GET', /analytics\/spaces/, 422, 'ANALYTICS_PERIOD_TOO_LONG', 'Período longo.');
    const { isError, data } = await call('compare_spaces', { from: '2025-01-01' });
    expect(isError).toBe(true);
    expect(data.error.code).toBe('ANALYTICS_PERIOD_TOO_LONG');
    expect(data.error.message).toContain('366 dias');
  });
});

describe('finanças', () => {
  it('get_platform_finance: totais em BRL e cada quebra como tabela; espaço pelo nome', async () => {
    const { data, text } = await call('get_platform_finance', {
      from: '2026-11-01',
      to: '2026-11-12',
      space: 'arena sul',
    });
    expect(query(/^\/v1\/super\/finance\/summary$/)?.toString()).toBe(
      `from=2026-11-01&to=2026-11-12&spaceId=${SUL.id}`,
    );
    expect(data.space).toEqual({ id: SUL.id, slug: 'arena-sul', name: 'Arena Sul' });
    expect(data.totals).toEqual({
      received: { cents: 320000, formatted: formatCents(320000) },
      reversed: { cents: 5000, formatted: formatCents(5000) },
      paymentsCount: 40,
    });
    expect(data.byChannel.rows).toEqual([
      {
        key: 'ON_SITE',
        label: 'No espaço',
        receivedCents: 120000,
        receivedFormatted: formatCents(120000),
        paymentsCount: 15,
      },
      {
        key: 'ONLINE',
        label: 'Online pelo app',
        receivedCents: 200000,
        receivedFormatted: formatCents(200000),
        paymentsCount: 25,
      },
    ]);
    expect(data.byService.rows.map((row: { label: string }) => row.label)).toEqual([
      'aluguel de quadra',
      'aulas',
    ]);
    expect(text).toContain('Recebido em Arena Sul');
  });

  it('espaço do filtro por id: conferido na API (sem busca por nome), com o nome no resumo', async () => {
    const { data, text } = await call('get_platform_finance', { space: OESTE.id });
    expect(h.api.callsTo('GET', /^\/v1\/super\/spaces$/)).toHaveLength(0);
    expect(h.api.callsTo('GET', new RegExp(`^/v1/super/spaces/${OESTE.id}$`))).toHaveLength(1);
    expect(query(/finance\/summary/)?.get('spaceId')).toBe(OESTE.id);
    expect(data.space).toEqual({ id: OESTE.id, slug: 'arena-oeste', name: 'Arena Oeste' });
    expect(text).toContain('Recebido em Arena Oeste');
  });

  it.each([
    ['get_platform_finance', /finance\/summary/],
    ['get_online_payments_revenue', /online-payments\/revenue/],
    ['search_audit_logs', /audit-logs/],
  ])(
    '%s: id de espaço que não existe é "não encontrado", nunca uma consulta com zeros',
    async (tool, path) => {
      const { isError, data } = await call(tool, { space: '5a000000-0000-4000-8000-0000000000ff' });
      expect(isError).toBe(true);
      expect(data.error.code).toBe('SPACE_NOT_FOUND');
      expect(data.error.message).toContain('Espaço não encontrado');
      expect(h.api.callsTo('GET', path)).toHaveLength(0);
    },
  );

  it('get_online_payments_revenue: figuras por espaço, forma e mês, sem o documento', async () => {
    const { data } = await call('get_online_payments_revenue', { method: 'PIX' });
    expect(query(/^\/v1\/super\/online-payments\/revenue$/)?.toString()).toBe('method=PIX');
    expect(data.space).toBeNull();
    expect(data.totals).toMatchObject({
      chargesCount: 25,
      netRevenueCents: 8000,
      netRevenueFormatted: formatCents(8000),
    });
    expect(data.bySpace.rows[0]).not.toHaveProperty('document');
    expect(data.byMonth.rows[0]).toMatchObject({ key: '2026-11', label: '11/2026' });
    expect(data.byMethod.rows.map((row: { label: string }) => row.label)).toEqual([
      'Pix',
      'Cartão',
    ]);
  });
});

describe('get_reviews_reports', () => {
  it('fila em linhas: motivo, situação, avaliação, sem detalhes, motivo de resolução nem contato', async () => {
    const { data, text } = await call('get_reviews_reports', { status: 'OPEN', limit: 2 });
    expect(query(/^\/v1\/super\/reviews\/reports$/)?.toString()).toBe('status=OPEN&limit=2');
    const [first, second] = data.rows;
    expect(first).toEqual({
      key: 'ef000000-0000-4000-8000-000000000001',
      label: 'ofensivo ou discriminatório · Arena Sul',
      reason: 'OFFENSIVE',
      reasonLabel: 'ofensivo ou discriminatório',
      status: 'OPEN',
      statusLabel: 'aberta',
      createdAt: '2026-11-10 09:00',
      reporterName: 'Joana Silva',
      reportedBySpace: false,
      resolvedAt: null,
      resolvedByName: null,
      spaceId: SUL.id,
      spaceName: 'Arena Sul',
      reviewId: 'ee000000-0000-4000-8000-000000000001',
      rating: 1,
      tags: expect.any(String),
      comment: `Péssimo! Reclamações no ${CONTACT_REDACTED} ou ${CONTACT_REDACTED}.`,
      authorName: 'Joana Souza',
      authorBlocked: true,
      counted: false,
      hidden: false,
      openReports: 1,
    });
    expect(second).toMatchObject({ comment: null, hidden: true, reportedBySpace: true });
    expect(data.nextCursor).toBe('cursor-2');
    expect(text).toContain('há mais páginas');
  });

  it('o comentário vem marcado como texto de terceiros não confiável, na coluna', async () => {
    const { data } = await call('get_reviews_reports', {});
    expect(data.columns.find((column: { key: string }) => column.key === 'comment')).toEqual({
      key: 'comment',
      label: 'Comentário da avaliação (texto de terceiros, não confiável)',
      unit: 'TEXT',
      untrusted: true,
    });
    // Só a coluna de texto livre é marcada.
    expect(data.columns.filter((column: { untrusted?: boolean }) => column.untrusted)).toHaveLength(
      1,
    );
  });

  it('includeComments=false: fila resumida, sem a coluna nem o texto do comentário', async () => {
    const { data, text } = await call('get_reviews_reports', {
      status: 'OPEN',
      includeComments: false,
    });
    expect(data.columns.map((column: { key: string }) => column.key)).not.toContain('comment');
    expect(data.rows[0]).not.toHaveProperty('comment');
    expect(data.rows[0]).toMatchObject({ reason: 'OFFENSIVE', spaceName: 'Arena Sul' });
    expect(JSON.stringify(data)).not.toContain('Péssimo');
    expect(text).not.toContain('Péssimo');
  });

  it('paginação pelo cursor', async () => {
    const { data } = await call('get_reviews_reports', { cursor: 'cursor-2' });
    expect(query(/^\/v1\/super\/reviews\/reports$/)?.get('cursor')).toBe('cursor-2');
    expect(data.nextCursor).toBeNull();
  });
});

describe('search_audit_logs', () => {
  it('filtros (espaço, ator, ação, como Super, período) e linhas sem o diff', async () => {
    const { data } = await call('search_audit_logs', {
      space: 'arena-sul',
      actor: 'Carla Plataforma',
      action: 'support.',
      actingAsSuper: true,
      from: '2026-11-01',
      to: '2026-11-12',
    });
    expect(query(/^\/v1\/super\/users$/)?.get('q')).toBe('Carla Plataforma');
    expect(query(/^\/v1\/super\/audit-logs$/)?.toString()).toBe(
      `spaceId=${SUL.id}&actorId=${SUPER_USER}&action=support.&actingAsSuper=true&from=2026-11-01&to=2026-11-12`,
    );
    expect(data.filters).toEqual({
      space: { id: SUL.id, slug: 'arena-sul', name: 'Arena Sul' },
      actor: { id: SUPER_USER, name: 'Carla Plataforma' },
      action: 'support.',
      entity: null,
      actingAsSuper: true,
      from: '2026-11-01',
      to: '2026-11-12',
    });
    expect(data.rows).toEqual([
      {
        key: 'ad000000-0000-4000-8000-000000000003',
        label: 'support.start',
        createdAt: '2026-11-12 15:30',
        action: 'support.start',
        entity: 'support_session',
        entityId: 'be000000-0000-4000-8000-000000000003',
        actorId: SUPER_USER,
        actorName: 'Carla Plataforma',
        actingAsSuper: true,
        spaceId: SUL.id,
        spaceName: 'Arena Sul',
      },
    ]);
  });

  it('paginação: limit e cursor repassados, nextCursor devolvido', async () => {
    const first = await call('search_audit_logs', { limit: 2 });
    expect(first.data.rows).toHaveLength(2);
    expect(first.data.nextCursor).toBe('2');
    const second = await call('search_audit_logs', { limit: 2, cursor: '2' });
    expect(second.data.rows).toHaveLength(1);
    expect(second.data.nextCursor).toBeNull();
    expect(h.api.callsTo('GET', /audit-logs/)[1]?.query.get('cursor')).toBe('2');
  });

  it('ator por id vai direto, sem buscar o nome', async () => {
    await call('search_audit_logs', { actor: USERS[0]?.id });
    expect(h.api.callsTo('GET', /^\/v1\/super\/users$/)).toHaveLength(0);
    expect(query(/audit-logs/)?.get('actorId')).toBe(USERS[0]?.id);
  });

  it('ator ambíguo: as opções (nome, papel, situação; nunca contato), sem ler a auditoria', async () => {
    const { data } = await call('search_audit_logs', { actor: 'joana' });
    expect(data.error.code).toBe('USER_AMBIGUOUS');
    expect(data.error.options).toEqual([
      { id: USERS[0]?.id, name: 'Joana Silva', platformRole: 'usuário', status: 'ativa' },
      { id: USERS[1]?.id, name: 'Joana Souza', platformRole: 'usuário', status: 'bloqueada' },
    ]);
    expect(h.api.callsTo('GET', /audit-logs/)).toHaveLength(0);
  });

  it('ator que não existe: não encontrado', async () => {
    const { data } = await call('search_audit_logs', { actor: 'Fulano de Tal' });
    expect(data.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('list_users', () => {
  it('nome, situação, papel e espaços; sem e-mail nem telefone', async () => {
    const { data } = await call('list_users', { q: 'joana', status: 'BLOCKED' });
    expect(query(/^\/v1\/super\/users$/)?.toString()).toBe('q=joana&status=BLOCKED');
    expect(data.rows).toEqual([
      {
        key: USERS[1]?.id,
        label: 'Joana Souza',
        status: 'BLOCKED',
        statusLabel: 'bloqueada',
        platformRole: 'USER',
        platformRoleLabel: 'usuário',
        spacesCount: 0,
        createdAt: '2026-10-02',
        deletedAt: null,
      },
    ]);
  });

  it.each([
    ['list_users', { q: 'joana.silva@example.com' }],
    ['list_users', { q: '(31) 98888-7777' }],
    ['list_users', { q: 'joana@' }],
    ['list_spaces', { q: 'contato@arenasul.example.com' }],
    ['search_audit_logs', { actor: '+55 31 98888-7777' }],
    ['get_space_details', { space: '31988887777' }],
  ])('%s não busca por contato: recusa sem chamar a API', async (tool, args) => {
    const { isError, data } = await call(tool, args);
    expect(isError).toBe(true);
    expect(data.error.code).toBe('CONTACT_SEARCH_NOT_ALLOWED');
    expect(h.api.calls).toHaveLength(0);
  });
});

describe('período fora de 2000-01-01 a 2100-12-31 (BUG-MCP2-2)', () => {
  it.each([
    ['get_platform_metrics', { from: '1999-12-31', to: '2000-01-05' }],
    ['compare_spaces', { from: '9999-12-25', to: '9999-12-31' }],
    ['get_platform_finance', { from: '0000-01-01', to: '0000-01-05' }],
    ['get_online_payments_revenue', { from: '2100-12-25', to: '2101-01-01' }],
    ['search_audit_logs', { from: '0001-01-01' }],
  ])('%s recusa sem chamar a API', async (tool, period) => {
    const outcome = await call(tool, period).catch((error: unknown) => ({
      isError: true,
      text: String(error),
    }));
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('Use uma data entre 2000-01-01 e 2100-12-31');
    expect(h.api.calls).toHaveLength(0);
  });
});

describe('erros da API em cada tool', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['list_spaces', {}, /^\/v1\/super\/spaces$/],
    ['get_space_details', { space: SUL.id }, /^\/v1\/super\/spaces\//],
    ['get_platform_metrics', {}, /analytics\/platform/],
    ['compare_spaces', {}, /analytics\/spaces/],
    ['get_platform_finance', {}, /finance\/summary/],
    ['get_online_payments_revenue', {}, /online-payments\/revenue/],
    ['get_reviews_reports', {}, /reviews\/reports/],
    ['search_audit_logs', {}, /audit-logs/],
    ['list_users', {}, /^\/v1\/super\/users$/],
  ];

  it('a lista cobre as 9 tools', () => {
    expect(cases.map(([tool]) => tool).sort()).toEqual(SUPER_TOOLS);
  });

  it.each(cases)(
    '%s: 503 MCP_DISABLED vira a orientação do conector Plataforma',
    async (tool, args, path) => {
      h.api.fail('GET', path, 503, 'MCP_DISABLED', 'Desligado.');
      const { isError, data } = await call(tool, args);
      expect(isError).toBe(true);
      expect(data.error.code).toBe('MCP_DISABLED');
      expect(data.error.message).toContain('Space Sports · Plataforma');
      expect(data.error.message).toContain('painel do Super');
    },
  );

  it.each(cases)('%s: 500 vira API_UNAVAILABLE, sem detalhes', async (tool, args, path) => {
    h.api.fail('GET', path, 500, 'INTERNAL_ERROR', 'stack interna');
    const { data, text } = await call(tool, args);
    expect(data.error.code).toBe('API_UNAVAILABLE');
    expect(text).not.toContain('stack interna');
    expect(text).not.toContain('req-interno');
  });

  it.each(cases)(
    '%s: 401 da conexão vencida (24 h) pede para conectar de novo',
    async (tool, args, path) => {
      h.api.fail('GET', path, 401, 'OAUTH_TOKEN_INVALID', 'Token inválido.');
      const { data } = await call(tool, args);
      expect(data.error.code).toBe('OAUTH_TOKEN_INVALID');
      expect(data.error.message).toContain('24 horas');
      expect(data.error.message).toContain('conector Plataforma');
    },
  );

  it('quem deixou de ser Super: 403 SUPER_REQUIRED com a orientação', async () => {
    const exSuper = await h.connect(await h.adminToken({ sub: USERS[0]?.id }), {
      url: h.adminResourceUrl,
    });
    const { data } = await call('get_platform_metrics', {}, exSuper);
    expect(data.error.code).toBe('SUPER_REQUIRED');
    expect(data.error.message).toContain('não é Super');
  });
});

describe('prompt saude_da_plataforma', () => {
  it('padrão: últimos 30 dias, as tools certas na ordem e as regras', async () => {
    const result = await sup.getPrompt({ name: 'saude_da_plataforma', arguments: {} });
    const text = (result.messages[0]?.content as { text: string } | undefined)?.text ?? '';
    expect(text).toContain('últimos 30 dias (14/10/2026 a 12/11/2026)');
    expect(text).toContain(
      'get_platform_metrics com from=2026-10-14, to=2026-11-12 e groupBy=week',
    );
    for (const tool of [
      'compare_spaces',
      'get_platform_finance',
      'get_online_payments_revenue',
      'get_reviews_reports',
      'search_audit_logs',
    ]) {
      expect(text).toContain(tool);
    }
    expect(text.indexOf('get_platform_metrics')).toBeLessThan(text.indexOf('compare_spaces'));
    expect(text).toContain('não invente');
    expect(text).toContain('Somente leitura');
  });

  it('parados numa chamada própria (por reservas, crescente, limite máximo, zero nos dois períodos)', async () => {
    const result = await sup.getPrompt({ name: 'saude_da_plataforma', arguments: {} });
    const text = (result.messages[0]?.content as { text: string } | undefined)?.text ?? '';
    expect(text).toContain('status=ACTIVE, sort=bookings, order=asc e limit=200');
    expect(text).toContain('bookings=0 E previousBookings=0');
    expect(text).toContain('pode estar incompleta');
  });

  it('suporte por support.start e a fila sem comentários, as duas seguindo o nextCursor', async () => {
    const result = await sup.getPrompt({ name: 'saude_da_plataforma', arguments: {} });
    const text = (result.messages[0]?.content as { text: string } | undefined)?.text ?? '';
    expect(text).toContain('search_audit_logs com action="support.start"');
    expect(text).not.toContain('action="support."');
    expect(text).toContain('get_reviews_reports com status=OPEN, includeComments=false');
    expect(text).toContain('Não reproduza comentários');
    expect(text.match(/cursor=nextCursor até nextCursor vir nulo/g)).toHaveLength(2);
  });

  it('dias: 7 agrupa por dia; fora de 7 a 366 é recusado pelo esquema', async () => {
    const week = await sup.getPrompt({ name: 'saude_da_plataforma', arguments: { dias: '7' } });
    expect((week.messages[0]?.content as { text: string } | undefined)?.text).toContain(
      'from=2026-11-06, to=2026-11-12 e groupBy=day',
    );
    await expect(
      sup.getPrompt({ name: 'saude_da_plataforma', arguments: { dias: '3' } }),
    ).rejects.toThrow();
    await expect(
      sup.getPrompt({ name: 'saude_da_plataforma', arguments: { dias: 'muitos' } }),
    ).rejects.toThrow();
  });

  it('o log do prompt leva a superfície e não os argumentos', async () => {
    await sup.getPrompt({ name: 'saude_da_plataforma', arguments: { dias: '90' } });
    const line = h.logs.find((entry) => entry.event === 'prompt_get');
    expect(line).toMatchObject({
      surface: 'admin',
      sub: SUPER_USER,
      prompt: 'saude_da_plataforma',
    });
    // O argumento como valor (o `time` do pino é número e pode ter "90" por acaso).
    expect(JSON.stringify(line)).not.toContain('"90"');
    expect(JSON.stringify(line)).not.toContain('dias');
  });
});

describe('privacidade e logs (decisão 122)', () => {
  it('nenhuma saída do Super tem contato (nem os campos crus que a API simulada manda)', async () => {
    // Garante que todas as tools passaram pela varredura (além das chamadas acima).
    for (const [tool, args] of [
      ['list_spaces', {}],
      ['get_space_details', { space: 'arena-sul' }],
      ['get_platform_metrics', {}],
      ['compare_spaces', {}],
      ['get_platform_finance', {}],
      ['get_online_payments_revenue', {}],
      ['get_reviews_reports', {}],
      ['search_audit_logs', {}],
      ['list_users', {}],
    ] as const) {
      await call(tool, args);
    }
    const all = outputs.join('\n');
    for (const contact of SUPER_CONTACTS) expect(all, contact).not.toContain(contact);
    expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it('cada chamada vira um log com a superfície admin, sem nomes, contatos nem o token', async () => {
    await call('list_users', { q: 'joana' });
    const line = h.logs.find((entry) => entry.event === 'tool_call');
    expect(line).toMatchObject({
      surface: 'admin',
      sub: SUPER_USER,
      clientId: 'cliente-claude',
      tool: 'list_users',
      result: 'ok',
    });
    const logs = JSON.stringify(h.logs);
    expect(logs).not.toContain('joana');
    expect(logs).not.toContain('Joana');
    expect(logs).not.toMatch(/eyJ/);
  });

  it('nenhuma tool do Super grava nada na API e todas mandam o token do Super com X-Client', async () => {
    await call('get_platform_finance', { space: 'arena-oeste' });
    expect(h.api.calls.length).toBeGreaterThan(0);
    for (const recorded of h.api.calls) {
      expect(recorded.method).toBe('GET');
      expect(recorded.path.startsWith('/v1/super/')).toBe(true);
      expect(recorded.xClient).toBe('mcp');
      expect(recorded.authorization).toMatch(/^Bearer /);
    }
  });
});

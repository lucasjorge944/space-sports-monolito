import type { Client } from '@modelcontextprotocol/client';
import {
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from '@space-sports/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_BOOKING,
  CANCELLED_BOOKING,
  CLASS_GROUP,
  DESK_BOOKING,
  MANAGE_CONTACTS,
  MEMBERSHIPS,
  OESTE,
  PIX_BOOKING,
  SUL,
  TEACHER,
} from './support/fake-manage.js';
import { COURT_2, ME, OTHER_USER, SPACES, SPORT } from './support/fixtures.js';
import { callTool, type Harness, startHarness, toolsCall } from './support/harness.js';

// Gestão em leitura (MCP2.3; docs/14-mcp.md 8.1 e 8.5; decisões 120 a 122 e 124; RF-MCP-06 e 08).

const PLAYER = [...MCP_OAUTH_SCOPES, OAUTH_OFFLINE_ACCESS_SCOPE];
const USER_ALL = [...MCP_RESOURCE_SCOPES.USER, OAUTH_OFFLINE_ACCESS_SCOPE];
const MANAGE_READ = [...PLAYER, 'manage:read'];

const MANAGE_READ_TOOLS = [
  'get_booking_metrics',
  'get_class_metrics',
  'get_customer_metrics',
  'get_occupancy',
  'get_reviews_summary',
  'get_space_today',
  'list_class_groups',
  'list_my_managed_spaces',
  'list_space_bookings',
];
const FINANCE_TOOLS = [
  'get_online_payments_summary',
  'get_revenue',
  'get_statement',
  'list_delinquents',
];
const MANAGE_TOOLS = [...MANAGE_READ_TOOLS, ...FINANCE_TOOLS];

let h: Harness;
/** Dona da Arena Sul e Admin da Arena Oeste, com todos os escopos. */
let owner: Client;
/** A mesma pessoa conectada sem `manage:finance:read`. */
let ownerNoFinance: Client;
/** Professor da Arena Sul com um token forjado com `manage:finance:read` (a API recusa valores). */
let teacher: Client;
/** Jogador sem papel em espaço nenhum, com `manage:read` forjado. */
let player: Client;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.connect(await h.token({ scopes: USER_ALL }));
  ownerNoFinance = await h.connect(await h.token({ scopes: MANAGE_READ }));
  teacher = await h.connect(await h.token({ sub: TEACHER, scopes: USER_ALL }));
  player = await h.connect(await h.token({ sub: OTHER_USER, scopes: MANAGE_READ }));
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.api.reset();
  h.logs.length = 0;
});

const names = async (client: Client) =>
  (await client.listTools()).tools.map((tool) => tool.name).sort();
const query = (path: RegExp) => h.api.callsTo('GET', path)[0]?.query;

describe('tools/list e prompts por escopo', () => {
  it('só jogador: as 14 tools da fase 1, nenhuma de gestão e nenhum prompt', async () => {
    const client = await h.connect(await h.token({ scopes: PLAYER }));
    const tools = await names(client);
    expect(tools).toHaveLength(14);
    for (const tool of MANAGE_TOOLS) expect(tools).not.toContain(tool);
    expect((await client.listPrompts()).prompts).toEqual([]);
  });

  it('manage:read: as 9 de leitura (sem as de valores) e a saudação', async () => {
    const client = await h.connect(await h.token({ scopes: ['manage:read'] }));
    expect(await names(client)).toEqual(['get_my_profile', ...MANAGE_READ_TOOLS].sort());
  });

  it('manage:read + manage:finance:read: as 13 de gestão', async () => {
    const client = await h.connect(
      await h.token({ scopes: ['manage:read', 'manage:finance:read'] }),
    );
    expect(await names(client)).toEqual(['get_my_profile', ...MANAGE_TOOLS].sort());
  });

  it('manage:finance:read sem manage:read: as de valores não aparecem (o espaço sai do manage:read)', async () => {
    const client = await h.connect(await h.token({ scopes: ['manage:finance:read'] }));
    expect(await names(client)).toEqual(['get_my_profile']);
  });

  it('todos os escopos do recurso: 14 de jogador + 13 de gestão', async () => {
    expect(await names(owner)).toHaveLength(27);
  });

  it('get_revenue sem manage:finance:read: 403 insufficient_scope com os escopos exigidos, sem chamar a API', async () => {
    const res = await h.post(
      toolsCall('get_revenue', { space: 'arena-sul' }),
      await h.token({ scopes: MANAGE_READ }),
    );
    expect(res.status).toBe(403);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('insufficient_scope');
    expect(challenge).toContain('manage:read manage:finance:read');
    expect(h.api.calls).toHaveLength(0);
  });

  it.each([
    ['get_booking_metrics', { from: '1999-12-31', to: '2000-01-05' }],
    ['get_revenue', { from: '2100-12-25', to: '2101-01-01' }],
    ['get_occupancy', { from: '0000-01-01', to: '0000-01-05' }],
    ['get_class_metrics', { from: '9999-12-25', to: '9999-12-31' }],
  ])(
    '%s com data fora de 2000-01-01 a 2100-12-31: recusa sem chamar a API',
    async (tool, period) => {
      const outcome = await callTool(owner, tool, { space: 'arena-sul', ...period }).catch(
        (error: unknown) => ({ isError: true, text: String(error) }),
      );
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain('Use uma data entre 2000-01-01 e 2100-12-31');
      expect(h.api.calls).toHaveLength(0);
    },
  );

  it('escopo de outro recurso (super:read) não vale nesta superfície: 403', async () => {
    const res = await h.post(
      toolsCall('list_my_managed_spaces'),
      await h.token({ scopes: ['super:read'] }),
    );
    expect(res.status).toBe(403);
    expect(h.api.calls).toHaveLength(0);
  });

  it('as tools de gestão são só leitura, com saída estruturada e descrição para o modelo', async () => {
    const { tools } = await owner.listTools();
    for (const name of MANAGE_TOOLS) {
      const tool = tools.find((item) => item.name === name);
      expect(tool?.annotations, name).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool?.outputSchema?.type, name).toBe('object');
      expect(tool?.description, name).toMatch(/tabela|gráfico|painel/);
    }
    for (const name of [
      'get_booking_metrics',
      'get_occupancy',
      'get_class_metrics',
      'get_customer_metrics',
      'get_revenue',
    ]) {
      const description = tools.find((item) => item.name === name)?.description ?? '';
      expect(description, name).toContain('artifact');
      expect(description, name).toContain('últimos 30 dias');
      expect(description, name).toContain('não invente');
    }
  });

  it('as instruções do servidor falam da gestão só com manage:read', async () => {
    expect(owner.getInstructions()).toContain('list_my_managed_spaces');
    const client = await h.connect(await h.token({ scopes: PLAYER }));
    expect(client.getInstructions()).not.toContain('list_my_managed_spaces');
  });
});

describe('espaço entre os que a pessoa administra', () => {
  it('sem espaço e com mais de um: pede para escolher, com as opções', async () => {
    const { isError, data } = await callTool(owner, 'get_booking_metrics');
    expect(isError).toBe(true);
    expect(data.error.code).toBe('SPACE_REQUIRED');
    expect(data.error.options).toEqual([
      { id: SUL.id, slug: 'arena-sul', name: 'Arena Sul', roles: ['Dono'] },
      { id: OESTE.id, slug: 'arena-oeste', name: 'Arena Oeste', roles: ['Admin'] },
    ]);
  });

  it('nome ambíguo devolve as opções em vez de escolher', async () => {
    const { data } = await callTool(owner, 'get_booking_metrics', { space: 'arena' });
    expect(data.error.code).toBe('SPACE_AMBIGUOUS');
    expect(data.error.options).toHaveLength(2);
    expect(h.api.callsTo('GET', /analytics/)).toHaveLength(0);
  });

  it.each([
    ['parte do nome', 'oeste', OESTE.id],
    ['slug', 'arena-sul', SUL.id],
    ['id', OESTE.id, OESTE.id],
    ['nome sem acento nem caixa', 'ARENA SUL', SUL.id],
  ])('pelo %s', async (_label, space, id) => {
    const { isError, data } = await callTool(owner, 'get_booking_metrics', { space });
    expect(isError).toBe(false);
    expect(data.space.id).toBe(id);
    expect(
      h.api.callsTo('GET', new RegExp(`/v1/manage/spaces/${id}/analytics/bookings$`)),
    ).toHaveLength(1);
  });

  it('espaço que existe mas que a pessoa não administra: não encontrado, sem chamar a métrica', async () => {
    const { data } = await callTool(owner, 'get_booking_metrics', { space: 'arena-so-cartao' });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(data.error.message).toContain('não está entre os espaços que o usuário administra');
    expect(h.api.callsTo('GET', /\/v1\/manage\//)).toHaveLength(0);
  });

  it('com um espaço só, o parâmetro é opcional', async () => {
    const { data } = await callTool(teacher, 'get_class_metrics');
    expect(data.space).toEqual({
      id: SUL.id,
      slug: 'arena-sul',
      name: 'Arena Sul',
      roles: ['Professor'],
    });
  });

  it('quem não é da equipe de nenhum espaço recebe NOT_STAFF', async () => {
    const { data } = await callTool(player, 'get_space_today');
    expect(data.error.code).toBe('NOT_STAFF');
  });
});

describe('cache da lista de espaços (60 s, por usuário e por token)', () => {
  const staffReads = () => h.api.callsTo('GET', /^\/v1\/me\/staff-spaces$/).length;

  it('tools seguidas leem a lista uma vez; list_my_managed_spaces e get_space_today leem sempre', async () => {
    const client = await h.connect(await h.token({ scopes: USER_ALL }));
    await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
    await callTool(client, 'get_revenue', { space: 'arena-sul', groupBy: 'week' });
    await callTool(client, 'list_delinquents', { space: 'arena-sul' });
    expect(staffReads()).toBe(1);
    await callTool(client, 'list_my_managed_spaces');
    expect(staffReads()).toBe(2);
    await callTool(client, 'get_space_today', { space: 'arena-sul' });
    expect(staffReads()).toBe(3);
    await callTool(client, 'get_occupancy', { space: 'arena-sul' });
    expect(staffReads()).toBe(3);
  });

  it('vence em 60 s', async () => {
    const client = await h.connect(await h.token({ scopes: USER_ALL }));
    const start = h.clock.now;
    try {
      await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
      h.clock.now = new Date(start.getTime() + 59_000);
      await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
      expect(staffReads()).toBe(1);
      h.clock.now = new Date(start.getTime() + 61_000);
      await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
      expect(staffReads()).toBe(2);
    } finally {
      h.clock.now = start;
    }
  });

  it('não é compartilhado entre usuários nem entre tokens do mesmo usuário', async () => {
    const ownerClient = await h.connect(await h.token({ scopes: USER_ALL }));
    const teacherClient = await h.connect(await h.token({ sub: TEACHER, scopes: USER_ALL }));
    const otherToken = await h.connect(await h.token({ scopes: USER_ALL }));
    expect(
      (await callTool(ownerClient, 'get_class_metrics', { space: 'arena-sul' })).data.space.roles,
    ).toEqual(['Dono']);
    expect((await callTool(teacherClient, 'get_class_metrics')).data.space.roles).toEqual([
      'Professor',
    ]);
    await callTool(otherToken, 'get_class_metrics', { space: 'arena-sul' });
    expect(staffReads()).toBe(3);
    const authorizations = h.api
      .callsTo('GET', /^\/v1\/me\/staff-spaces$/)
      .map((call) => call.authorization);
    expect(new Set(authorizations).size).toBe(3);
  });
});

describe('recusa a partir do cache: relê a lista uma vez da API', () => {
  const staffReads = () => h.api.callsTo('GET', /^\/v1\/me\/staff-spaces$/).length;
  const CARD_ONLY = SPACES[2] as (typeof SPACES)[number];

  it('espaço que entrou na lista há menos de 60 s: acha na releitura', async () => {
    const client = await h.connect(await h.token({ scopes: USER_ALL }));
    await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
    expect(staffReads()).toBe(1);
    MEMBERSHIPS[ME]?.push({ spaceId: CARD_ONLY.id, roles: ['ADMIN'] });
    try {
      const { isError, data } = await callTool(client, 'get_booking_metrics', {
        space: 'arena-so-cartao',
      });
      expect(isError).toBe(false);
      expect(data.space).toMatchObject({ id: CARD_ONLY.id, roles: ['Admin'] });
      expect(staffReads()).toBe(2);
      // A releitura renovou o cache: a próxima tool não lê de novo.
      await callTool(client, 'get_occupancy', { space: 'arena-so-cartao' });
      expect(staffReads()).toBe(2);
    } finally {
      MEMBERSHIPS[ME]?.pop();
    }
  });

  it.each([
    ['SPACE_NOT_FOUND', { space: 'arena-so-cartao' }],
    ['SPACE_AMBIGUOUS', { space: 'arena' }],
    ['SPACE_REQUIRED', {}],
  ])('%s com a lista do cache: relê uma vez e só então recusa', async (code, args) => {
    const client = await h.connect(await h.token({ scopes: USER_ALL }));
    await callTool(client, 'get_booking_metrics', { space: 'arena-sul' });
    const { data } = await callTool(client, 'get_booking_metrics', args);
    expect(data.error.code).toBe(code);
    expect(staffReads()).toBe(2);
  });

  it('NOT_STAFF com a lista do cache também relê (o papel pode ter acabado de sair)', async () => {
    const client = await h.connect(await h.token({ sub: OTHER_USER, scopes: MANAGE_READ }));
    await callTool(client, 'get_booking_metrics');
    expect(staffReads()).toBe(1);
    const { data } = await callTool(client, 'get_booking_metrics');
    expect(data.error.code).toBe('NOT_STAFF');
    expect(staffReads()).toBe(2);
  });

  it('recusa com a lista recém-lida da API: não relê', async () => {
    const client = await h.connect(await h.token({ scopes: USER_ALL }));
    const { data } = await callTool(client, 'get_booking_metrics', { space: 'arena-so-cartao' });
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(staffReads()).toBe(1);
  });
});

describe('list_my_managed_spaces', () => {
  it('espaços, papéis, se vê valores e o movimento de hoje', async () => {
    const { data, text } = await callTool(owner, 'list_my_managed_spaces');
    expect(data.spaces).toEqual([
      {
        id: SUL.id,
        slug: 'arena-sul',
        name: 'Arena Sul',
        roles: ['Dono'],
        status: 'ACTIVE',
        seesValues: true,
        today: { date: '2026-11-12', bookings: 3, classSessions: 2 },
      },
      {
        id: OESTE.id,
        slug: 'arena-oeste',
        name: 'Arena Oeste',
        roles: ['Admin'],
        status: 'ACTIVE',
        seesValues: true,
        today: { date: '2026-11-12', bookings: 0, classSessions: 0 },
      },
    ]);
    expect(text).toContain('Arena Sul (Dono)');
    expect(JSON.stringify(data)).not.toContain('logo');
  });

  it('o Professor (mesmo com o escopo forjado) e a conexão sem finanças não veem valores', async () => {
    expect((await callTool(teacher, 'list_my_managed_spaces')).data.spaces[0].seesValues).toBe(
      false,
    );
    const { data } = await callTool(ownerNoFinance, 'list_my_managed_spaces');
    expect(data.spaces.map((space: { seesValues: boolean }) => space.seesValues)).toEqual([
      false,
      false,
    ]);
  });

  it('erro da API vira mensagem útil', async () => {
    h.api.fail('GET', /^\/v1\/me\/staff-spaces$/, 401, 'OAUTH_TOKEN_INVALID', 'Token inválido.');
    const { data } = await callTool(owner, 'list_my_managed_spaces');
    expect(data.error.code).toBe('OAUTH_TOKEN_INVALID');
    expect(data.error.message).toContain('reconectar');
  });
});

describe('get_space_today', () => {
  it('Dona: agenda, aulas com a lista, ocupação e os valores do dia', async () => {
    const { isError, data, text } = await callTool(owner, 'get_space_today', {
      space: 'arena sul',
    });
    expect(isError).toBe(false);
    expect(data.date).toBe('2026-11-12');
    expect(data.bookings[0]).toEqual({
      id: DESK_BOOKING,
      startTime: '18:00',
      endTime: '19:00',
      court: 'Quadra 1',
      sport: 'Beach Tennis',
      customerName: 'Cliente do Balcão',
      peopleCount: 4,
      status: 'CONFIRMED',
      statusLabel: 'Confirmada',
      source: 'DESK',
      sourceLabel: 'Balcão',
      paid: false,
      due: { cents: 7_000, formatted: 'R$ 70,00' },
      paymentState: 'OPEN',
      paymentStateLabel: 'em aberto',
    });
    // Quitada (fora do "a receber", confirmada) × aguardando o Pix do app: nenhuma é "indisponível".
    expect(data.bookings[1]).toMatchObject({
      id: APP_BOOKING,
      paid: true,
      due: { cents: 0, formatted: 'R$ 0,00' },
      paymentState: 'SETTLED',
    });
    expect(data.bookings[2]).toMatchObject({
      id: PIX_BOOKING,
      paid: false,
      due: null,
      paymentState: 'AWAITING_ONLINE_PAYMENT',
      paymentStateLabel: 'aguardando o pagamento online',
    });
    expect(data.classSessions).toHaveLength(2);
    expect(data.classSessions[0]).toMatchObject({
      className: 'Beach Iniciante',
      startTime: '20:00',
      teachers: ['Paula Professora'],
      attendees: [
        {
          name: 'Joana Aluna',
          status: 'CONFIRMED',
          statusLabel: 'presença confirmada',
          waitlistPosition: null,
        },
        {
          name: 'Rafa Espera',
          status: 'WAITLIST',
          statusLabel: 'na lista de espera',
          waitlistPosition: 1,
        },
      ],
    });
    expect(data.occupancy.totals.occupancyRate).toBe(0.3448);
    expect(data.values).toEqual({
      received: { cents: 23_000, formatted: 'R$ 230,00' },
      paymentsCount: 2,
      receivable: { cents: 7_000, formatted: 'R$ 70,00' },
    });
    expect(data.valuesNote).toBeNull();
    expect(text).toContain('3 reserva(s), 2 aula(s)');
    expect(text).toContain('R$ 230,00');
    expect(query(/\/analytics\/occupancy$/)?.get('from')).toBe('2026-11-12');
    expect(query(/\/analytics\/revenue$/)?.get('to')).toBe('2026-11-12');
  });

  it('Professor: sem valores e sem nem pedir as rotas de dinheiro (mesmo com o escopo forjado)', async () => {
    const { isError, data, text } = await callTool(teacher, 'get_space_today');
    expect(isError).toBe(false);
    expect(data.values).toBeNull();
    expect(data.valuesNote).toContain('Professor');
    for (const booking of data.bookings) {
      expect(booking).toMatchObject({ paid: null, due: null, paymentState: 'UNAVAILABLE' });
    }
    expect(data.classSessions).toHaveLength(1);
    expect(text).not.toContain('R$');
    expect(h.api.callsTo('GET', /receivables|analytics\/revenue/)).toHaveLength(0);
  });

  it('Dona sem manage:finance:read: sem valores e com o motivo', async () => {
    const { data } = await callTool(ownerNoFinance, 'get_space_today', { space: 'arena-sul' });
    expect(data.values).toBeNull();
    expect(data.valuesNote).toContain('manage:finance:read');
    expect(h.api.callsTo('GET', /receivables|analytics\/revenue/)).toHaveLength(0);
  });

  it('a API recusar os valores (403) não derruba o resumo: segue sem valores', async () => {
    h.api.fail('GET', /\/receivables\/today$/, 403, 'SPACE_FORBIDDEN', 'Sem permissão.');
    const { isError, data } = await callTool(owner, 'get_space_today', { space: 'arena-sul' });
    expect(isError).toBe(false);
    expect(data.values).toBeNull();
    expect(data.bookings[0]).toMatchObject({ paid: null, due: null, paymentState: 'UNAVAILABLE' });
  });
});

describe('list_space_bookings', () => {
  it('padrão: hoje e os próximos 6 dias, em instantes do fuso do espaço; com valores para a Dona', async () => {
    const { data, text } = await callTool(owner, 'list_space_bookings', { space: 'arena-sul' });
    const q = query(/\/v1\/manage\/spaces\/[^/]+\/bookings$/);
    expect(q?.get('from')).toBe('2026-11-12T03:00:00.000Z');
    expect(q?.get('to')).toBe('2026-11-19T03:00:00.000Z');
    expect(data.period).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(data.bookings[0]).toEqual({
      id: DESK_BOOKING,
      date: '2026-11-13',
      startTime: '18:00',
      endTime: '19:00',
      durationMin: 60,
      court: 'Quadra 1',
      sport: 'Beach Tennis',
      customerName: 'Cliente do Balcão',
      peopleCount: 4,
      status: 'CONFIRMED',
      statusLabel: 'Confirmada',
      source: 'DESK',
      sourceLabel: 'Balcão',
      price: { cents: 12_000, formatted: 'R$ 120,00' },
      paid: { cents: 5_000, formatted: 'R$ 50,00' },
      due: { cents: 7_000, formatted: 'R$ 70,00' },
      paymentStatus: 'PARTIALLY_PAID',
      paymentStatusLabel: 'parcialmente pago',
    });
    expect(data.nextCursor).toBe('cursor-2');
    expect(text).toContain('há mais páginas');
  });

  it('em aberto só pela regra do "a receber": quitada, cancelada e aguardando pagamento online vêm nulas', async () => {
    const { data } = await callTool(owner, 'list_space_bookings', { space: 'arena-sul' });
    const byId = new Map(
      data.bookings.map((booking: { id: string }) => [booking.id, booking] as const),
    );
    expect(byId.get(DESK_BOOKING)).toMatchObject({ due: { cents: 7_000, formatted: 'R$ 70,00' } });
    expect(byId.get(APP_BOOKING)).toMatchObject({
      customerName: 'Bruno Jogador',
      paymentStatus: 'PAID',
      due: null,
    });
    expect(byId.get(CANCELLED_BOOKING)).toMatchObject({
      status: 'CANCELLED',
      price: { cents: 12_000, formatted: 'R$ 120,00' },
      paid: { cents: 0, formatted: 'R$ 0,00' },
      due: null,
    });
    expect(byId.get(PIX_BOOKING)).toMatchObject({ status: 'PENDING_PAYMENT', due: null });
    expect(data.valuesNote).toContain('regra do "a receber"');
    expect(data.valuesNote).toContain('PENDING_PAYMENT');
  });

  it('filtros: quadra pelo nome, status, origem, nome do cliente e página', async () => {
    await callTool(owner, 'list_space_bookings', {
      space: 'arena-sul',
      from: '2026-11-01',
      to: '2026-11-30',
      court: 'quadra 2',
      status: ['CANCELLED', 'NO_SHOW'],
      source: ['DESK'],
      customer: 'Bruno',
      limit: 50,
      cursor: 'cursor-2',
    });
    const q = query(/\/v1\/manage\/spaces\/[^/]+\/bookings$/);
    expect(q?.get('courtId')).toBe(COURT_2);
    expect(q?.getAll('status')).toEqual(['CANCELLED', 'NO_SHOW']);
    expect(q?.getAll('source')).toEqual(['DESK']);
    expect(q?.get('q')).toBe('Bruno');
    expect(q?.get('limit')).toBe('50');
    expect(q?.get('cursor')).toBe('cursor-2');
    expect(q?.get('to')).toBe('2026-12-01T03:00:00.000Z');
  });

  it('Professor: os valores vêm nulos (a API não manda) e a saída explica', async () => {
    const { data } = await callTool(teacher, 'list_space_bookings');
    for (const booking of data.bookings) {
      expect(booking).toMatchObject({ price: null, paid: null, due: null, paymentStatus: null });
    }
    expect(data.valuesNote).toContain('Professor');
  });

  it('quadra que não existe no espaço: as opções, sem listar', async () => {
    const { data } = await callTool(owner, 'list_space_bookings', {
      space: 'arena-sul',
      court: 'Quadra 9',
    });
    expect(data.error.code).toBe('COURT_NOT_FOUND');
    expect(data.error.options).toHaveLength(2);
  });
});

describe('métricas (camada analytics)', () => {
  it('get_booking_metrics repassa período, agrupamento e filtros, com colunas e linhas da API', async () => {
    const { data, text } = await callTool(owner, 'get_booking_metrics', {
      space: 'arena-sul',
      from: '2026-10-01',
      to: '2026-10-31',
      groupBy: 'week',
      court: 'Quadra 1',
      sport: 'futevôlei',
    });
    const q = query(/\/analytics\/bookings$/);
    expect(Object.fromEntries(q ?? [])).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      groupBy: 'week',
      courtId: 'c0000000-0000-4000-8000-000000000001',
      sportId: SPORT.futevolei.sportId,
    });
    expect(data.columns[0]).toEqual({ key: 'bookings', label: 'Reservas', unit: 'COUNT' });
    expect(data.rows[0]).toEqual({
      key: '2026-11-11',
      label: '11/11/2026',
      bookings: 3,
      hours: 4.5,
      noShows: 0,
      cancelled: 1,
      cancellationRate: 0.25,
    });
    expect(data.rows[1].cancellationRate).toBeNull();
    expect(data.totals).toMatchObject({ bookings: 3, hours: 4.5 });
    expect(text).toContain('Reservas de Arena Sul, 01/10/2026 a 31/10/2026');
    expect(text).toContain('Horas reservadas: 4,5 h');
    expect(text).toContain('Taxa de cancelamento: 25%');
  });

  it('sem período, deixa a API aplicar o padrão (últimos 30 dias)', async () => {
    await callTool(owner, 'get_booking_metrics', { space: 'arena-sul' });
    expect(Object.fromEntries(query(/\/analytics\/bookings$/) ?? [])).toEqual({});
  });

  it('get_occupancy repassa dias da semana e faixa horária', async () => {
    const { data } = await callTool(owner, 'get_occupancy', {
      space: 'arena-sul',
      groupBy: 'hour',
      weekdays: [2, 4],
      hourFrom: 18,
      hourTo: 23,
    });
    const q = query(/\/analytics\/occupancy$/);
    expect(q?.getAll('weekday')).toEqual(['2', '4']);
    expect(q?.get('hourFrom')).toBe('18');
    expect(q?.get('hourTo')).toBe('23');
    expect(data.groupBy).toBe('hour');
    expect(data.rows.map((row: { label: string }) => row.label)).toEqual(['Quadra 1', 'Quadra 2']);
  });

  it('get_class_metrics: o Professor vê só as turmas dele; turma pelo nome', async () => {
    const { data } = await callTool(teacher, 'get_class_metrics', {
      classGroup: 'beach iniciante',
    });
    expect(query(/\/analytics\/classes$/)?.get('classGroupId')).toBe(CLASS_GROUP);
    expect(data.rows).toHaveLength(1);
    expect(data.totals.attendanceRate).toBe(0.8333);
  });

  it('get_customer_metrics: nomes e contagens para a Dona; o Professor recebe a recusa de papel', async () => {
    const { data } = await callTool(owner, 'get_customer_metrics', {
      space: 'arena-sul',
      limit: 10,
    });
    expect(query(/\/analytics\/customers$/)?.get('limit')).toBe('10');
    expect(data.rows.map((row: { key: string; label: string }) => [row.key, row.label])).toEqual([
      [OTHER_USER, 'Bruno Jogador'],
      ['guest-1', 'Cliente do Balcão'],
    ]);
    const refused = await callTool(teacher, 'get_customer_metrics');
    expect(refused.isError).toBe(true);
    expect(refused.data.error.code).toBe('SPACE_FORBIDDEN');
    expect(refused.data.error.message).toContain('não estime nem invente');
  });

  it('get_revenue: o texto em BRL ao lado dos centavos, nas colunas, linhas e totais', async () => {
    const { data, text } = await callTool(owner, 'get_revenue', {
      space: 'arena-sul',
      groupBy: 'channel',
    });
    expect(data.columns[0]).toEqual({
      key: 'receivedCents',
      label: 'Recebido',
      unit: 'BRL_CENTS',
      formattedKey: 'receivedFormatted',
    });
    expect(data.columns[1]).toEqual({ key: 'paymentsCount', label: 'Pagamentos', unit: 'COUNT' });
    expect(data.rows[1]).toEqual({
      key: 'ONLINE',
      label: 'Online pelo app',
      receivedCents: 18_000,
      receivedFormatted: 'R$ 180,00',
      paymentsCount: 1,
      reversedCents: 0,
      reversedFormatted: 'R$ 0,00',
      receivableCents: null,
      receivableFormatted: null,
    });
    expect(data.totals).toMatchObject({ receivedCents: 23_000, receivedFormatted: 'R$ 230,00' });
    expect(text).toContain('Recebido: R$ 230,00');
  });

  it('período longo demais: a orientação da API para dividir a consulta', async () => {
    h.api.fail('GET', /\/analytics\/bookings$/, 422, 'ANALYTICS_PERIOD_TOO_LONG', 'Período longo.');
    const { data } = await callTool(owner, 'get_booking_metrics', {
      space: 'arena-sul',
      from: '2024-01-01',
      to: '2026-01-01',
    });
    expect(data.error.code).toBe('ANALYTICS_PERIOD_TOO_LONG');
    expect(data.error.message).toContain('366 dias');
  });
});

describe('finanças (só Dono e Admin)', () => {
  it('get_statement: período local em instantes UTC, totais por forma e canal, sem observação', async () => {
    const { data, text } = await callTool(owner, 'get_statement', { space: 'arena-sul' });
    const q = query(/\/statement$/);
    expect(q?.get('from')).toBe('2026-10-14T03:00:00.000Z');
    expect(q?.get('to')).toBe('2026-11-13T03:00:00.000Z');
    expect(data.period).toEqual({ from: '2026-10-14', to: '2026-11-12' });
    expect(data.totals).toEqual({
      received: { cents: 23_000, formatted: 'R$ 230,00' },
      paymentsCount: 2,
      reversed: { cents: 1_500, formatted: 'R$ 15,00' },
    });
    expect(data.byChannel[1]).toEqual({
      received: { cents: 18_000, formatted: 'R$ 180,00' },
      paymentsCount: 1,
      channel: 'ONLINE',
      channelLabel: 'Online pelo app',
    });
    expect(data.payments[0]).toEqual({
      id: 'd1000000-0000-4000-8000-000000000001',
      date: '2026-11-11',
      time: '11:30',
      amount: { cents: 5_000, formatted: 'R$ 50,00' },
      method: 'CASH',
      methodLabel: 'Dinheiro',
      channel: 'ON_SITE',
      channelLabel: 'No espaço',
      service: 'RENTAL',
      serviceLabel: 'Reservas',
      payerName: 'Cliente do Balcão',
      reversed: false,
      bookingDate: '2026-11-13',
      courtName: 'Quadra 1',
      planName: null,
    });
    expect(text).toContain('R$ 230,00 recebidos em 2 pagamento(s), R$ 15,00 estornados');
  });

  it('list_delinquents: aluno pelo nome, valor em atraso e dias', async () => {
    const { data } = await callTool(owner, 'list_delinquents', { space: 'arena-sul' });
    expect(data.totalOverdue).toEqual({ cents: 15_000, formatted: 'R$ 150,00' });
    expect(data.delinquents).toEqual([
      {
        studentName: 'Joana Aluna',
        plan: 'Plano 2x',
        overdueCount: 1,
        overdue: { cents: 15_000, formatted: 'R$ 150,00' },
        oldestDueDate: '2026-10-10',
        daysOverdue: 33,
        subscriptionStatus: 'PAST_DUE',
        subscriptionStatusLabel: 'em atraso',
      },
    ]);
  });

  it('get_online_payments_summary: carteira e o recebido online × no espaço no período', async () => {
    const { data } = await callTool(owner, 'get_online_payments_summary', {
      space: 'arena-sul',
      from: '2026-11-01',
    });
    expect(query(/\/analytics\/revenue$/)?.get('groupBy')).toBe('channel');
    expect(query(/\/analytics\/revenue$/)?.get('from')).toBe('2026-11-01');
    expect(data.account).toEqual({
      status: 'APPROVED',
      statusLabel: 'cadastro aprovado',
      payoutsPaused: false,
    });
    expect(data.wallet.available).toEqual({ cents: 10_000, formatted: 'R$ 100,00' });
    expect(data.wallet.upcoming).toEqual([
      { date: '2026-11-14', amount: { cents: 8_000, formatted: 'R$ 80,00' } },
    ]);
    expect(data.openDisputes).toEqual({ count: 1, nextRespondBy: '2026-11-20 12:00' });
    expect(data.received).toEqual({
      online: { cents: 18_000, formatted: 'R$ 180,00' },
      onSite: { cents: 5_000, formatted: 'R$ 50,00' },
      total: { cents: 23_000, formatted: 'R$ 230,00' },
    });
    expect(JSON.stringify(data)).not.toContain('paymentEnvironment');
  });

  it.each(FINANCE_TOOLS)(
    '%s: o Professor (com o escopo forjado) recebe a recusa da API',
    async (tool) => {
      const { isError, data } = await callTool(teacher, tool);
      expect(isError).toBe(true);
      expect(data.error.code).toBe('SPACE_FORBIDDEN');
    },
  );
});

describe('get_reviews_summary e list_class_groups', () => {
  it('resumo, chips com rótulo, tendência e as recentes sem contato no texto', async () => {
    const { data } = await callTool(owner, 'get_reviews_summary', {
      space: 'arena-sul',
      recent: 3,
    });
    expect(query(/\/reviews$/)?.get('limit')).toBe('3');
    expect(data).toMatchObject({
      count: 12,
      average: 4.4,
      unansweredCount: 3,
      highlights: {
        positive: [{ tag: 'GOOD_COURT', label: 'Quadra boa', count: 6 }],
        negative: [{ tag: 'BAD_SERVICE', label: 'Atendimento ruim', count: 2 }],
      },
    });
    expect(data.recent).toEqual([
      {
        date: '2026-11-10',
        rating: 2,
        tags: ['Atendimento ruim'],
        comment: 'Liguei no [contato removido] e escrevi para [contato removido], ninguém atendeu.',
        authorName: 'Ana S.',
        replied: false,
      },
    ]);
  });

  it('recent: 0 não lista as avaliações', async () => {
    const { data } = await callTool(owner, 'get_reviews_summary', {
      space: 'arena-sul',
      recent: 0,
    });
    expect(data.recent).toEqual([]);
    expect(h.api.callsTo('GET', /\/reviews$/)).toHaveLength(0);
  });

  it('list_class_groups: ativas por padrão; o Professor vê as dele', async () => {
    const { data } = await callTool(owner, 'list_class_groups', { space: 'arena-sul' });
    expect(query(/\/class-groups$/)?.get('active')).toBe('true');
    expect(data.classGroups).toEqual([
      {
        id: CLASS_GROUP,
        name: 'Beach Iniciante',
        sport: 'Beach Tennis',
        level: 'iniciante',
        weekday: 'terça-feira',
        startTime: '19:00',
        durationMin: 60,
        court: 'Quadra 1',
        teachers: ['Paula Professora'],
        capacity: 8,
        enrolledCount: 6,
        availableSpots: 2,
        active: true,
      },
    ]);
    const all = await callTool(owner, 'list_class_groups', {
      space: 'arena-sul',
      includeInactive: true,
    });
    expect(all.data.classGroups).toHaveLength(2);
    const mine = await callTool(teacher, 'list_class_groups', { includeInactive: true });
    expect(mine.data.classGroups.map((group: { name: string }) => group.name)).toEqual([
      'Beach Iniciante',
    ]);
  });
});

/** Cada tool de gestão, com os argumentos e a rota principal (para simular o erro da API). */
const CALLS: [string, Record<string, unknown>, RegExp][] = [
  ['get_space_today', { space: 'arena-sul' }, /\/analytics\/occupancy$/],
  ['list_space_bookings', { space: 'arena-sul' }, /\/spaces\/[^/]+\/bookings$/],
  ['list_class_groups', { space: 'arena-sul' }, /\/class-groups$/],
  ['get_reviews_summary', { space: 'arena-sul' }, /\/reviews\/summary$/],
  ['get_booking_metrics', { space: 'arena-sul' }, /\/analytics\/bookings$/],
  ['get_occupancy', { space: 'arena-sul' }, /\/analytics\/occupancy$/],
  ['get_class_metrics', { space: 'arena-sul' }, /\/analytics\/classes$/],
  ['get_customer_metrics', { space: 'arena-sul' }, /\/analytics\/customers$/],
  ['get_revenue', { space: 'arena-sul' }, /\/analytics\/revenue$/],
  ['get_statement', { space: 'arena-sul' }, /\/statement$/],
  ['list_delinquents', { space: 'arena-sul' }, /\/delinquents$/],
  ['get_online_payments_summary', { space: 'arena-sul' }, /\/online-payments\/wallet$/],
];

describe('erros da API em cada tool', () => {
  it('a lista cobre as 13 tools (list_my_managed_spaces: acima)', () => {
    expect(CALLS.map(([tool]) => tool).sort()).toEqual(
      MANAGE_TOOLS.filter((tool) => tool !== 'list_my_managed_spaces').sort(),
    );
  });

  it.each(CALLS)('%s feliz', async (tool, args) => {
    const { isError, text } = await callTool(owner, tool, args);
    expect(isError, text).toBe(false);
  });

  it.each(CALLS)('%s: 403 de papel (SPACE_FORBIDDEN)', async (tool, args, path) => {
    h.api.fail('GET', path, 403, 'SPACE_FORBIDDEN', 'Sem permissão neste espaço.');
    const { isError, data, text } = await callTool(owner, tool, args);
    expect(isError).toBe(true);
    expect(data.error.code).toBe('SPACE_FORBIDDEN');
    expect(data.error.message).toContain('não estime nem invente');
    expect(text).not.toContain('req-interno');
  });

  it.each(CALLS)('%s: 404 de espaço (SPACE_NOT_FOUND)', async (tool, args, path) => {
    h.api.fail('GET', path, 404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
    const { isError, data } = await callTool(owner, tool, args);
    expect(isError).toBe(true);
    expect(data.error.code).toBe('SPACE_NOT_FOUND');
    expect(data.error.message).toContain('list_my_managed_spaces');
  });

  it.each(CALLS)('%s: 5xx vira API_UNAVAILABLE', async (tool, args, path) => {
    h.api.fail('GET', path, 500, 'INTERNAL_ERROR', 'stack: at X');
    const { data, text } = await callTool(owner, tool, args);
    expect(data.error.code).toBe('API_UNAVAILABLE');
    expect(text).not.toContain('stack');
  });
});

describe('privacidade e logs (decisão 122)', () => {
  it('nenhuma saída de gestão tem telefone ou e-mail (nem os campos crus que a API simulada manda)', async () => {
    const outputs: string[] = [];
    for (const client of [owner, teacher]) {
      for (const tool of MANAGE_TOOLS) {
        const args = client === teacher ? {} : { space: 'arena-sul' };
        const { result, text } = await callTool(client, tool, args);
        outputs.push(text, JSON.stringify(result));
      }
    }
    for (const output of outputs) {
      for (const contact of MANAGE_CONTACTS) expect(output).not.toContain(contact);
      const cleaned = output
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
        .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, '<data>');
      expect(cleaned).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(cleaned).not.toMatch(
        /(?<![\w-])\+?\(?\d{2}\)?\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}(?![\w-])/,
      );
    }
  });

  it('cada chamada vira um log com a superfície e sem nomes, contatos nem o token', async () => {
    await callTool(owner, 'get_space_today', { space: 'arena-sul' });
    await callTool(owner, 'get_statement', { space: 'arena-sul' });
    const calls = h.logs.filter((line) => line.event === 'tool_call');
    expect(calls.map((line) => line.tool)).toEqual(['get_space_today', 'get_statement']);
    for (const line of calls) {
      expect(line).toMatchObject({ surface: 'user', clientId: 'cliente-claude', result: 'ok' });
    }
    const all = JSON.stringify(h.logs);
    for (const secret of [
      ...MANAGE_CONTACTS,
      'Joana',
      'Bruno',
      'Paula',
      'Cliente do Balcão',
      'Arena Sul',
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it('nenhuma tool de gestão grava nada na API', async () => {
    for (const tool of MANAGE_TOOLS) await callTool(owner, tool, { space: 'arena-sul' });
    expect(h.api.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });
});

describe('prompts MCP', () => {
  it('com manage:read: relatorio_mensal_do_espaco e ocupacao_da_semana, com os argumentos', async () => {
    const { prompts } = await owner.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'relatorio_mensal_do_espaco',
      'ocupacao_da_semana',
    ]);
    expect(prompts[0]?.arguments?.map((arg) => arg.name)).toEqual(['espaco', 'mes']);
    expect(prompts[1]?.arguments?.map((arg) => arg.name)).toEqual(['espaco']);
  });

  it('relatório mensal: período do mês, tools certas, comparação e a regra de não inventar', async () => {
    const result = await owner.getPrompt({
      name: 'relatorio_mensal_do_espaco',
      arguments: { espaco: 'Arena Sul', mes: '2026-10' },
    });
    const message = result.messages[0];
    expect(message?.role).toBe('user');
    const text = message?.content.type === 'text' ? message.content.text : '';
    expect(text).toContain('"Arena Sul"');
    expect(text).toContain('outubro de 2026 (01/10/2026 a 31/10/2026)');
    expect(text).toContain('from=2026-10-01 e to=2026-10-31');
    for (const tool of [
      'list_my_managed_spaces',
      'get_booking_metrics',
      'get_occupancy',
      'get_class_metrics',
      'get_customer_metrics',
      'get_revenue',
      'list_delinquents',
      'get_reviews_summary',
    ]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain('from=2026-09-01, to=2026-09-30');
    expect(text).toContain('não invente');
    expect(text).toContain('artifact');
  });

  it('sem manage:finance:read, o relatório avisa que sai sem receita e não pede get_revenue', async () => {
    const result = await ownerNoFinance.getPrompt({
      name: 'relatorio_mensal_do_espaco',
      arguments: {},
    });
    const text = result.messages[0]?.content.type === 'text' ? result.messages[0].content.text : '';
    expect(text).toContain('sem receita');
    expect(text).not.toContain('get_revenue');
    // Sem mês: o mês passado (o "agora" dos testes é 12/11/2026).
    expect(text).toContain('outubro de 2026');
    expect(text).toContain('se eu administrar mais de um, pergunte qual');
  });

  it('ocupação da semana: segunda a domingo da semana atual e a anterior para comparar', async () => {
    const result = await owner.getPrompt({
      name: 'ocupacao_da_semana',
      arguments: { espaco: 'arena-sul' },
    });
    const text = result.messages[0]?.content.type === 'text' ? result.messages[0].content.text : '';
    expect(text).toContain('semana de 09/11/2026 a 15/11/2026');
    expect(text).toContain('from=2026-11-09 e to=2026-11-15');
    expect(text).toContain('from=2026-11-02, to=2026-11-08');
    expect(text).toContain('weekdays');
  });

  it('mês inválido é recusado pelo esquema dos argumentos', async () => {
    await expect(
      owner.getPrompt({ name: 'relatorio_mensal_do_espaco', arguments: { mes: '2026-13' } }),
    ).rejects.toThrow();
  });

  it('o log do prompt não leva os argumentos', async () => {
    await owner.getPrompt({ name: 'ocupacao_da_semana', arguments: { espaco: 'Arena Secreta' } });
    const line = h.logs.find((item) => item.event === 'prompt_get');
    expect(line).toMatchObject({ surface: 'user', prompt: 'ocupacao_da_semana' });
    expect(JSON.stringify(h.logs)).not.toContain('Arena Secreta');
  });
});

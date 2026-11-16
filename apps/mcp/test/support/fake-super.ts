import { PLATFORM_ANALYTICS_COLUMNS, SPACES_ANALYTICS_COLUMNS } from '@space-sports/shared';
import { tokenClaims } from './fake-manage.js';
import { SPACES } from './fixtures.js';

// Plataforma (Super) na API simulada (docs/14-mcp.md 8.3 e 8.4). As respostas vêm "cruas", com
// e-mail, telefone, endereço e textos livres em campos que a visão do MCP na API tiraria (e com
// contato escrito à mão nos textos que ela manda): o teste prova que as tools do apps/mcp só
// repassam os campos que escolhem e filtram os textos livres. Só o Super (`SUPER_USER`) passa.

export const SUPER_USER = '0b8f1c1e-5555-4c7e-9d2a-00000000000a';
export const SUPER_TODAY = '2026-11-12';

export const USERS = [
  {
    id: 'ab000000-0000-4000-8000-000000000001',
    name: 'Joana Silva',
    email: 'joana.silva@example.com',
    phone: '+5531988887777',
    phoneVerified: true,
    status: 'ACTIVE',
    platformRole: 'USER',
    createdAt: '2026-10-01T15:00:00.000Z',
    deletedAt: null,
    spacesCount: 1,
  },
  {
    id: 'ab000000-0000-4000-8000-000000000002',
    name: 'Joana Souza',
    email: 'joana.souza@example.com',
    phone: '+5531977776666',
    phoneVerified: false,
    status: 'BLOCKED',
    platformRole: 'USER',
    createdAt: '2026-10-02T15:00:00.000Z',
    deletedAt: null,
    spacesCount: 0,
  },
  {
    id: SUPER_USER,
    name: 'Carla Plataforma',
    email: 'carla.super@example.com',
    phone: '+5531966665555',
    phoneVerified: true,
    status: 'ACTIVE',
    platformRole: 'SUPER',
    createdAt: '2026-01-02T15:00:00.000Z',
    deletedAt: null,
    spacesCount: 0,
  },
];

/** Contatos que nunca podem sair numa tool do Super (decisão 122: nem para o Super). */
export const SUPER_CONTACTS = [
  ...USERS.flatMap((user) => [user.email, user.phone]),
  'dono.sul@example.com',
  'dono.oeste@example.com',
  '+5531955554444',
  'contato@arenasul.example.com',
  '(31) 3333-2222',
  '31 9 9123-4567',
  'denunciante@example.com',
  '+5531912345678',
  'Rua das Areias',
  '30494-000',
  '123.456.789-09',
];

interface Reply {
  status: number;
  body?: unknown;
}

const apiError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message }, requestId: 'req-interno-789' },
});

const OWNERS: Record<string, { id: string; name: string; email: string }[]> = {
  [SPACES[0]?.id ?? '']: [
    { id: 'ab000000-0000-4000-8000-000000000011', name: 'Dona Sul', email: 'dono.sul@example.com' },
  ],
  [SPACES[1]?.id ?? '']: [
    {
      id: 'ab000000-0000-4000-8000-000000000012',
      name: 'Dono Oeste',
      email: 'dono.oeste@example.com',
    },
  ],
};

const STATUS: Record<string, string> = {
  'arena-sul': 'ACTIVE',
  'arena-oeste': 'ACTIVE',
  'arena-so-cartao': 'SUSPENDED',
};

function spaceListItem(space: (typeof SPACES)[number]) {
  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    status: STATUS[space.slug] ?? 'ACTIVE',
    logoUrl: 'https://cdn.example.com/logo.png',
    city: { id: 'c1000000-0000-4000-8000-000000000001', name: 'Belo Horizonte', state: 'MG' },
    neighborhood: space.address.neighborhood,
    sports: [{ slug: 'beach-tennis', name: 'Beach Tennis' }],
    courtsCount: space.courts.length,
    owners: OWNERS[space.id] ?? [],
    showcaseVisible: space.slug !== 'arena-so-cartao',
    onboarding: { doneCount: 4, total: 5 },
    createdAt: '2026-03-10T13:00:00.000Z',
    // Campo que a visão do MCP não deixa passar.
    phone: '+5531955554444',
  };
}

/** A descrição do espaço, com contato escrito à mão (a API manda: é a descrição pública). */
export const LONG_DESCRIPTION_SPACE = SPACES[1]?.id ?? '';

function spaceDetail(space: (typeof SPACES)[number]) {
  const description =
    space.id === LONG_DESCRIPTION_SPACE
      ? `Arena com ${'quadras de areia e '.repeat(300)}fim.`
      : 'Quadras de areia cobertas. Reservas: contato@arenasul.example.com ou (31) 3333-2222.';
  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    description,
    status: STATUS[space.slug] ?? 'ACTIVE',
    address: {
      street: 'Rua das Areias',
      number: '100',
      neighborhood: space.address.neighborhood,
      postalCode: '30494-000',
      city: { id: 'c1000000-0000-4000-8000-000000000001', name: 'Belo Horizonte', state: 'MG' },
    },
    location: { lat: -19.97, lng: -43.96 },
    phone: '+5531955554444',
    whatsapp: '+5531955554444',
    instagram: '@arenasul',
    logoUrl: 'https://cdn.example.com/logo.png',
    photos: [{ id: 'p1', url: 'https://cdn.example.com/1.png' }],
    amenities: [{ id: 'a1', slug: 'vestiario', name: 'Vestiário' }],
    openingHours: [
      { weekday: 1, opensAt: '06:00', closesAt: '23:00' },
      { weekday: 6, opensAt: '07:00', closesAt: '20:00' },
    ],
    showcase: {
      visible: space.slug !== 'arena-so-cartao',
      missing: space.slug === 'arena-so-cartao' ? ['ACTIVE_STATUS'] : [],
    },
    createdAt: '2026-03-10T13:00:00.000Z',
    courtsCount: space.courts.length,
    owners: OWNERS[space.id] ?? [],
    checklist: {
      items: [
        { key: 'DATA', done: true, missing: [] },
        { key: 'PHOTOS', done: false, missing: ['photos'] },
        { key: 'TEAM', done: true, missing: [] },
      ],
      doneCount: 2,
      total: 3,
      completed: false,
    },
    rating: { count: 7, average: 4.6 },
  };
}

function analyticsBody(
  columns: readonly { key: string; label: string; unit: string }[],
  groupBy: string,
  query: URLSearchParams,
  rows: { key: string; label: string; values: (number | null)[] }[],
  totals: (number | null)[],
) {
  const toValues = (values: (number | null)[]) =>
    Object.fromEntries(columns.map((column, index) => [column.key, values[index] ?? null]));
  return {
    period: { from: query.get('from') ?? '2026-10-14', to: query.get('to') ?? SUPER_TODAY },
    groupBy: query.get('groupBy') ?? groupBy,
    timezone: 'America/Sao_Paulo',
    columns,
    rows: rows.map((row) => ({
      key: row.key,
      label: row.label,
      ...toValues(row.values),
      // Campo que nenhuma coluna declara: não pode sair.
      ownerEmail: 'dono.sul@example.com',
    })),
    totals: toValues(totals),
  };
}

const figures = (count: number, volume: number) => ({
  chargesCount: count,
  volumeCents: volume,
  grossFeeCents: Math.round(volume * 0.05),
  gatewayCostCents: Math.round(volume * 0.01),
  feeRefundedCents: 0,
  feeRechargedCents: 0,
  netRevenueCents: Math.round(volume * 0.04),
});

const AUDIT = Array.from({ length: 3 }, (_, index) => ({
  id: `ad000000-0000-4000-8000-00000000000${index + 1}`,
  actorId: index === 2 ? SUPER_USER : (USERS[0]?.id ?? null),
  actorName: index === 2 ? 'Carla Plataforma' : 'Joana Silva',
  actingAsSuper: index === 2,
  spaceId: SPACES[0]?.id ?? null,
  spaceName: 'Arena Sul',
  action: index === 2 ? 'support.start' : 'booking.cancel',
  entity: index === 2 ? 'support_session' : 'booking',
  entityId: `be000000-0000-4000-8000-00000000000${index + 1}`,
  diff: { email: 'joana.silva@example.com', phone: '+5531988887777' },
  createdAt: `2026-11-1${index}T18:30:00.000Z`,
}));

/** Rotas do Super na API simulada (`null`: não é rota do Super). */
export function superRoute(
  method: string,
  url: URL,
  authorization: string | undefined,
): Reply | null {
  const path = url.pathname;
  if (!path.startsWith('/v1/super/')) return null;
  if (method !== 'GET') {
    return apiError(403, 'OAUTH_ROUTE_NOT_ALLOWED', 'Rota não disponível para o assistente.');
  }
  const { sub } = tokenClaims(authorization);
  if (sub !== SUPER_USER) return apiError(403, 'SUPER_REQUIRED', 'Só para a equipe Super.');
  const q = url.searchParams;

  const spaceMatch = /^\/v1\/super\/spaces\/([^/]+)$/.exec(path);
  if (spaceMatch) {
    const space = SPACES.find((item) => item.id === spaceMatch[1]);
    if (!space) return apiError(404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
    return { status: 200, body: spaceDetail(space) };
  }

  switch (path) {
    case '/v1/super/spaces': {
      const term = q.get('q')?.toLowerCase();
      const items = SPACES.filter(
        (space) =>
          (!term || space.name.toLowerCase().includes(term) || space.slug.includes(term)) &&
          (!q.get('status') || (STATUS[space.slug] ?? 'ACTIVE') === q.get('status')),
      ).map(spaceListItem);
      return {
        status: 200,
        body: {
          items,
          page: Number(q.get('page') ?? 1),
          pageSize: Number(q.get('pageSize') ?? 20),
          total: items.length,
        },
      };
    }
    case '/v1/super/users': {
      // Com o token do MCP, a API procura só no nome (decisão 122).
      const term = q.get('q')?.toLowerCase();
      const items = USERS.filter(
        (user) =>
          (!term || user.name.toLowerCase().includes(term)) &&
          (!q.get('status') || user.status === q.get('status')) &&
          (!q.get('platformRole') || user.platformRole === q.get('platformRole')),
      );
      return {
        status: 200,
        body: {
          items,
          page: Number(q.get('page') ?? 1),
          pageSize: Number(q.get('pageSize') ?? 20),
          total: items.length,
        },
      };
    }
    case '/v1/super/analytics/platform':
      return {
        status: 200,
        body: analyticsBody(
          PLATFORM_ANALYTICS_COLUMNS,
          'week',
          q,
          [
            {
              key: '2026-11-02',
              label: 'semana de 02/11/2026',
              values: [40, 52.5, 12, 1, 2, 9, 81000, 3240],
            },
            {
              key: '2026-11-09',
              label: 'semana de 09/11/2026',
              values: [25, 31, 8, 0, 2, 6, 54000, 2160],
            },
          ],
          [65, 83.5, 20, 1, 3, 15, 135000, 5400],
        ),
      };
    case '/v1/super/analytics/spaces': {
      const body = analyticsBody(
        SPACES_ANALYTICS_COLUMNS,
        'space',
        q,
        [
          {
            key: SPACES[1]?.id ?? '',
            label: 'Arena Oeste',
            values: [5, 12, -7, 0, 3, -3, 20000, 50000, -30000, 1, 0],
          },
          {
            key: SPACES[0]?.id ?? '',
            label: 'Arena Sul',
            values: [60, 40, 20, 10, 8, 2, 300000, 250000, 50000, 4, 12],
          },
        ],
        [65, 52, 13, 10, 11, -1, 320000, 300000, 20000, 5, 12],
      );
      return {
        status: 200,
        body: {
          ...body,
          previousPeriod: { from: '2026-09-14', to: '2026-10-13' },
          spacesCount: 3,
        },
      };
    }
    case '/v1/super/finance/summary': {
      const received = (cents: number, count: number) => ({
        receivedCents: cents,
        paymentsCount: count,
      });
      return {
        status: 200,
        body: {
          period: { from: q.get('from') ?? '2026-11-01', to: q.get('to') ?? SUPER_TODAY },
          totals: { ...received(320000, 40), reversedCents: 5000 },
          bySpace: [
            { ...received(300000, 35), spaceId: SPACES[0]?.id, spaceName: 'Arena Sul' },
            { ...received(20000, 5), spaceId: SPACES[1]?.id, spaceName: 'Arena Oeste' },
          ],
          byService: [
            { ...received(250000, 30), service: 'RENTAL' },
            { ...received(70000, 10), service: 'CLASSES' },
          ],
          byMethod: [
            { ...received(200000, 25), method: 'PIX' },
            { ...received(120000, 15), method: 'CASH' },
          ],
          byChannel: [
            { ...received(120000, 15), channel: 'ON_SITE' },
            { ...received(200000, 25), channel: 'ONLINE', payerEmail: 'joana.silva@example.com' },
          ],
        },
      };
    }
    case '/v1/super/online-payments/revenue':
      return {
        status: 200,
        body: {
          period: { from: q.get('from') ?? '2026-11-01', to: q.get('to') ?? SUPER_TODAY },
          totals: figures(25, 200000),
          bySpace: [
            {
              ...figures(25, 200000),
              spaceId: SPACES[0]?.id,
              spaceName: 'Arena Sul',
              document: '123.456.789-09',
            },
          ],
          byMethod: [
            { ...figures(20, 150000), method: 'PIX' },
            { ...figures(5, 50000), method: 'CARD' },
          ],
          byMonth: [{ ...figures(25, 200000), month: '2026-11' }],
        },
      };
    case '/v1/super/reviews/reports':
      return {
        status: 200,
        body: {
          items: [
            {
              id: 'ef000000-0000-4000-8000-000000000001',
              reviewId: 'ee000000-0000-4000-8000-000000000001',
              reason: 'OFFENSIVE',
              details: 'Me liga no +5531912345678 que eu explico.',
              status: 'OPEN',
              reporter: { userId: USERS[0]?.id, name: 'Joana Silva', spaceId: null },
              createdAt: '2026-11-10T12:00:00.000Z',
              resolvedAt: null,
              resolvedByName: null,
              resolutionReason: 'denunciante@example.com',
              review: {
                id: 'ee000000-0000-4000-8000-000000000001',
                space: { id: SPACES[0]?.id, slug: 'arena-sul', name: 'Arena Sul' },
                author: { userId: USERS[1]?.id, name: 'Joana Souza', blocked: true },
                rating: 1,
                tags: ['GOOD_COURT'],
                comment: 'Péssimo! Reclamações no 31 9 9123-4567 ou denunciante@example.com.',
                authorKind: 'PLAYER',
                counted: false,
                hidden: null,
                reply: { body: 'Ligue (31) 3333-2222', repliedAt: '2026-11-11T12:00:00.000Z' },
                openReports: 1,
                createdAt: '2026-11-09T12:00:00.000Z',
                updatedAt: '2026-11-09T12:00:00.000Z',
              },
            },
            {
              id: 'ef000000-0000-4000-8000-000000000002',
              reviewId: 'ee000000-0000-4000-8000-000000000002',
              reason: 'PERSONAL_DATA',
              details: null,
              status: 'RESOLVED',
              reporter: { userId: null, name: null, spaceId: SPACES[1]?.id },
              createdAt: '2026-11-08T12:00:00.000Z',
              resolvedAt: '2026-11-09T12:00:00.000Z',
              resolvedByName: 'Carla Plataforma',
              resolutionReason: null,
              review: {
                id: 'ee000000-0000-4000-8000-000000000002',
                space: { id: SPACES[1]?.id, slug: 'arena-oeste', name: 'Arena Oeste' },
                author: { userId: USERS[0]?.id, name: 'Joana Silva', blocked: false },
                rating: 4,
                tags: [],
                // Denunciada como dado pessoal: a API manda nulo para o token do MCP.
                comment: null,
                authorKind: 'PLAYER',
                counted: true,
                hidden: { at: '2026-11-09T12:00:00.000Z', byName: 'Carla', reason: 'telefone' },
                reply: null,
                openReports: 0,
                createdAt: '2026-11-07T12:00:00.000Z',
                updatedAt: '2026-11-09T12:00:00.000Z',
              },
            },
          ],
          nextCursor: q.get('cursor') ? null : 'cursor-2',
        },
      };
    case '/v1/super/audit-logs': {
      const limit = Number(q.get('limit') ?? 50);
      const items = AUDIT.filter(
        (entry) =>
          (!q.get('actorId') || entry.actorId === q.get('actorId')) &&
          (!q.get('spaceId') || entry.spaceId === q.get('spaceId')) &&
          (!q.get('action') || entry.action.startsWith(q.get('action') ?? '')) &&
          (!q.get('actingAsSuper') || String(entry.actingAsSuper) === q.get('actingAsSuper')),
      );
      const start = q.get('cursor') ? Number(q.get('cursor')) : 0;
      const page = items.slice(start, start + limit);
      return {
        status: 200,
        body: {
          items: page,
          nextCursor: start + limit < items.length ? String(start + limit) : null,
        },
      };
    }
    default:
      return apiError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }
}

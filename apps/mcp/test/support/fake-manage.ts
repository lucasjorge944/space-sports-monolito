import {
  BOOKING_ANALYTICS_COLUMNS,
  CLASS_ANALYTICS_COLUMNS,
  CUSTOMER_ANALYTICS_COLUMNS,
  OCCUPANCY_ANALYTICS_COLUMNS,
  REVENUE_ANALYTICS_COLUMNS,
} from '@space-sports/shared';
import { COURT_1, COURT_2, ME, OTHER_USER, SPACES, SPORT } from './fixtures.js';

// Gestão na API simulada (docs/14-mcp.md 8.2 e 8.4). As respostas vêm "cruas", com telefone e
// e-mail em campos que a visão do MCP na API tiraria: o teste prova que as tools do apps/mcp só
// repassam os campos que escolhem. Os papéis seguem a matriz do painel (decisão 53).

export const TEACHER = '0b8f1c1e-3333-4c7e-9d2a-000000000003';
export const SUL = SPACES[0] as (typeof SPACES)[number];
export const OESTE = SPACES[1] as (typeof SPACES)[number];
export const CLASS_GROUP = 'f0000000-0000-4000-8000-000000000001';
export const OTHER_CLASS_GROUP = 'f0000000-0000-4000-8000-000000000002';
export const DESK_BOOKING = 'b1000000-0000-4000-8000-000000000001';
export const APP_BOOKING = 'b1000000-0000-4000-8000-000000000002';
export const PIX_BOOKING = 'b1000000-0000-4000-8000-000000000003';
export const CANCELLED_BOOKING = 'b1000000-0000-4000-8000-000000000004';

/** Contatos que nunca podem sair numa tool de gestão (nome sim, contato nunca: decisão 122). */
export const MANAGE_CONTACTS = [
  '+5531955554444',
  '31955554444',
  '+5531944443333',
  'cliente.balcao@example.com',
  'joana.aluna@example.com',
  '+5531933332222',
  'paula.prof@example.com',
  '(31) 98765-4321',
  'vizinho@example.com',
];

type Role = 'OWNER' | 'ADMIN' | 'TEACHER';

/** Papéis de cada usuário em cada espaço. */
export const MEMBERSHIPS: Record<string, { spaceId: string; roles: Role[] }[]> = {
  [ME]: [
    { spaceId: SUL.id, roles: ['OWNER'] },
    { spaceId: OESTE.id, roles: ['ADMIN'] },
  ],
  [TEACHER]: [{ spaceId: SUL.id, roles: ['TEACHER'] }],
  [OTHER_USER]: [],
};

interface Reply {
  status: number;
  body?: unknown;
}

const apiError = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message }, requestId: 'req-interno-456' },
});
const forbidden = () => apiError(403, 'SPACE_FORBIDDEN', 'Sem permissão neste espaço.');

const TODAY = '2026-11-12';
const REVIEW_TAG_POSITIVE = 'GOOD_COURT';
const REVIEW_TAG_NEGATIVE = 'BAD_SERVICE';

/** `sub` e escopos do Bearer (a API simulada não confere a assinatura: o apps/mcp já conferiu). */
export function tokenClaims(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    return {
      sub: String(payload.sub ?? ''),
      scopes: new Set(String(payload.scope ?? '').split(' ')),
    };
  } catch {
    return { sub: '', scopes: new Set<string>() };
  }
}

const spaceRef = (space: typeof SUL) => ({
  id: space.id,
  name: space.name,
  slug: space.slug,
  status: 'ACTIVE',
  timeZone: 'America/Sao_Paulo',
  logoUrl: 'https://cdn.example.com/logo.png',
});

function staffToday(spaceId: string, roles: Role[]) {
  if (spaceId !== SUL.id) return { date: TODAY, bookings: [], classSessions: [] };
  const teacherOnly = roles.every((role) => role === 'TEACHER');
  return {
    date: TODAY,
    bookings: [
      {
        id: DESK_BOOKING,
        court: { id: COURT_1, name: 'Quadra 1' },
        sportName: 'Beach Tennis',
        startsAt: '2026-11-12T21:00:00.000Z',
        endsAt: '2026-11-12T22:00:00.000Z',
        status: 'CONFIRMED',
        source: 'DESK',
        peopleCount: 4,
        customerName: 'Cliente do Balcão',
        // Campo que a visão do MCP na API nunca manda: a tool não pode repassar.
        customerPhone: '+5531955554444',
      },
      {
        id: APP_BOOKING,
        court: { id: COURT_2, name: 'Quadra 2' },
        sportName: 'Beach Tennis',
        startsAt: '2026-11-12T22:00:00.000Z',
        endsAt: '2026-11-12T23:30:00.000Z',
        status: 'CONFIRMED',
        source: 'APP',
        peopleCount: 2,
        customerName: 'Bruno Jogador',
      },
      {
        // Segura o horário até o Pix do app (RN-ONPAY-02): fora do "a receber".
        id: PIX_BOOKING,
        court: { id: COURT_1, name: 'Quadra 1' },
        sportName: 'Beach Tennis',
        startsAt: '2026-11-12T23:30:00.000Z',
        endsAt: '2026-11-13T00:30:00.000Z',
        status: 'PENDING_PAYMENT',
        source: 'APP',
        peopleCount: 2,
        customerName: 'Pedro Pix',
      },
    ],
    classSessions: [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        classGroup: { id: CLASS_GROUP, name: 'Beach Iniciante' },
        sportName: 'Beach Tennis',
        court: { id: COURT_1, name: 'Quadra 1' },
        teachers: [{ name: 'Paula Professora', avatarUrl: 'https://cdn.example.com/p.png' }],
        startsAt: '2026-11-12T23:00:00.000Z',
        endsAt: '2026-11-13T00:00:00.000Z',
        status: 'OPEN',
        capacity: 8,
        confirmedCount: 1,
        waitlistCount: 1,
        attendees: [
          {
            userId: OTHER_USER,
            name: 'Joana Aluna',
            status: 'CONFIRMED',
            waitlistPosition: null,
            email: 'joana.aluna@example.com',
          },
          { userId: ME, name: 'Rafa Espera', status: 'WAITLIST', waitlistPosition: 1 },
        ],
      },
      ...(teacherOnly
        ? []
        : [
            {
              id: 'a1000000-0000-4000-8000-000000000002',
              classGroup: { id: OTHER_CLASS_GROUP, name: 'Futevôlei Avançado' },
              sportName: 'Futevôlei',
              court: { id: COURT_1, name: 'Quadra 1' },
              teachers: [{ name: 'Outro Professor', avatarUrl: null }],
              startsAt: '2026-11-13T00:00:00.000Z',
              endsAt: '2026-11-13T01:00:00.000Z',
              status: 'SCHEDULED',
              capacity: 6,
              confirmedCount: 0,
              waitlistCount: 0,
              attendees: [],
            },
          ]),
    ],
  };
}

/** Linhas e totais das métricas a partir das colunas do contrato (`packages/shared`). */
function analytics(
  columns: readonly { key: string; label: string; unit: string }[],
  groupBy: string,
  query: URLSearchParams,
  rows: { key: string; label: string; values: (number | null)[] }[],
  totals: (number | null)[],
) {
  const toValues = (values: (number | null)[]) =>
    Object.fromEntries(columns.map((column, index) => [column.key, values[index]]));
  return {
    period: { from: query.get('from') ?? '2026-10-14', to: query.get('to') ?? TODAY },
    groupBy: query.get('groupBy') ?? groupBy,
    timezone: 'America/Sao_Paulo',
    columns,
    rows: rows.map((row) => ({ key: row.key, label: row.label, ...toValues(row.values) })),
    totals: toValues(totals),
  };
}

function booking(id: string, values: boolean, overrides: Record<string, unknown> = {}) {
  return {
    id,
    space: { id: SUL.id, name: SUL.name, slug: SUL.slug, timeZone: 'America/Sao_Paulo' },
    court: { id: COURT_1, name: 'Quadra 1' },
    sport: { id: SPORT.beach.sportId, name: SPORT.beach.name, slug: SPORT.beach.slug },
    organizer: { userId: null, name: 'Cliente do Balcão', phone: '+5531955554444' },
    startsAt: '2026-11-13T21:00:00.000Z',
    endsAt: '2026-11-13T22:00:00.000Z',
    durationMin: 60,
    peopleCount: 4,
    status: 'CONFIRMED',
    source: 'DESK',
    cancellableUntil: '2026-11-13T19:00:00.000Z',
    cancelledAt: null,
    createdAt: '2026-11-10T12:00:00.000Z',
    pricePerHourCents: values ? 12_000 : null,
    priceCents: values ? 12_000 : null,
    paidCents: values ? 5_000 : null,
    discountCents: values ? 0 : null,
    paymentStatus: values ? 'PARTIALLY_PAID' : null,
    intendedPaymentMethod: null,
    paymentDueAt: null,
    ...overrides,
  };
}

/**
 * Rotas de gestão simuladas. `null` quando a rota não é de gestão (a `FakeApi` segue com as
 * dela).
 */
export function manageRoute(
  method: string,
  url: URL,
  authorization: string | undefined,
): Reply | null {
  const path = url.pathname;
  if (method !== 'GET') return null;
  const { sub, scopes } = tokenClaims(authorization);
  const memberships = MEMBERSHIPS[sub] ?? [];
  const finance = scopes.has('manage:finance:read');

  if (path === '/v1/me/staff-spaces') {
    const items = memberships.map(({ spaceId, roles }) => {
      const space = SPACES.find((item) => item.id === spaceId) ?? SUL;
      return { space: spaceRef(space), roles, today: staffToday(spaceId, roles) };
    });
    return { status: 200, body: { items } };
  }

  const match = /^\/v1\/manage\/spaces\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return null;
  const [, spaceId, rest = ''] = match;
  if (!SPACES.some((space) => space.id === spaceId)) {
    return apiError(404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
  }
  const roles = memberships.find((item) => item.spaceId === spaceId)?.roles ?? [];
  if (roles.length === 0) return forbidden();
  const ownerOrAdmin = roles.some((role) => role === 'OWNER' || role === 'ADMIN');
  const teacherOnly = !ownerOrAdmin;
  const values = finance && ownerOrAdmin;
  /** Rota de valores: o escopo e o papel (o Professor nunca, decisão 53). */
  const financeRoute = (): Reply | null => {
    if (!finance) {
      return apiError(403, 'OAUTH_INSUFFICIENT_SCOPE', 'Escopo insuficiente.');
    }
    return ownerOrAdmin ? null : forbidden();
  };
  const q = url.searchParams;

  switch (rest) {
    case '/courts':
      return {
        status: 200,
        body: {
          items: [
            {
              id: COURT_1,
              name: 'Quadra 1',
              covered: false,
              status: 'ACTIVE',
              sports: [
                { ...SPORT.beach, maxPlayers: 4 },
                { ...SPORT.futevolei, maxPlayers: 4 },
              ],
            },
            {
              id: COURT_2,
              name: 'Quadra 2',
              covered: true,
              status: 'ACTIVE',
              sports: [{ ...SPORT.beach, maxPlayers: 4 }],
            },
          ],
        },
      };
    case '/bookings':
      return {
        status: 200,
        body: {
          items: [
            booking(DESK_BOOKING, values),
            booking(APP_BOOKING, values, {
              organizer: { userId: OTHER_USER, name: 'Bruno Jogador', phone: '+5531944443333' },
              source: 'APP',
              startsAt: '2026-11-14T12:00:00.000Z',
              endsAt: '2026-11-14T13:30:00.000Z',
              durationMin: 90,
              ...(values ? { priceCents: 18_000, paidCents: 18_000, paymentStatus: 'PAID' } : {}),
            }),
            booking(CANCELLED_BOOKING, values, {
              status: 'CANCELLED',
              cancelledAt: '2026-11-11T12:00:00.000Z',
              ...(values ? { paidCents: 0, paymentStatus: 'PENDING' } : {}),
            }),
            booking(PIX_BOOKING, values, {
              status: 'PENDING_PAYMENT',
              source: 'APP',
              ...(values ? { paidCents: 0, paymentStatus: 'PENDING' } : {}),
            }),
          ],
          nextCursor: 'cursor-2',
        },
      };
    case '/class-groups': {
      const groups = [
        {
          id: CLASS_GROUP,
          name: 'Beach Iniciante',
          sport: { id: SPORT.beach.sportId, name: SPORT.beach.name, slug: SPORT.beach.slug },
          level: 'BEGINNER',
          teachers: [
            {
              memberId: 'e0000000-0000-4000-8000-000000000001',
              userId: TEACHER,
              name: 'Paula Professora',
              email: 'paula.prof@example.com',
              avatarUrl: 'https://cdn.example.com/p.png',
            },
          ],
          court: { id: COURT_1, name: 'Quadra 1' },
          weekday: 2,
          startTime: '19:00',
          durationMin: 60,
          capacity: 8,
          active: true,
          enrolledCount: 6,
          availableSpots: 2,
          createdAt: '2026-01-10T12:00:00.000Z',
        },
        {
          id: OTHER_CLASS_GROUP,
          name: 'Futevôlei Avançado',
          sport: {
            id: SPORT.futevolei.sportId,
            name: SPORT.futevolei.name,
            slug: SPORT.futevolei.slug,
          },
          level: 'ADVANCED',
          teachers: [
            {
              memberId: 'e0000000-0000-4000-8000-000000000002',
              userId: ME,
              name: 'Outro Professor',
              avatarUrl: null,
            },
          ],
          court: { id: COURT_1, name: 'Quadra 1' },
          weekday: 4,
          startTime: '20:00',
          durationMin: 60,
          capacity: 6,
          active: false,
          enrolledCount: 3,
          availableSpots: 3,
          createdAt: '2026-01-10T12:00:00.000Z',
        },
      ];
      const visible = teacherOnly
        ? groups.filter((group) => group.teachers.some((teacher) => teacher.userId === sub))
        : groups;
      const active = q.get('active') === 'true';
      return {
        status: 200,
        body: { items: active ? visible.filter((group) => group.active) : visible },
      };
    }
    case '/reviews/summary':
      return {
        status: 200,
        body: {
          count: 12,
          average: 4.4,
          publicSummaryVisible: true,
          unansweredCount: 3,
          distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: rating === 5 ? 8 : 1 })),
          highlights: {
            positive: [{ tag: REVIEW_TAG_POSITIVE, count: 6 }],
            negative: [{ tag: REVIEW_TAG_NEGATIVE, count: 2 }],
          },
          trend: {
            granularity: q.get('trend') ?? 'WEEK',
            count: 4,
            average: 4.5,
            points: [{ date: '2026-11-08', count: 2, average: 4.5, cumulativeAverage: 4.4 }],
          },
        },
      };
    case '/reviews':
      return {
        status: 200,
        body: {
          items: [
            {
              id: 'r0000000-0000-4000-8000-000000000001',
              author: {
                name: 'Ana S.',
                avatarUrl: 'https://cdn.example.com/a.png',
                kind: 'PLAYER',
              },
              rating: 2,
              tags: [REVIEW_TAG_NEGATIVE],
              // Texto sem denúncia com contato: o apps/mcp tira o contato mesmo assim.
              comment:
                'Liguei no (31) 98765-4321 e escrevi para vizinho@example.com, ninguém atendeu.',
              commentHidden: false,
              reply: null,
              createdAt: '2026-11-10T15:00:00.000Z',
              updatedAt: '2026-11-10T15:00:00.000Z',
              reportedBySpace: false,
            },
          ].slice(0, Number(q.get('limit') ?? 20)),
          nextCursor: null,
        },
      };
    case '/analytics/bookings':
      return {
        status: 200,
        body: analytics(
          BOOKING_ANALYTICS_COLUMNS,
          'day',
          q,
          [
            { key: '2026-11-11', label: '11/11/2026', values: [3, 4.5, 0, 1, 0.25] },
            { key: '2026-11-12', label: '12/11/2026', values: [0, 0, 0, 0, null] },
          ],
          [3, 4.5, 0, 1, 0.25],
        ),
      };
    case '/analytics/occupancy':
      return {
        status: 200,
        body: analytics(
          OCCUPANCY_ANALYTICS_COLUMNS,
          'court',
          q,
          [
            { key: COURT_1, label: 'Quadra 1', values: [15, 1, 14, 7, 2, 0.5, 0.6429] },
            { key: COURT_2, label: 'Quadra 2', values: [15, 0, 15, 3, 0, 0.2, 0.2] },
          ],
          [30, 1, 29, 10, 2, 0.3448, 0.4138],
        ),
      };
    case '/analytics/classes':
      return {
        status: 200,
        body: analytics(
          CLASS_ANALYTICS_COLUMNS,
          'classGroup',
          q,
          teacherOnly
            ? [{ key: CLASS_GROUP, label: 'Beach Iniciante', values: [4, 0, 20, 4, 1, 0.8333, 6] }]
            : [
                { key: CLASS_GROUP, label: 'Beach Iniciante', values: [4, 0, 20, 4, 1, 0.8333, 6] },
                {
                  key: OTHER_CLASS_GROUP,
                  label: 'Futevôlei Avançado',
                  values: [4, 1, 8, 4, 0, 0.6667, 3],
                },
              ],
          teacherOnly ? [4, 0, 20, 4, 1, 0.8333, 6] : [8, 1, 28, 8, 1, 0.7778, 9],
        ),
      };
    case '/analytics/customers':
      if (teacherOnly) return forbidden();
      return {
        status: 200,
        body: analytics(
          CUSTOMER_ANALYTICS_COLUMNS,
          'customer',
          q,
          [
            { key: OTHER_USER, label: 'Bruno Jogador', values: [1, 0, 1, 0, 5, 7.5] },
            { key: 'guest-1', label: 'Cliente do Balcão', values: [1, 1, 0, 0, 2, 2] },
          ],
          [2, 1, 1, 0, 7, 9.5],
        ),
      };
    case '/analytics/revenue': {
      const refused = financeRoute();
      if (refused) return refused;
      const byChannel = q.get('groupBy') === 'channel';
      return {
        status: 200,
        body: analytics(
          REVENUE_ANALYTICS_COLUMNS,
          'day',
          q,
          byChannel
            ? [
                { key: 'ON_SITE', label: 'No espaço', values: [5_000, 1, 0, null] },
                { key: 'ONLINE', label: 'Online pelo app', values: [18_000, 1, 0, null] },
              ]
            : [
                { key: '2026-11-11', label: '11/11/2026', values: [23_000, 2, 1_500, 7_000] },
                { key: '2026-11-12', label: '12/11/2026', values: [0, 0, 0, 0] },
              ],
          [23_000, 2, 1_500, 7_000],
        ),
      };
    }
    case '/receivables/today': {
      const refused = financeRoute();
      if (refused) return refused;
      return {
        status: 200,
        body: {
          date: TODAY,
          timeZone: 'America/Sao_Paulo',
          totalDueCents: 7_000,
          items: [{ booking: booking(DESK_BOOKING, true), dueCents: 7_000 }],
        },
      };
    }
    case '/statement': {
      const refused = financeRoute();
      if (refused) return refused;
      if (!q.get('from') || !q.get('to')) {
        return apiError(400, 'VALIDATION_ERROR', 'from e to são obrigatórios.');
      }
      const figure = { receivedCents: 23_000, paymentsCount: 2 };
      return {
        status: 200,
        body: {
          period: { from: q.get('from'), to: q.get('to') },
          timeZone: 'America/Sao_Paulo',
          totals: { ...figure, reversedCents: 1_500 },
          byMethod: [
            { receivedCents: 5_000, paymentsCount: 1, method: 'CASH' },
            { receivedCents: 18_000, paymentsCount: 1, method: 'PIX' },
          ],
          byChannel: [
            { receivedCents: 5_000, paymentsCount: 1, channel: 'ON_SITE' },
            { receivedCents: 18_000, paymentsCount: 1, channel: 'ONLINE' },
          ],
          items: [
            {
              id: 'd1000000-0000-4000-8000-000000000001',
              payableType: 'BOOKING',
              amountCents: 5_000,
              method: 'CASH',
              channel: 'ON_SITE',
              paidAt: '2026-11-11T14:30:00.000Z',
              reversedAt: null,
              note: 'recibo para cliente.balcao@example.com',
              service: 'RENTAL',
              payerName: 'Cliente do Balcão',
              recordedByName: 'Dona Gestão',
              bookingId: DESK_BOOKING,
              bookingStartsAt: '2026-11-13T21:00:00.000Z',
              subscriptionId: null,
              planName: null,
              chargePeriodStart: null,
              courtName: 'Quadra 1',
            },
          ],
          nextCursor: null,
        },
      };
    }
    case '/subscription-charges/delinquents': {
      const refused = financeRoute();
      if (refused) return refused;
      return {
        status: 200,
        body: {
          date: TODAY,
          totalOverdueCents: 15_000,
          items: [
            {
              subscriptionId: 'f1000000-0000-4000-8000-000000000001',
              subscriptionStatus: 'PAST_DUE',
              student: { userId: OTHER_USER, name: 'Joana Aluna', phone: '+5531933332222' },
              plan: { id: 'd0000000-0000-4000-8000-000000000001', name: 'Plano 2x' },
              overdueCount: 1,
              overdueCents: 15_000,
              oldestDueDate: '2026-10-10',
              daysOverdue: 33,
            },
          ],
        },
      };
    }
    case '/online-payments/wallet': {
      const refused = financeRoute();
      if (refused) return refused;
      return {
        status: 200,
        body: {
          merchantAccountStatus: 'APPROVED',
          payoutsPaused: false,
          paymentEnvironment: { provider: 'fake', enabled: true, sandbox: null },
          openDisputes: { count: 1, nextRespondBy: '2026-11-20T15:00:00.000Z' },
          failedPayouts: { count: 0, lastAmountCents: null, lastAt: null },
          timeZone: 'America/Sao_Paulo',
          availableCents: 10_000,
          pendingCents: 8_000,
          balanceCents: 18_000,
          paidOutCents: 50_000,
          upcoming: [{ date: '2026-11-14', amountCents: 8_000 }],
        },
      };
    }
    default:
      return apiError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }
}

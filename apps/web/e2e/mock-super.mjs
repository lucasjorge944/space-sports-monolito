// Rotas `/v1/super/*` da API simulada (contrato do painel Super). Estado e log de chamadas próprios
// (`/__super-reset`, `/__super-calls`), para não interferir no `/__calls` dos testes de login que
// rodam em paralelo.
import { handleAds, resetAds } from './mock-ads.mjs';
import { REVIEW_SPACES, spaceRating } from './mock-reviews.mjs';

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-20T15:00:00.000Z';

const city = { id: ID(901), name: 'Belo Horizonte', state: 'MG' };

let state;
const superCalls = [];
export function resetSuper() {
  superCalls.length = 0;
  resetAds();
  state = {
    spaces: [
      {
        id: ID(101),
        name: 'Espaço Exemplo A',
        slug: 'espaco-a',
        status: 'ACTIVE',
        city,
        description: 'Quadras de areia.',
        address: {
          street: 'Rua A',
          number: '10',
          neighborhood: 'Centro',
          postalCode: '30130010',
          city,
        },
        phone: '+5531999998888',
        whatsapp: null,
        instagram: 'espacoa',
        owners: [{ id: ID(7), name: 'Gestora Ana', email: 'gestora@exemplo.com' }],
        courtsCount: 2,
        checklistDone: 4,
        // Só no Super: fora da vitrine (a quadra está inativa), para o aviso do editor de anúncios.
        showcaseMissing: ['ACTIVE_COURT'],
      },
      {
        id: ID(102),
        name: 'Espaço Exemplo B',
        slug: 'espaco-b',
        status: 'SUSPENDED',
        city,
        description: null,
        address: { street: null, number: null, neighborhood: null, postalCode: null, city },
        phone: null,
        whatsapp: null,
        instagram: null,
        owners: [],
        courtsCount: 0,
        checklistDone: 1,
        showcaseMissing: ['ACTIVE_COURT', 'PRICE_PER_HOUR'],
      },
      {
        // Ativo, mas fora da vitrine (sem preço/hora), com 2 avaliações (e2e/mock-reviews.mjs).
        id: REVIEW_SPACES.fora.id,
        name: REVIEW_SPACES.fora.name,
        slug: REVIEW_SPACES.fora.slug,
        status: 'ACTIVE',
        city,
        description: null,
        address: { street: null, number: null, neighborhood: 'Savassi', postalCode: null, city },
        phone: null,
        whatsapp: null,
        instagram: null,
        owners: [],
        courtsCount: 1,
        checklistDone: 3,
        showcaseMissing: REVIEW_SPACES.fora.showcaseMissing,
      },
      {
        // Na vitrine, com 5 avaliações (e2e/mock-reviews.mjs).
        id: REVIEW_SPACES.vitrine.id,
        name: REVIEW_SPACES.vitrine.name,
        slug: REVIEW_SPACES.vitrine.slug,
        status: 'ACTIVE',
        city,
        description: null,
        address: {
          street: null,
          number: null,
          neighborhood: 'Funcionários',
          postalCode: null,
          city,
        },
        phone: null,
        whatsapp: null,
        instagram: null,
        owners: [{ id: ID(11), name: 'Dono Davi', email: 'davi@exemplo.com' }],
        courtsCount: 2,
        checklistDone: 5,
      },
    ],
    users: [
      {
        id: ID(8),
        name: 'Jogador Caio',
        email: 'jogador@exemplo.com',
        status: 'ACTIVE',
        // Decisão 64: telefone do cadastro, sem verificação.
        phone: '+5531977776666',
        phoneVerified: false,
      },
      { id: ID(9), name: 'Jogadora Dani', email: 'inativa@exemplo.com', status: 'INACTIVE' },
    ],
    deletions: [
      {
        id: ID(601),
        userId: ID(8),
        userName: 'Jogador Caio',
        status: 'PENDING',
        source: 'USER',
        reason: 'Não uso mais',
        requestedAt: '2026-10-05T15:00:00.000Z',
        // Prazo de 15 dias já vencido.
        dueAt: '2026-10-20T15:00:00.000Z',
        overdue: true,
        resolvedAt: null,
        resolvedBy: null,
        note: null,
        pending: [
          {
            spaceId: ID(101),
            spaceName: 'Espaço Exemplo A',
            upcomingBookings: 2,
            upcomingRecurringOccurrences: 0,
            openRecurringBookings: 1,
            openSubscriptions: 1,
            upcomingClassAttendances: 3,
            openCharges: 1,
            openChargesCents: 18000,
            bookingsDueCents: 0,
          },
        ],
      },
      {
        id: ID(602),
        userId: ID(9),
        userName: 'Jogadora Dani',
        status: 'PENDING',
        source: 'SUPER',
        reason: null,
        requestedAt: '2026-10-19T15:00:00.000Z',
        dueAt: '2026-11-03T15:00:00.000Z',
        overdue: false,
        resolvedAt: null,
        resolvedBy: null,
        note: null,
        pending: [],
      },
      {
        id: ID(603),
        userId: ID(10),
        userName: 'Ex-usuária Eva',
        status: 'CANCELLED',
        source: 'USER',
        reason: null,
        requestedAt: '2026-09-01T15:00:00.000Z',
        dueAt: '2026-09-16T15:00:00.000Z',
        overdue: false,
        resolvedAt: '2026-09-03T15:00:00.000Z',
        resolvedBy: 'Super Admin',
        note: 'Desistiu pelo atendimento',
        pending: null,
      },
    ],
    session: null,
  };
}
resetSuper();

const CHECK_KEYS = ['DATA', 'PHOTOS', 'COURTS', 'PRICE', 'TEAM'];
/** O que a API devolve em `missing` para cada etapa pendente (códigos, não texto de tela). */
const CHECK_MISSING = {
  DATA: ['address', 'contact'],
  PHOTOS: ['photos'],
  COURTS: ['activeCourtWithSport'],
  PRICE: ['pricePerHour'],
  TEAM: ['activeOwner'],
};
const checklistOf = (space) => ({
  items: CHECK_KEYS.map((key, index) => ({
    key,
    done: index < space.checklistDone,
    missing: index < space.checklistDone ? [] : CHECK_MISSING[key],
  })),
  doneCount: space.checklistDone,
  total: CHECK_KEYS.length,
  completed: space.checklistDone === CHECK_KEYS.length,
});
/** Como a API (manage-spaces.service.ts): na vitrine quando não falta nada. */
const showcaseOf = (space) => {
  const missing = [
    ...(space.status === 'ACTIVE' ? [] : ['ACTIVE_STATUS']),
    ...(space.showcaseMissing ?? []),
  ];
  return { visible: missing.length === 0, missing };
};

/** Se o espaço está na vitrine no estado atual do Super (o resumo de avaliações do Super usa). */
export function superShowcaseVisible(spaceId) {
  const space = state.spaces.find((s) => s.id === spaceId);
  return space ? showcaseOf(space).visible : false;
}

const listItem = (s) => ({
  id: s.id,
  name: s.name,
  slug: s.slug,
  status: s.status,
  city: s.city,
  neighborhood: s.address.neighborhood,
  sports: [{ slug: 'beach-tennis', name: 'Beach tennis' }],
  courtsCount: s.courtsCount,
  owners: s.owners,
  showcaseVisible: showcaseOf(s).visible,
  onboarding: { doneCount: s.checklistDone, total: CHECK_KEYS.length },
  createdAt: NOW,
});
const detail = (s) => ({
  id: s.id,
  name: s.name,
  slug: s.slug,
  description: s.description,
  status: s.status,
  address: s.address,
  location: null,
  phone: s.phone,
  whatsapp: s.whatsapp,
  instagram: s.instagram,
  photos: [],
  amenities: [],
  openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '22:00' }],
  showcase: showcaseOf(s),
  createdAt: NOW,
  courtsCount: s.courtsCount,
  owners: s.owners,
  checklist: checklistOf(s),
  rating: spaceRating(s.id),
});
const page = (items, extra = {}) => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...extra,
});

const STATUS_BY_ACTION = { suspend: 'SUSPENDED', reactivate: 'ACTIVE', close: 'CLOSED' };

/** Devolve `true` se tratou a requisição. */
export async function handleSuper({ req, res, path, url, send, fail, readJson }) {
  const method = req.method ?? 'GET';
  if (path === '/__super-calls') {
    send(res, 200, superCalls);
    return true;
  }
  if (path === '/__super-reset') {
    resetSuper();
    send(res, 200, {});
    return true;
  }
  const q = url.searchParams;
  const body = method === 'GET' ? {} : await readJson(req);
  if (method !== 'GET') superCalls.push({ path, body });
  if (path.startsWith('/v1/super/ads/') || path === '/__super-ads-fail') {
    return handleAds({ req, res, path, url, send, body });
  }

  if (path === '/v1/super/spaces' && method === 'GET') {
    let items = state.spaces;
    if (q.get('q'))
      items = items.filter((s) => s.name.toLowerCase().includes(q.get('q').toLowerCase()));
    if (q.get('status')) items = items.filter((s) => s.status === q.get('status'));
    send(res, 200, page(items.map(listItem)));
    return true;
  }
  if (path === '/v1/super/spaces' && method === 'POST') {
    const space = {
      id: ID(200 + state.spaces.length),
      name: body.name,
      slug: body.slug ?? body.name.toLowerCase().replace(/\s+/g, '-'),
      status: 'ACTIVE',
      city,
      description: body.description ?? null,
      address: { street: null, number: null, neighborhood: null, postalCode: null, city },
      phone: null,
      whatsapp: null,
      instagram: null,
      owners: [],
      courtsCount: 0,
      checklistDone: 0,
      showcaseMissing: ['ACTIVE_COURT', 'PRICE_PER_HOUR'],
    };
    state.spaces.push(space);
    send(res, 201, {
      space: detail(space),
      ownerInvite: body.ownerEmail ? { email: body.ownerEmail, status: 'AWAITING_SIGNUP' } : null,
    });
    return true;
  }

  const spaceMatch = path.match(/^\/v1\/super\/spaces\/([^/]+)(?:\/([a-z-]+))?$/);
  if (spaceMatch) {
    const space = state.spaces.find((s) => s.id === spaceMatch[1]);
    if (!space) {
      fail(res, 404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
      return true;
    }
    const action = spaceMatch[2];
    if (!action && method === 'GET') {
      send(res, 200, detail(space));
      return true;
    }
    if (!action && method === 'PATCH') {
      Object.assign(space, { name: body.name ?? space.name });
      send(res, 200, detail(space));
      return true;
    }
    if (action && STATUS_BY_ACTION[action] && method === 'POST') {
      space.status = STATUS_BY_ACTION[action];
      send(res, 200, detail(space));
      return true;
    }
    if (action === 'owner-invites' && method === 'POST') {
      send(res, 201, { email: body.email, status: 'INVITED' });
      return true;
    }
    if (action === 'support-sessions' && method === 'POST') {
      state.session = {
        id: ID(500),
        spaceId: space.id,
        spaceName: space.name,
        superUserId: ID(3),
        superUserName: 'Super Admin',
        reason: body.reason,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        endedAt: null,
        active: true,
      };
      send(res, 201, state.session);
      return true;
    }
  }

  const sessionMatch = path.match(/^\/v1\/super\/support-sessions\/([^/]+)(\/end)?$/);
  if (sessionMatch) {
    if (!state.session || state.session.id !== sessionMatch[1]) {
      fail(res, 404, 'SUPPORT_SESSION_NOT_FOUND', 'Sessão de suporte não encontrada.');
      return true;
    }
    if (sessionMatch[2] && method === 'POST') {
      state.session = { ...state.session, active: false, endedAt: new Date().toISOString() };
    }
    send(res, 200, state.session);
    return true;
  }

  if (path === '/v1/super/finance/summary') {
    send(res, 200, {
      period: { from: q.get('from') ?? '2026-10-01', to: q.get('to') ?? '2026-10-28' },
      totals: { receivedCents: 125050, paymentsCount: 7, reversedCents: 5000 },
      bySpace: [
        {
          spaceId: ID(101),
          spaceName: 'Espaço Exemplo A',
          receivedCents: 125050,
          paymentsCount: 7,
        },
      ],
      byService: [{ service: 'RENTAL', receivedCents: 125050, paymentsCount: 7 }],
      byMethod: [{ method: 'PIX', receivedCents: 125050, paymentsCount: 7 }],
      // Pagamento online (PG.2): no local × online.
      byChannel: [{ channel: 'ON_SITE', receivedCents: 125050, paymentsCount: 7 }],
    });
    return true;
  }
  if (path === '/v1/super/finance/payments.csv') {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end('data,espaco,valor\n2026-10-20,Espaço Exemplo A,150.00\n');
    return true;
  }

  if (path === '/v1/super/catalog/cities') {
    send(res, 200, { items: [{ ...city, timezone: 'America/Sao_Paulo', active: true }] });
    return true;
  }
  if (path === '/v1/super/catalog/sports') {
    send(res, 200, {
      items: [
        {
          id: ID(801),
          slug: 'beach-tennis',
          name: 'Beach tennis',
          icon: 'racket',
          defaultMaxPlayers: 4,
        },
      ],
    });
    return true;
  }
  if (path === '/v1/super/catalog/amenities') {
    send(res, 200, {
      items: [{ id: ID(802), slug: 'churrasqueira', name: 'Churrasqueira', icon: 'flame' }],
    });
    return true;
  }
  if (path === '/v1/super/catalog/levels') {
    send(res, 200, { items: [{ value: 'BEGINNER', label: 'Iniciante' }] });
    return true;
  }

  if (path === '/v1/super/users' && method === 'GET') {
    const users = state.users.filter((u) => !q.get('status') || u.status === q.get('status'));
    send(
      res,
      200,
      page(
        users.map((u) => ({
          ...userDetail(u),
          memberships: undefined,
          activeSessions: undefined,
          pendingDeletionRequestId: undefined,
        })),
      ),
    );
    return true;
  }
  const userMatch = path.match(/^\/v1\/super\/users\/([^/]+)(?:\/(block|unblock))?$/);
  if (userMatch) {
    const user = state.users.find((u) => u.id === userMatch[1]);
    if (!user) {
      fail(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado');
      return true;
    }
    if (userMatch[2] === 'block') user.status = 'BLOCKED';
    if (userMatch[2] === 'unblock') user.status = 'ACTIVE';
    send(res, 200, userDetail(user));
    return true;
  }
  if (path === '/v1/super/deletion-requests' && method === 'GET') {
    const items = state.deletions.filter((d) => !q.get('status') || d.status === q.get('status'));
    send(res, 200, page(items));
    return true;
  }
  const deletionMatch = path.match(
    /^\/v1\/super\/deletion-requests\/([^/]+)\/(fulfill|reject|cancel)$/,
  );
  if (deletionMatch && method === 'POST') {
    const request = state.deletions.find((d) => d.id === deletionMatch[1]);
    if (request?.status !== 'PENDING') {
      fail(res, 409, 'DELETION_REQUEST_RESOLVED', 'Pedido já resolvido.');
      return true;
    }
    request.status = { fulfill: 'COMPLETED', reject: 'REJECTED', cancel: 'CANCELLED' }[
      deletionMatch[2]
    ];
    request.note = body.note ?? null;
    request.resolvedAt = NOW;
    request.resolvedBy = 'Super Admin';
    request.pending = null;
    request.overdue = false;
    // Cancelar o pedido reativa a conta inativada (decisão 40).
    const user = state.users.find((u) => u.id === request.userId);
    if (user && deletionMatch[2] === 'cancel' && user.status === 'INACTIVE') user.status = 'ACTIVE';
    send(res, 200, request);
    return true;
  }
  if (path === '/v1/super/admins' && method === 'POST') {
    const user = state.users.find((u) => u.email === body.email);
    if (user?.status === 'INACTIVE') {
      fail(res, 409, 'USER_IS_INACTIVE', 'Conta inativa');
      return true;
    }
    send(res, 200, {
      id: ID(8),
      name: user?.name ?? 'Novo Super',
      email: body.email,
      status: 'ACTIVE',
      createdAt: NOW,
    });
    return true;
  }
  if (path === '/v1/super/admins') {
    send(res, 200, {
      items: [
        {
          id: ID(3),
          name: 'Super Admin',
          email: 'super@exemplo.com',
          status: 'ACTIVE',
          createdAt: NOW,
        },
      ],
    });
    return true;
  }
  if (path === '/v1/super/metrics/spaces') {
    send(res, 200, {
      ...page(
        state.spaces.map((s) => ({
          spaceId: s.id,
          name: s.name,
          slug: s.slug,
          status: s.status,
          bookings: 12,
          activeRecurring: 3,
          activeStudents: 0,
          attendances: 0,
          tournaments: 0,
          lastAccessAt: NOW,
        })),
      ),
      period: { from: '2026-10-01', to: '2026-10-28' },
    });
    return true;
  }
  if (path === '/v1/super/audit-logs') {
    send(res, 200, {
      items: [
        {
          id: ID(900),
          actorId: ID(3),
          actorName: 'Super Admin',
          actingAsSuper: true,
          spaceId: ID(101),
          spaceName: 'Espaço Exemplo A',
          action: 'support.start',
          entity: 'support_session',
          entityId: ID(500),
          diff: { reason: 'teste' },
          createdAt: NOW,
        },
      ],
      nextCursor: null,
    });
    return true;
  }
  return false;
}

function userDetail(user) {
  return {
    ...user,
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified ?? false,
    platformRole: 'USER',
    createdAt: NOW,
    deletedAt: null,
    spacesCount: 0,
    memberships: [],
    activeSessions: 1,
    pendingDeletionRequestId: null,
  };
}

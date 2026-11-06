// API simulada para o e2e do web: imita o contrato real de `/v1/auth/*` (Better Auth, erros no
// formato `{ error: { code, message }, requestId }`) e de `GET /v1/me`. A sessão é o cookie
// `space-sports.session_token`, cujo valor é a chave de um dos perfis abaixo.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { handleAlunos } from './mock-alunos.mjs';
import { handleClasses } from './mock-classes.mjs';
import { handleContacts } from './mock-contacts.mjs';
import { handleOnlinePayments } from './mock-online-payments.mjs';
import {
  handleReviews,
  REVIEW_SPACES,
  reviewShowcaseMissing,
  spaceRating,
} from './mock-reviews.mjs';
import { handleSuper, superShowcaseVisible } from './mock-super.mjs';

const PORT = Number(process.env.MOCK_API_PORT ?? 3334);
const COOKIE = 'space-sports.session_token';
const PASSWORD = 'senha-1234';
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Estado por teste: o registro de chamadas e o `logoUrl` do espaço A pertencem a um "escopo", dado
// pelo cookie `e2e-scope` (browser, repassado pelo Next) ou pelo header `x-e2e-scope` (o `request`
// do Playwright). Sem escopo, vale o `default`. Assim o `/__reset` e as leituras de `/__calls` de um
// teste não enxergam nem apagam os de outro rodando em paralelo (ver e2e/fixtures.ts).
const scopeStore = new AsyncLocalStorage();
const states = new Map();
function state() {
  const scope = scopeStore.getStore() ?? 'default';
  let current = states.get(scope);
  if (!current) {
    current = { calls: [], logoUrl: null, me: {} };
    states.set(scope, current);
  }
  return current;
}
function scopeOf(req) {
  const header = req.headers['x-e2e-scope'];
  if (typeof header === 'string' && header) return header;
  const cookie = (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([name]) => name === 'e2e-scope');
  return cookie?.[1];
}

// `logoUrl` do espaço A muda com o envio/remoção da logo (`PUT/DELETE .../logo`) e volta a `null`
// no `/__reset` (por escopo); o arquivo é servido pela própria API simulada em `/__assets/logo.svg`.
const LOGO_URL = `http://localhost:${PORT}/__assets/logo.svg`;
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#06202E"/><circle cx="32" cy="32" r="18" fill="#FBBD10"/></svg>';
const spaceA = {
  id: ID(101),
  name: 'Espaço Exemplo A',
  slug: 'espaco-a',
  status: 'ACTIVE',
  get logoUrl() {
    return state().logoUrl;
  },
  set logoUrl(value) {
    state().logoUrl = value;
  },
};
const spaceB = {
  id: ID(102),
  name: 'Espaço Exemplo B',
  slug: 'espaco-b',
  status: 'ACTIVE',
  logoUrl: null,
};
/** Fora da vitrine, com 2 avaliações (e2e/mock-reviews.mjs): o painel do perfil `outside`. */
const spaceC = {
  id: REVIEW_SPACES.fora.id,
  name: REVIEW_SPACES.fora.name,
  slug: REVIEW_SPACES.fora.slug,
  status: 'ACTIVE',
  logoUrl: null,
};

// Decisão 64: todo perfil tem telefone (não verificado), salvo os que testam o completar cadastro.
const PHONE = '+5531999990000';
const profiles = {
  manager: {
    name: 'Gestora Ana',
    email: 'gestora@exemplo.com',
    super: false,
    spaces: [[spaceA, ['OWNER']]],
    birthDate: '1990-05-20',
    gender: 'FEMALE',
    favoriteSports: [
      { sport: { id: ID(301), name: 'Futevôlei', slug: 'futevolei' }, level: 'ADVANCED' },
    ],
  },
  multi: {
    name: 'Gestor Bia',
    email: 'multi@exemplo.com',
    super: false,
    spaces: [
      [spaceA, ['OWNER']],
      [spaceB, ['TEACHER']],
    ],
  },
  teacher: {
    name: 'Paulo Professor',
    email: 'professor@exemplo.com',
    super: false,
    spaces: [[spaceA, ['TEACHER']]],
  },
  super: { name: 'Super Admin', email: 'super@exemplo.com', super: true, spaces: [] },
  // Dona de um espaço fora da vitrine (sem preço/hora).
  outside: {
    name: 'Gestora Cris',
    email: 'cris@exemplo.com',
    super: false,
    spaces: [[spaceC, ['OWNER']]],
  },
  player: { name: 'Jogador Caio', email: 'jogador@exemplo.com', super: false, spaces: [] },
  // Conta antiga sem telefone (decisão 66), com "Sobre você" já preenchido.
  legacy: {
    name: 'Gestor Antigo',
    email: 'antigo@exemplo.com',
    super: false,
    phone: null,
    spaces: [[spaceA, ['OWNER']]],
    gender: 'MALE',
  },
  // Primeiro login pelo Google: sem telefone e sem senha.
  // Admin do espaço A com telefone (pagamento online: Dono x Admin).
  admin: {
    name: 'Rafa Admin',
    email: 'rafa.admin@exemplo.com',
    super: false,
    spaces: [[spaceA, ['ADMIN']]],
  },
  google: {
    name: 'Gestora Google',
    email: 'google@exemplo.com',
    super: false,
    phone: null,
    social: 'google',
    avatarUrl: 'https://lh3.googleusercontent.com/a/foto-exemplo',
    spaces: [[spaceA, ['ADMIN']]],
  },
};
const byEmail = Object.fromEntries(Object.entries(profiles).map(([key, p]) => [p.email, key]));

/** Chamadas de escrita recebidas, para os testes conferirem `callbackURL`/`redirectTo`. */
const calls = { push: (call) => state().calls.push(call) };

/**
 * `GET /v1/me` do perfil, com o que o teste já editou (`PATCH /v1/me/profile`, foto) guardado por
 * escopo em `state().me[key]`.
 */
function meOf(key) {
  const p = profiles[key];
  const edited = state().me[key] ?? {};
  const name = edited.name ?? p.name;
  const phone = edited.phone !== undefined ? edited.phone : p.phone === undefined ? PHONE : p.phone;
  return {
    id: ID(Object.keys(profiles).indexOf(key) + 1),
    name,
    email: p.email,
    emailVerified: !p.unverified,
    phone,
    phoneVerified: false,
    avatarUrl: edited.avatarUrl !== undefined ? edited.avatarUrl : (p.avatarUrl ?? null),
    birthDate: edited.birthDate !== undefined ? edited.birthDate : (p.birthDate ?? null),
    gender: edited.gender !== undefined ? edited.gender : (p.gender ?? null),
    favoriteSports: edited.favoriteSports ?? p.favoriteSports ?? [],
    profile: { missing: [...(name.trim() ? [] : ['name']), ...(phone ? [] : ['phone'])] },
    platformRole: p.super ? 'SUPER' : 'USER',
    memberships: p.spaces.map(([space, roles]) => ({ space, roles })),
    access: { super: p.super, management: p.spaces.length > 0 },
  };
}

function sessionKey(req) {
  const match = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('='));
  const value = match.find(([name]) => name === COOKIE)?.[1];
  return value && value in profiles ? value : undefined;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const fail = (res, status, code, message) =>
  send(res, status, { error: { code, message }, requestId: 'mock' });
const setSession = (key) => ({ 'set-cookie': `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Lax` });

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// --- Painel do espaço: dados fixos e escritas registradas em `calls` ---------------------------
const COURT = {
  id: ID(201),
  name: 'Quadra 1',
  covered: false,
  status: 'ACTIVE',
  sports: [
    { sportId: ID(301), slug: 'futevolei', name: 'Futevôlei', maxPlayers: 8 },
    { sportId: ID(302), slug: 'beach-tenis', name: 'Beach tênis', maxPlayers: 4 },
  ],
};
const CITY = { id: ID(401), name: 'Belo Horizonte', state: 'MG' };
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: '08:00',
  closesAt: '22:00',
}));
const SETTINGS = {
  pricePerHourCents: 12000,
  bookingMinDurationMin: 60,
  bookingMaxDurationMin: 180,
  bookingMinAdvanceMin: 60,
  bookingWindowDays: 30,
  cancellationDeadlineMin: 60,
  attendanceMode: 'AUTOMATIC',
  attendanceOpenBeforeMin: 1440,
  attendanceCloseBeforeMin: 60,
  attendanceCancelDeadlineMin: 120,
  pastDueBlockEnabled: true,
  pastDueBlockDays: 7,
  acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
};

/** Hoje (YYYY-MM-DD) em America/Sao_Paulo. */
function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Decisão 53: o que a API tira da reserva para quem não tem `payment.record`. */
const withoutMoney = (booking) => ({
  ...booking,
  pricePerHourCents: null,
  priceCents: null,
  paidCents: null,
  paymentStatus: null,
  intendedPaymentMethod: null,
});

function todayBooking() {
  // 12:00–13:00 locais (UTC-3) de hoje.
  const date = todayInSaoPaulo();
  return {
    id: ID(501),
    space: { id: spaceA.id, name: spaceA.name, slug: spaceA.slug, timeZone: 'America/Sao_Paulo' },
    court: { id: COURT.id, name: COURT.name },
    sport: { id: COURT.sports[0].sportId, name: 'Futevôlei', slug: 'futevolei' },
    organizer: { userId: null, name: 'Carlos Souza', phone: '+5531999998888' },
    startsAt: `${date}T15:00:00.000Z`,
    endsAt: `${date}T16:00:00.000Z`,
    durationMin: 60,
    peopleCount: 4,
    pricePerHourCents: 12000,
    priceCents: 12000,
    paidCents: 0,
    status: 'CONFIRMED',
    paymentStatus: 'PENDING',
    intendedPaymentMethod: null,
    source: 'DESK',
    cancellableUntil: `${date}T14:00:00.000Z`,
    cancelledAt: null,
    cancelReason: null,
    createdAt: `${date}T10:00:00.000Z`,
    // Pagamento online (PG.2): sem cobrança nem abatimento na reserva de balcão padrão.
    paymentDueAt: null,
    openOnlineCharge: null,
    discountCents: 0,
  };
}

const publicSpace = {
  id: spaceA.id,
  slug: 'arena-exemplo',
  name: 'Arena Exemplo',
  description: 'Quadras de areia no centro da cidade.',
  get logoUrl() {
    return spaceA.logoUrl;
  },
  address: {
    street: 'Rua Exemplo',
    number: '10',
    neighborhood: 'Centro',
    postalCode: '30000000',
    city: CITY,
  },
  location: { lat: -19.92, lng: -43.94 },
  phone: '+5531999990000',
  whatsapp: '+5531999990000',
  instagram: 'arena.exemplo',
  photos: [{ id: ID(601), url: 'https://example.com/capa.jpg', blurhash: null, position: 0 }],
  amenities: [{ id: ID(701), slug: 'vestiario', name: 'Vestiário', icon: null }],
  openingHours: everyDay,
  acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
  sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
  services: ['RENTAL'],
  courts: [{ id: COURT.id, name: COURT.name, covered: false, sports: COURT.sports }],
  rental: {
    pricePerHourCents: 12000,
    minDurationMin: 60,
    maxDurationMin: 180,
    minAdvanceMin: 60,
    windowDays: 30,
    cancellationDeadlineMin: 60,
  },
  // Avaliações (decisão 102): média a partir de 5; abaixo disso, `average` nula (selo "Novo").
  // De propósito atrasado em relação ao resumo (o cadastro tem cache de 5 min e o resumo, de 60 s):
  // o cabeçalho da página tem de seguir o resumo do bloco, não este valor.
  rating: { count: 4, average: null },
};

/** Espaço com poucas avaliações (selo "Novo"), só para a página pública. */
const newPublicSpace = {
  ...publicSpace,
  id: REVIEW_SPACES.nova.id,
  slug: REVIEW_SPACES.nova.slug,
  name: REVIEW_SPACES.nova.name,
  logoUrl: null,
  photos: [],
  rating: spaceRating(REVIEW_SPACES.nova.id),
};

const members = [
  {
    userId: ID(1),
    name: 'Gestora Ana',
    email: 'gestora@exemplo.com',
    avatarUrl: null,
    roles: ['OWNER'],
    joinedAt: '2026-01-10T12:00:00.000Z',
  },
  {
    userId: ID(50),
    name: 'Rafa Admin',
    email: 'rafa@exemplo.com',
    avatarUrl: null,
    roles: ['ADMIN'],
    joinedAt: '2026-02-10T12:00:00.000Z',
  },
  {
    userId: ID(51),
    name: 'Paulo Professor',
    email: 'paulo@exemplo.com',
    avatarUrl: null,
    roles: ['TEACHER'],
    joinedAt: '2026-03-10T12:00:00.000Z',
  },
  {
    userId: ID(52),
    name: 'Lia Admin',
    email: 'lia@exemplo.com',
    avatarUrl: null,
    roles: ['ADMIN', 'TEACHER'],
    joinedAt: '2026-03-11T12:00:00.000Z',
  },
];

const teacherInvites = [
  {
    id: ID(961),
    email: 'novo.prof@exemplo.com',
    role: 'TEACHER',
    status: 'PENDING',
    expiresAt: '2030-01-01T00:00:00.000Z',
    invitedBy: { id: ID(1), name: 'Gestora Ana' },
    createdAt: '2026-10-01T12:00:00.000Z',
  },
];

// --- Aulas: turmas, planos e professores -------------------------------------------------------
const SPORT = { id: COURT.sports[0].sportId, name: 'Futevôlei', slug: 'futevolei' };
const TEACHERS = [
  { memberId: ID(1051), userId: ID(51), name: 'Paulo Professor', avatarUrl: null },
  { memberId: ID(1052), userId: ID(52), name: 'Lia Admin', avatarUrl: null },
];
const classGroup = (n, over) => ({
  id: ID(1100 + n),
  name: 'Futevôlei Iniciante',
  sport: SPORT,
  level: 'BEGINNER',
  teachers: [TEACHERS[0]],
  court: { id: COURT.id, name: COURT.name },
  weekday: 2,
  startTime: '19:00',
  durationMin: 60,
  capacity: 12,
  active: true,
  enrolledCount: 4,
  availableSpots: 8,
  createdAt: '2026-09-01T12:00:00.000Z',
  ...over,
});
const CLASS_GROUPS = [
  classGroup(1, {}),
  classGroup(2, {
    name: 'Futevôlei Avançado',
    level: 'ADVANCED',
    teachers: [TEACHERS[1]],
    weekday: 4,
    startTime: '20:00',
    durationMin: 90,
    capacity: 8,
    enrolledCount: 8,
    availableSpots: 0,
  }),
  classGroup(3, {
    name: 'Futevôlei Manhã',
    level: null,
    teachers: [TEACHERS[0], TEACHERS[1]],
    weekday: 6,
    startTime: '09:00',
    active: false,
    enrolledCount: 0,
    availableSpots: 12,
  }),
];
const plan = (n, over) => ({
  id: ID(1200 + n),
  name: 'Futevôlei 2x por semana',
  sport: SPORT,
  weeklyFrequency: 2,
  priceCents: 18000,
  billingDay: 10,
  active: true,
  createdAt: '2026-09-01T12:00:00.000Z',
  ...over,
});
const PLANS = [
  plan(1, {}),
  plan(2, {
    name: 'Futevôlei livre',
    weeklyFrequency: null,
    priceCents: 25050,
    billingDay: 5,
  }),
  plan(3, { name: 'Futevôlei 1x (antigo)', weeklyFrequency: 1, priceCents: 9000, active: false }),
];

/** Responde e sinaliza que a rota foi tratada. */
const reply = (res, status, body) => {
  send(res, status, body);
  return true;
};

/** Erro 409 com `details` (conflitos de aulas). */
const reply409 = (res, code, message, details) => {
  send(res, 409, { error: { code, message, details }, requestId: 'mock' });
  return true;
};

/** Rotas do painel do espaço, do convite e da página pública. Devolve `true` se respondeu. */
async function handleSpaceRoutes(req, res, url, path) {
  const method = req.method ?? 'GET';
  const record = async () => {
    const body = await readJson(req);
    calls.push({ path: `${method} ${path}`, body });
    return body;
  };

  if (method === 'GET' && path === `/v1/spaces/${publicSpace.slug}`) {
    send(res, 200, publicSpace);
    return true;
  }
  if (method === 'GET' && path === `/v1/spaces/${newPublicSpace.slug}`) {
    send(res, 200, newPublicSpace);
    return true;
  }
  if (method === 'GET' && path.startsWith('/v1/spaces/')) {
    fail(res, 404, 'SPACE_NOT_FOUND', 'Espaço não encontrado.');
    return true;
  }

  const invite = /^\/v1\/staff-invites\/([^/]+)(\/accept)?$/.exec(path);
  if (invite) {
    const token = invite[1];
    if (token === 'expirado') {
      fail(res, 409, 'STAFF_INVITE_EXPIRED', 'Convite expirado.');
    } else if (token !== 'valido') {
      fail(res, 404, 'STAFF_INVITE_NOT_FOUND', 'Convite não encontrado.');
    } else if (method === 'GET') {
      send(res, 200, {
        email: 'rafa@exemplo.com',
        role: 'ADMIN',
        expiresAt: '2030-01-01T00:00:00.000Z',
        space: spaceA,
        hasAccount: true,
      });
    } else {
      await record();
      const key = sessionKey(req);
      if (!key) fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      else if (profiles[key].email !== 'rafa@exemplo.com') {
        fail(res, 403, 'STAFF_INVITE_EMAIL_MISMATCH', 'E-mail diferente.');
      } else send(res, 200, { roles: ['ADMIN'] });
    }
    return true;
  }

  const manage = /^\/v1\/manage\/spaces\/([^/]+)(\/.*)?$/.exec(path);
  if (!manage) return false;
  if (!sessionKey(req)) {
    fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    return true;
  }
  const managedId = manage[1];
  const sub = manage[2] ?? '';

  // Assinaturas, mensalidades e presença das aulas: mock próprio (`mock-alunos.mjs`).
  const handled = await handleAlunos({
    req,
    res,
    url,
    sub,
    method,
    send,
    fail,
    readJson,
    calls,
    path,
    profile: sessionKey(req),
  });
  if (handled) return true;

  // Pagamento online (PG.3): recebimentos online, carteira e o detalhe da reserva com cobrança.
  const online = await handleOnlinePayments({
    req,
    res,
    url,
    sub,
    method,
    send,
    fail,
    readJson,
    calls,
    scoped: state(),
    profile: sessionKey(req),
    todayBooking,
    withoutMoney,
  });
  if (online) return true;

  // Logo do espaço (RF-SPACE-11): o arquivo vai direto ao storage (nos testes, interceptado).
  if (sub === '/logo/uploads' && method === 'POST') {
    const body = await record();
    return reply(res, 200, {
      uploadUrl: 'http://storage.exemplo.test/logos/espaco-a',
      method: 'PUT',
      headers: { 'content-type': body.contentType },
      key: 'spaces/espaco-a/logo/abc.png',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  }
  if (sub === '/logo' && method === 'PUT') {
    await record();
    spaceA.logoUrl = LOGO_URL;
    return reply(res, 200, { ...spaceA, logoUrl: LOGO_URL });
  }
  if (sub === '/logo' && method === 'DELETE') {
    calls.push({ path: 'DELETE /logo', body: {} });
    spaceA.logoUrl = null;
    res.writeHead(204);
    res.end();
    return true;
  }

  if (method === 'GET') {
    if (sub === '/courts') return reply(res, 200, { items: [COURT] });
    if (sub === '/settings') return reply(res, 200, SETTINGS);
    if (sub === '') {
      // O espaço C responde com os próprios dados; os demais, com os do A (o mock do painel).
      const managed = managedId === spaceC.id ? spaceC : spaceA;
      const missing = reviewShowcaseMissing(managed.id);
      send(res, 200, {
        id: managed.id,
        name: managed.name,
        slug: managed.slug,
        description: null,
        logoUrl: managed.logoUrl,
        status: 'ACTIVE',
        address: { street: null, number: null, neighborhood: null, postalCode: null, city: CITY },
        location: null,
        phone: null,
        whatsapp: null,
        instagram: null,
        photos: [],
        amenities: [],
        openingHours: everyDay,
        showcase: { visible: missing.length === 0, missing },
      });
      return true;
    }
    if (sub === '/bookings') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const b = todayBooking();
      const inRange = (!from || b.endsAt > from) && (!to || b.startsAt < to);
      const item = sessionKey(req) === 'teacher' ? withoutMoney(b) : b;
      send(res, 200, { items: inRange ? [item] : [], nextCursor: null });
      return true;
    }
    if (sub.startsWith('/bookings/') && sessionKey(req) === 'teacher') {
      send(res, 200, {
        ...withoutMoney(todayBooking()),
        suggestedUser: null,
        participants: [
          {
            id: ID(802),
            userId: ID(90),
            name: 'Dani Rocha',
            isOrganizer: false,
            shareCents: null,
            status: 'ACCEPTED',
            inviteToken: null,
            inviteUrl: null,
          },
        ],
        payments: [],
        onlineCharges: [],
      });
      return true;
    }
    if (sub.startsWith('/bookings/')) {
      send(res, 200, {
        ...todayBooking(),
        // Telefone de uma conta: só sugestão, até a gestão confirmar (RF-CONTACT-05).
        suggestedUser: state().linked ? null : { id: ID(61), firstName: 'Carlos' },
        participants: [
          {
            id: ID(801),
            userId: null,
            name: 'Carlos Souza',
            isOrganizer: true,
            shareCents: 6000,
            status: 'ACCEPTED',
            inviteToken: null,
            inviteUrl: null,
          },
          {
            id: ID(802),
            userId: ID(90),
            name: 'Dani Rocha',
            isOrganizer: false,
            shareCents: 6000,
            status: 'ACCEPTED',
            inviteToken: null,
            inviteUrl: null,
          },
        ],
        // Registro antigo por participante (decisão 50): continua legível no histórico.
        payments: [
          {
            id: ID(951),
            payableType: 'BOOKING_PARTICIPANT',
            payableId: ID(802),
            payerUserId: ID(90),
            amountCents: 6000,
            method: 'PIX',
            paidAt: '2026-09-10T15:00:00.000Z',
            channel: 'ON_SITE',
            onlineChargeId: null,
            recordedBy: ID(1),
            note: null,
            reversedAt: '2026-09-11T15:00:00.000Z',
            reversedBy: ID(1),
          },
        ],
        onlineCharges: [],
      });
      return true;
    }
    if (sub === '/court-blocks') return reply(res, 200, []);
    if (sub === '/receivables/today') {
      send(res, 200, {
        date: todayInSaoPaulo(),
        timeZone: 'America/Sao_Paulo',
        totalDueCents: 12000,
        items: [{ booking: todayBooking(), dueCents: 12000 }],
      });
      return true;
    }
    if (sub === '/statement' || sub === '/statement.csv') {
      const entry = (n, over) => ({
        id: ID(950 + n),
        payableType: 'BOOKING',
        payableId: ID(501),
        payerUserId: null,
        amountCents: 12000,
        method: 'PIX',
        paidAt: new Date().toISOString(),
        channel: 'ON_SITE',
        onlineChargeId: null,
        recordedBy: ID(1),
        note: null,
        reversedAt: null,
        reversedBy: null,
        service: 'RENTAL',
        payerName: 'Carlos Souza',
        recordedByName: 'Gestora Exemplo',
        bookingId: ID(501),
        bookingStartsAt: todayBooking().startsAt,
        recurringBookingId: null,
        chargePeriodStart: null,
        courtName: COURT.name,
        ...over,
      });
      if (sub === '/statement.csv') {
        calls.push({
          path: `GET ${path}`,
          body: Object.fromEntries(url.searchParams.entries()),
        });
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
        res.end('id,valor_centavos\r\n1,12000\r\n');
        return true;
      }
      send(res, 200, {
        period: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
        timeZone: 'America/Sao_Paulo',
        totals: { receivedCents: 12000, paymentsCount: 1, reversedCents: 5000 },
        byMethod: [{ method: 'PIX', receivedCents: 12000, paymentsCount: 1 }],
        byChannel: [{ channel: 'ON_SITE', receivedCents: 12000, paymentsCount: 1 }],
        items: [
          entry(1, {}),
          entry(2, {
            amountCents: 5000,
            method: 'CASH',
            payerName: 'Marina Lopes',
            reversedAt: new Date().toISOString(),
          }),
        ],
        nextCursor: null,
      });
      return true;
    }
    if (sub === '/recurring-bookings') {
      const pending = url.searchParams.getAll('status').includes('PENDING_APPROVAL');
      send(res, 200, {
        items: pending
          ? [
              {
                id: ID(901),
                space: { id: spaceA.id, name: spaceA.name, slug: spaceA.slug },
                court: { id: COURT.id, name: COURT.name },
                sport: { id: COURT.sports[0].sportId, name: 'Futevôlei', slug: 'futevolei' },
                customer: { userId: ID(60), name: 'Marina Lopes', phone: null },
                weekday: 2,
                startTime: '19:00:00',
                durationMin: 60,
                peopleCount: 6,
                startsOn: todayInSaoPaulo(),
                endsOn: null,
                status: 'PENDING_APPROVAL',
                statusReason: null,
                createdAt: '2026-10-01T12:00:00.000Z',
              },
            ]
          : [],
        nextCursor: null,
      });
      return true;
    }
    if (sub.startsWith('/recurring-bookings/')) {
      send(res, 200, {
        id: ID(901),
        space: { id: spaceA.id, name: spaceA.name, slug: spaceA.slug },
        court: { id: COURT.id, name: COURT.name },
        sport: { id: COURT.sports[0].sportId, name: 'Futevôlei', slug: 'futevolei' },
        customer: { userId: ID(60), name: 'Marina Lopes', phone: null },
        weekday: 2,
        startTime: '19:00:00',
        durationMin: 60,
        peopleCount: 6,
        startsOn: todayInSaoPaulo(),
        endsOn: null,
        status: 'PENDING_APPROVAL',
        statusReason: null,
        createdAt: '2026-10-01T12:00:00.000Z',
        conflicts: [],
      });
      return true;
    }
    if (sub === '/recurring-conflicts') return reply(res, 200, []);
    if (sub === '/team') return reply(res, 200, { members, invites: teacherInvites });
    if (sub === '/teachers') {
      return reply(res, 200, {
        items: [
          { ...TEACHERS[0], activeClassGroupCount: 2 },
          { ...TEACHERS[1], activeClassGroupCount: 0 },
        ],
      });
    }
    if (sub === '/class-groups') {
      // O Professor só enxerga as turmas dele (a API filtra por `teacher_member_id`).
      const own = sessionKey(req) === 'teacher';
      return reply(res, 200, {
        items: own
          ? CLASS_GROUPS.filter((g) => g.teachers.some((t) => t.memberId === ID(1051)))
          : CLASS_GROUPS,
      });
    }
    if (sub === '/class-session-conflicts') {
      return reply(res, 200, {
        items: [
          {
            id: ID(1301),
            classGroup: { id: CLASS_GROUPS[0].id, name: CLASS_GROUPS[0].name },
            court: { id: COURT.id, name: COURT.name },
            startsAt: '2026-11-03T22:00:00.000Z',
            endsAt: '2026-11-03T23:00:00.000Z',
            conflictsWith: 'BLOCK',
            createdAt: '2026-10-28T06:15:00.000Z',
          },
        ],
      });
    }
    if (sub === '/plans') return reply(res, 200, { items: PLANS });
  }

  if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
    const body = await record();
    if (sub === '/bookings')
      return reply(res, 201, { ...todayBooking(), participants: [], payments: [], ...body });
    if (sub === '/payments') {
      send(res, 201, {
        id: ID(950),
        payableType: body.payableType,
        payableId: body.payableId,
        payerUserId: null,
        amountCents: body.amountCents,
        method: body.method,
        paidAt: new Date().toISOString(),
        recordedBy: ID(1),
        note: null,
        reversedAt: null,
        reversedBy: null,
      });
      return true;
    }
    if (sub === '/team/invites') {
      send(res, 201, {
        id: ID(960),
        email: body.email,
        role: body.role,
        status: 'PENDING',
        expiresAt: '2030-01-01T00:00:00.000Z',
        invitedBy: { id: ID(1), name: 'Gestora Ana' },
        createdAt: new Date().toISOString(),
      });
      return true;
    }
    if (sub === '/class-groups') {
      if (body.name === 'Conflito de professor') {
        return reply409(res, 'TEACHER_SCHEDULE_CONFLICT', 'Conflito de professor.', {
          teacher: { memberId: ID(1052), name: 'Lia Admin' },
          startsAt: '2026-11-04T22:00:00.000Z',
          endsAt: '2026-11-04T23:00:00.000Z',
          timeZone: 'America/Sao_Paulo',
        });
      }
      if (body.name === 'Conflito') {
        const details = { conflictsWith: 'BOOKING', startsAt: '2026-11-04T22:00:00.000Z' };
        return reply409(res, 'CLASS_SCHEDULE_CONFLICT', 'Conflito de agenda.', details);
      }
      return reply(res, 201, { ...classGroup(9, {}), ...body, conflicts: [] });
    }
    const group = /^\/class-groups\/([^/]+)$/.exec(sub);
    if (group && group[1] === ID(1102)) {
      if (method === 'DELETE' || body.active === false)
        return reply409(res, 'CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS', 'Há alunos.', {
          enrolledCount: 8,
        });
      // A API só recusa quando o esporte muda de verdade; reenviar o atual é aceito.
      if (body.sportId && body.sportId !== SPORT.id)
        return reply409(res, 'SPORT_CHANGE_NOT_ALLOWED', 'Esporte.', { enrolledCount: 8 });
    }
    if (group) return reply(res, method === 'DELETE' ? 204 : 200, { ...CLASS_GROUPS[0], ...body });
    if (sub === '/plans') return reply(res, 201, { ...PLANS[0], ...body });
    const planRoute = /^\/plans\/([^/]+)$/.exec(sub);
    if (planRoute && planRoute[1] === ID(1202) && body.sportId && body.sportId !== SPORT.id)
      return reply409(res, 'SPORT_CHANGE_NOT_ALLOWED', 'Esporte.', { subscriptionCount: 4 });
    if (planRoute) return reply(res, method === 'DELETE' ? 204 : 200, { ...PLANS[0], ...body });
    if (method === 'DELETE' && /^\/courts\/[^/]+$/.test(sub)) {
      return reply409(res, 'COURT_HAS_CLASS_GROUPS', 'A quadra tem turmas.', {
        classGroups: [{ id: CLASS_GROUPS[0].id, name: CLASS_GROUPS[0].name }],
      });
    }
    send(res, 200, {});
    return true;
  }
  return false;
}

createServer(async (req, res) => {
  try {
    await scopeStore.run(scopeOf(req), () => route(req, res));
  } catch (error) {
    // Um erro de rota não pode derrubar a API simulada no meio da suíte.
    console.error('mock api:', req.method, req.url, error);
    if (!res.headersSent) fail(res, 500, 'INTERNAL_ERROR', 'Erro na API simulada.');
  }
}).listen(PORT, () => console.log(`mock api em http://localhost:${PORT}`));

/** Erro forçado por `/__fail` para a operação: responde e o consome. */
function forcedFailure(res, op) {
  const failure = state().failures?.[op];
  if (!failure) return false;
  delete state().failures[op];
  fail(res, failure.status, failure.code, `Erro simulado (${failure.code}).`);
  return true;
}

const BR_PHONE = /^\+55[1-9]{2}(9[0-9]{8}|[2-9][0-9]{7})$/;
const AVATAR_URL = `http://localhost:${PORT}/__assets/logo.svg`;

/** Perfil (`PATCH /v1/me/profile`), foto (`/v1/me/avatar*`) e contas do login (`list-accounts`). */
async function handleMe(req, res, path, key) {
  const method = req.method;
  const edits = () => {
    state().me[key] ??= {};
    return state().me[key];
  };
  if (path === '/v1/auth/list-accounts' && method === 'GET') {
    const provider = profiles[key].social ?? 'credential';
    return send(res, 200, [
      { id: ID(900), providerId: provider, accountId: 'x', userId: meOf(key).id, scopes: [] },
    ]);
  }
  if (path === '/v1/me/profile' && method === 'PATCH') {
    const body = await readJson(req);
    calls.push({ path: 'PATCH /v1/me/profile', body });
    if (forcedFailure(res, 'profile')) return;
    if (body.phone !== undefined && !BR_PHONE.test(body.phone)) {
      return fail(res, 400, 'INVALID_PHONE_NUMBER', 'Informe um telefone brasileiro com DDD.');
    }
    const names = Object.fromEntries(COURT.sports.map((s) => [s.sportId, s]));
    const patch = { ...body };
    if (body.favoriteSports) {
      patch.favoriteSports = body.favoriteSports.map((f) => ({
        sport: {
          id: f.sportId,
          name: names[f.sportId]?.name ?? 'Esporte',
          slug: names[f.sportId]?.slug ?? 'x',
        },
        level: f.level ?? null,
      }));
    }
    Object.assign(edits(), patch);
    return send(res, 200, meOf(key));
  }
  if (path === '/v1/me/avatar/uploads' && method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: 'POST /v1/me/avatar/uploads', body });
    if (forcedFailure(res, 'avatar-upload')) return;
    return send(res, 201, {
      key: 'uploads/users/u1/avatar/abc.png',
      uploadUrl: 'http://storage.exemplo.test/avatar',
      method: 'PUT',
      headers: { 'Content-Type': body.contentType },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
  }
  if (path === '/v1/me/avatar' && method === 'PUT') {
    const body = await readJson(req);
    calls.push({ path: 'PUT /v1/me/avatar', body });
    if (forcedFailure(res, 'avatar-set')) return;
    edits().avatarUrl = AVATAR_URL;
    return send(res, 200, { avatarUrl: AVATAR_URL });
  }
  if (path === '/v1/me/avatar' && method === 'DELETE') {
    calls.push({ path: 'DELETE /v1/me/avatar', body: {} });
    edits().avatarUrl = null;
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

async function route(req, res) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/__calls') return send(res, 200, state().calls);
  if (path === '/__assets/logo.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(LOGO_SVG);
  }
  if (path === '/__reset') {
    state().calls.length = 0;
    state().me = {};
    delete state().failures;
    delete state().invites;
    delete state().superContacts;
    delete state().linked;
    delete state().online;
    delete state().reviews;
    spaceA.logoUrl = null;
    return send(res, 200, {});
  }
  if (path === '/v1/me') {
    const key = sessionKey(req);
    return key
      ? send(res, 200, meOf(key))
      : fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
  }
  if (path === '/__online-setup') {
    // Cenário do pagamento online no escopo: `merchant` (status do cadastro), `booking`
    // (`paid` | `pending` | `open`), `disabled=1` (provider none), `simulator=0` (rotas ausentes),
    // `approved=1` (já aprovado antes), `changeRejected=1` (troca de conta recusada, decisão 98) e
    // `ready=0` (`onlineReady` falso com o cadastro aprovado).
    state().online = Object.fromEntries(url.searchParams.entries());
    return send(res, 200, {});
  }
  if (path === '/__fail') {
    // Próxima chamada de `op` (`avatar-upload`, `avatar-set`, `profile`, `sign-up`) responde o erro
    // pedido: `/__fail?op=avatar-upload&status=503&code=STORAGE_UNAVAILABLE`. Vale uma vez, no escopo.
    const op = url.searchParams.get('op');
    state().failures ??= {};
    state().failures[op] = {
      status: Number(url.searchParams.get('status')),
      code: url.searchParams.get('code'),
    };
    return send(res, 200, {});
  }
  if (path.startsWith('/v1/me/') || path === '/v1/auth/list-accounts') {
    const key = sessionKey(req);
    if (!key) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    // `handleMe` responde e devolve `undefined`, ou `false` se a rota não é dele.
    if ((await handleMe(req, res, path, key)) !== false) return;
  }
  // Página pública de exclusão de conta: a resposta é sempre a mesma (não revela se o e-mail
  // existe); só o limite de tentativas dá erro.
  if (path === '/v1/public/deletion-request' && req.method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: 'POST /v1/public/deletion-request', body });
    if (body.email === 'muitas@exemplo.com') {
      return fail(res, 429, 'TOO_MANY_REQUESTS', 'Muitas tentativas.');
    }
    return send(res, 202, { message: 'Se os dados conferem, o pedido foi registrado.' });
  }
  const classKey = sessionKey(req);
  if (
    path.startsWith('/__classes-') ||
    // `/teachers` e `/class-groups` existem nos dois mocks de aulas (cadastros e sessões): a lista do
    // mock de sessões só vale quando o teste de sessões pede (cookie `e2e-classes`).
    (classKey && /^\/v1\/manage\/spaces\/[^/]+\/(class-sessions)/.test(path)) ||
    (classKey &&
      (req.headers.cookie ?? '').includes('e2e-classes=1') &&
      /^\/v1\/manage\/spaces\/[^/]+\/(class-groups|teachers|subscriptions|class-attendances|class-groups\/[^/]+\/frequency)$/.test(
        path,
      ))
  ) {
    const roles = classKey ? (profiles[classKey].spaces[0]?.[1] ?? []) : [];
    const userId = classKey ? meOf(classKey).id : undefined;
    if (await handleClasses({ req, res, path, url, send, fail, readJson, roles, userId })) return;
  }
  if (path === '/v1/sports') {
    return send(res, 200, {
      items: COURT.sports.map((s) => ({
        id: s.sportId,
        slug: s.slug,
        name: s.name,
        icon: null,
        defaultMaxPlayers: s.maxPlayers,
      })),
    });
  }
  if (path === '/v1/cities') return send(res, 200, { items: [CITY] });
  const cep = /^\/v1\/address\/cep\/([^/]+)$/.exec(path);
  if (cep) {
    if (!sessionKey(req)) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    if (cep[1] === '99999999') return fail(res, 404, 'CEP_NOT_FOUND', 'CEP não encontrado.');
    if (cep[1] === '88888888') {
      return fail(res, 503, 'CEP_LOOKUP_UNAVAILABLE', 'Busca indisponível.');
    }
    return send(res, 200, {
      postalCode: cep[1],
      street: 'Avenida Afonso Pena',
      neighborhood: 'Centro',
      city: 'Belo Horizonte',
      state: 'MG',
    });
  }
  const contactSession = sessionKey(req);
  const contactsHandled = await handleContacts({
    req,
    res,
    path,
    url,
    send,
    fail,
    readJson,
    scoped: state(),
    calls,
    session: contactSession
      ? {
          id: meOf(contactSession).id,
          profile: contactSession,
          super: profiles[contactSession].super,
        }
      : null,
  });
  if (contactsHandled) return;
  const reviewSession = sessionKey(req);
  const reviewsHandled = await handleReviews({
    req,
    res,
    path,
    url,
    send,
    fail,
    readJson,
    scoped: state(),
    calls,
    superShowcaseVisible,
    session: reviewSession
      ? {
          id: meOf(reviewSession).id,
          roles: profiles[reviewSession].spaces[0]?.[1] ?? [],
          super: profiles[reviewSession].super,
        }
      : null,
  });
  if (reviewsHandled) return;
  const handled = await handleSpaceRoutes(req, res, url, path);
  if (handled) return;
  if (path.startsWith('/__super-')) {
    if (await handleSuper({ req, res, path, url, send, fail, readJson })) return;
  }
  if (path.startsWith('/v1/super/')) {
    if (!profiles[sessionKey(req)]?.super) return fail(res, 403, 'FORBIDDEN', 'Acesso restrito.');
    if (path.startsWith('/v1/super/online-payments')) {
      const method = req.method ?? 'GET';
      if (
        await handleOnlinePayments({
          req,
          res,
          url,
          sub: path,
          method,
          send,
          fail,
          readJson,
          calls,
          scoped: state(),
          profile: sessionKey(req),
          todayBooking,
          withoutMoney,
        })
      ) {
        return;
      }
    }
    if (await handleSuper({ req, res, path, url, send, fail, readJson })) return;
  }
  if (req.method !== 'POST' || !path.startsWith('/v1/auth/')) {
    return fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  const body = await readJson(req);
  calls.push({ path: path.replace('/v1/auth', ''), body });

  switch (path.replace('/v1/auth', '')) {
    case '/sign-in/email': {
      if (body.email === 'inativa@exemplo.com') {
        return fail(res, 403, 'ACCOUNT_INACTIVE', 'Conta inativa.');
      }
      const key = byEmail[body.email];
      if (!key || body.password !== PASSWORD) {
        return fail(res, 401, 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password');
      }
      return send(res, 200, { redirect: false, token: key, user: meOf(key) }, setSession(key));
    }
    case '/sign-up/email': {
      if (forcedFailure(res, 'sign-up')) return;
      // Decisão 64: telefone obrigatório em E.164 brasileiro.
      if (typeof body.phone !== 'string' || !BR_PHONE.test(body.phone)) {
        return fail(res, 400, 'INVALID_PHONE_NUMBER', 'Informe um telefone brasileiro com DDD.');
      }
      if (body.email in byEmail || body.email === 'existente@exemplo.com') {
        return fail(res, 422, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'User already exists.');
      }
      return send(res, 200, { token: 'player', user: meOf('player') }, setSession('player'));
    }
    case '/sign-out':
      return send(
        res,
        200,
        { success: true },
        {
          'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        },
      );
    case '/request-password-reset':
      return send(res, 200, { status: true, message: 'ok' });
    case '/reset-password':
      return body.token === 'valido'
        ? send(res, 200, { status: true })
        : fail(res, 400, 'INVALID_TOKEN', 'Invalid token');
    case '/send-verification-email':
      return send(res, 200, { status: true });
    case '/change-password': {
      const key = sessionKey(req);
      if (!key) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
      if (body.currentPassword !== PASSWORD) {
        return fail(res, 400, 'INVALID_PASSWORD', 'Invalid password');
      }
      return send(res, 200, { token: null, user: meOf(key) });
    }
    default:
      return fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  }
}

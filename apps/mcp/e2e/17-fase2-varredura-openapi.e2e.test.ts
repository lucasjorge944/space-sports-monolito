import { describe, expect, it } from 'vitest';
import { MCP_ADMIN_URL, PORTS, USERS } from './support/env.js';
import {
  expectNoWrites,
  fill,
  isSuperOp,
  type Operation,
  openApiOperations,
  PLACEHOLDER,
  realParams,
  resetLimits,
  snapshot,
  superConn,
  tick,
  userConn,
  world,
} from './support/fase2.js';
import { api } from './support/oauth.js';

// Fase 2, varredura de TODAS as operações do OpenAPI com o token de gestão (Dono com manage:*) e com o
// do Super (docs/14-mcp.md 3.3, 8.2 e 8.3; RN-MCP-01, RN-MCP-07 e RN-MCP-08; decisões 112, 113, 120 e
// 122): só as operações da lista de cada recurso respondem, nenhuma escrita passa e o banco fica igual.
// Os ids dos pedidos são REAIS (o Dono é Dono do espaço de verdade): se a trava de rota falhasse, a
// escrita aconteceria.

const w = world();
const OPS = openApiOperations();

/** Escritas que a fase 1 deixa o jogador fazer (bookings:write e classes:write): as únicas não-GET na lista. */
const PLAYER_WRITES = new Set([
  'POST /v1/bookings',
  'POST /v1/bookings/{bookingId}/cancel',
  'POST /v1/me/class-sessions/{sessionId}/attendance',
  'DELETE /v1/me/class-sessions/{sessionId}/attendance',
]);

/** As 13 rotas do Super (docs/14-mcp.md 8.3). */
const SUPER_LIST = [
  'GET /v1/super/analytics/platform',
  'GET /v1/super/analytics/spaces',
  'GET /v1/super/audit-logs',
  'GET /v1/super/finance/summary',
  'GET /v1/super/metrics/spaces',
  'GET /v1/super/online-payments/reports/monthly',
  'GET /v1/super/online-payments/revenue',
  'GET /v1/super/reviews/reports',
  'GET /v1/super/reviews/summary',
  'GET /v1/super/spaces',
  'GET /v1/super/spaces/{spaceId}',
  'GET /v1/super/users',
  'GET /v1/super/users/{userId}',
];

const id = (op: Operation) => `${op.method} ${op.path}`;
const inUserResource = (op: Operation) => op.listed && !isSuperOp(op);
const inAdminResource = (op: Operation) => op.listed && isSuperOp(op);

/** Query obrigatória de algumas leituras da lista (para o controle positivo ser 200). */
function controlQuery(op: Operation): string {
  const { from, to } = w.windows;
  if (/\{spaceId\}\/(court-blocks|statement)$/.test(op.path)) {
    return `?from=${from}T03:00:00.000Z&to=${to}T23:00:00.000Z`;
  }
  if (op.path.endsWith('/class-attendances')) return `?classGroupId=${w.spaces.a.groupId}`;
  if (op.path.endsWith('/reports/monthly')) return `?month=${from.slice(0, 7)}`;
  if (op.path.endsWith('/reviews/summary') && op.path.startsWith('/v1/super')) {
    return `?spaceId=${w.spaces.a.id}`;
  }
  return '';
}

const bodyOf = (op: Operation) =>
  op.method === 'GET' || op.method === 'DELETE' ? {} : { json: {} };

async function sweep(token: string, inList: (op: Operation) => boolean) {
  const notAllowed: string[] = [];
  const answered: string[] = [];
  const failures: string[] = [];
  const params = realParams();
  for (const op of OPS) {
    await tick();
    const res = await api(fill(op.path, params), token, { method: op.method, ...bodyOf(op) });
    const code = res.body?.error?.code as string | undefined;
    if (inList(op)) {
      answered.push(id(op));
      if (res.status === 401 || code === 'OAUTH_ROUTE_NOT_ALLOWED' || res.status >= 500) {
        failures.push(`na lista mas ${id(op)} → ${res.status} ${code ?? ''}`);
      }
      // Escritas de jogador da lista com corpo vazio: nunca 2xx (só validação ou 404).
      if (op.method !== 'GET' && res.status < 400) {
        failures.push(`escrita ${id(op)} deu ${res.status}`);
      }
    } else {
      notAllowed.push(id(op));
      if (res.status !== 403 || code !== 'OAUTH_ROUTE_NOT_ALLOWED') {
        failures.push(`fora da lista ${id(op)} → ${res.status} ${code ?? ''}`);
      }
    }
  }
  return { notAllowed, answered, failures };
}

describe('(2) a lista de cada recurso é exatamente a documentada (contrato OpenAPI)', () => {
  it('Super: as 13 rotas, todas GET; jogador/gestão: toda rota de gestão é GET e as únicas escritas são as 4 do jogador', () => {
    expect(OPS.length).toBeGreaterThan(280);
    expect(OPS.filter(inAdminResource).map(id).sort()).toEqual([...SUPER_LIST].sort());
    const user = OPS.filter(inUserResource);
    const writes = user.filter((op) => op.method !== 'GET').map(id);
    expect(writes.sort()).toEqual([...PLAYER_WRITES].sort());
    for (const op of user.filter((o) => o.scopes.some((s) => s.startsWith('manage:')))) {
      expect(op.method, id(op)).toBe('GET');
    }
    for (const op of OPS.filter((o) => o.scopes.includes('super:read'))) {
      expect(op.method, id(op)).toBe('GET');
    }
    // Nada que pareça CSV, conta de pagamento, contatos ou convites entrou na lista.
    const dangerous =
      /\.csv|contacts|merchant-account|\/settings|payouts|invites|deletion|support-session|simulator|admins|fees|catalog|ads|advertis/i;
    expect(OPS.filter((op) => op.listed && dangerous.test(op.path)).map(id)).toEqual([]);
  });
});

describe('(2) varredura com o token de gestão (Dono com manage:read e manage:finance:read)', () => {
  it('só as operações da lista do recurso respondem; o resto é 403 OAUTH_ROUTE_NOT_ALLOWED; o banco não muda', async () => {
    const conn = await userConn('dona');
    const result = await expectNoWrites(() => sweep(conn.token, inUserResource));
    expect(result.failures).toEqual([]);
    expect(result.answered.length).toBe(OPS.filter(inUserResource).length);
    expect(result.notAllowed.length).toBe(OPS.length - result.answered.length);
    expect(result.notAllowed.length).toBeGreaterThan(250);
  });

  it('as rotas de gestão da lista RESPONDEM 200 para o Dono dos ids reais (a varredura não é só de recusas)', async () => {
    const conn = await userConn('dona');
    const params = realParams();
    const failures: string[] = [];
    for (const op of OPS.filter((o) => o.listed && o.scopes.some((s) => s.startsWith('manage:')))) {
      if (op.path.includes('{chargeId}')) continue; // cobrança online de outro espaço: 404
      await tick();
      const res = await api(fill(op.path, params) + controlQuery(op), conn.token);
      if (res.status !== 200)
        failures.push(`${id(op)} → ${res.status} ${res.body?.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
  });

  it('escritas realistas de gestão (quadra, reserva de balcão, pagamento, bloqueio, equipe, configurações): 403 e nada gravado', async () => {
    const conn = await userConn('dona');
    const a = w.spaces.a;
    const base = `/v1/manage/spaces/${a.id}`;
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const attempts: [string, string, unknown][] = [
      ['POST', `${base}/courts`, { name: 'Quadra Fantasma', sportIds: [a.sportId] }],
      [
        'POST',
        `${base}/bookings`,
        {
          courtId: a.court1,
          sportId: a.sportId,
          startsAt,
          durationMin: 60,
          peopleCount: 2,
          guestName: 'Fantasma',
          guestPhone: '+5531900009999',
        },
      ],
      ['POST', `${base}/bookings/${a.bookingId}/cancel`, { reason: 'x' }],
      ['POST', `${base}/bookings/${a.bookingId}/no-show`, undefined],
      [
        'POST',
        `${base}/payments`,
        { payableType: 'BOOKING', payableId: a.bookingId, amountCents: 100, method: 'CASH' },
      ],
      [
        'POST',
        `${base}/court-blocks`,
        {
          courtId: a.court1,
          startsAt,
          endsAt: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
        },
      ],
      ['PATCH', `${base}`, { name: 'Invadida' }],
      ['PATCH', `${base}/settings`, { pricePerHourCents: 1 }],
      ['PUT', `${base}/online-payments/settings`, { enabled: true }],
      ['POST', `${base}/team/invites`, { email: 'invasor@exemplo.com', role: 'ADMIN' }],
      ['PUT', `${base}/team/members/${w.people.admin?.id}/roles`, { roles: ['OWNER'] }],
      ['DELETE', `${base}/team/members/${w.people.admin?.id}`, undefined],
      ['DELETE', `${base}/courts/${a.court1}`, undefined],
      ['POST', `${base}/class-sessions/${a.sessionId}/cancel`, { reason: 'x' }],
      [
        'PUT',
        `${base}/class-sessions/${a.sessionId}/presence`,
        { userId: w.people.dani?.id, status: 'ABSENT' },
      ],
      ['POST', `${base}/subscription-charges/${w.spaces.a.chargeId}/waive`, { reason: 'x' }],
    ];
    await expectNoWrites(async () => {
      for (const [method, path, json] of attempts) {
        await tick();
        const res = await api(path, conn.token, {
          method,
          ...(json !== undefined ? { json } : {}),
        });
        expect([res.status, res.body?.error?.code], `${method} ${path}`).toEqual([
          403,
          'OAUTH_ROUTE_NOT_ALLOWED',
        ]);
      }
    });
    // O espaço segue como estava.
    const control = await api(base, conn.token);
    expect(control.body.name ?? control.body.space?.name).toBe(a.name);
  });
});

describe('(2) varredura com o token do Super', () => {
  it('só as 13 rotas do Super respondem; as outras 300 são 403 OAUTH_ROUTE_NOT_ALLOWED; o banco não muda', async () => {
    const conn = await superConn();
    const result = await expectNoWrites(() => sweep(conn.token, inAdminResource));
    expect(result.failures).toEqual([]);
    expect(result.answered).toHaveLength(13);
    expect(result.notAllowed.length).toBe(OPS.length - 13);
  });

  it('as 13 rotas do Super respondem 200 com ids reais', async () => {
    const conn = await superConn();
    const params = realParams();
    const failures: string[] = [];
    for (const op of OPS.filter(inAdminResource)) {
      await tick();
      const res = await api(fill(op.path, params) + controlQuery(op), conn.token);
      if (res.status !== 200)
        failures.push(`${id(op)} → ${res.status} ${res.body?.error?.code ?? ''}`);
    }
    expect(failures).toEqual([]);
  });

  it('escritas realistas do Super (suporte, administradores, exclusão de conta, simulador): 403 e nada gravado', async () => {
    const conn = await superConn();
    const a = w.spaces.a;
    const attempts: [string, string, unknown][] = [
      ['POST', `/v1/super/spaces/${a.id}/support-sessions`, { reason: 'teste' }],
      ['POST', '/v1/super/admins', { email: w.people.semPapel?.email }],
      ['POST', `/v1/super/users/${w.people.dona?.id}/block`, {}],
      ['POST', `/v1/super/users/${w.people.dona?.id}/deletion-requests`, {}],
      ['PATCH', `/v1/super/spaces/${a.id}`, { name: 'Invadida' }],
      ['POST', `/v1/super/spaces/${a.id}/suspend`, {}],
      ['POST', `/v1/super/spaces/${a.id}/owner-invites`, { email: 'invasor@exemplo.com' }],
      ['PUT', '/v1/super/online-payments/fees', { feeBps: 1 }],
      ['POST', '/v1/super/online-payments/simulator/settle', {}],
      ['POST', `/v1/super/reviews/${PLACEHOLDER}/hide`, { reason: 'x' }],
      ['DELETE', `/v1/super/contacts/${PLACEHOLDER}`, undefined],
    ];
    await expectNoWrites(async () => {
      for (const [method, path, json] of attempts) {
        await tick();
        const res = await api(path, conn.token, {
          method,
          ...(json !== undefined ? { json } : {}),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.body?.error?.code, `${method} ${path}`).toBe('OAUTH_ROUTE_NOT_ALLOWED');
      }
    });
    const [after] = await Promise.all([snapshot()]);
    expect(after.users).toBeTruthy();
  });

  it('o Super também não abre a sessão do app: cookie/token do app não vira token do MCP e vice-versa', async () => {
    const conn = await superConn();
    await resetLimits();
    // O token do MCP no endpoint de sessão do app: recusado.
    const session = await fetch(
      `${new URL(MCP_ADMIN_URL).origin.replace('43332', '43331')}/v1/auth/get-session`,
      {
        headers: { authorization: `Bearer ${conn.token}` },
      },
    );
    expect(session.status).toBeGreaterThanOrEqual(400);
    const me = await api('/v1/me', conn.token);
    expect([me.status, me.body?.error?.code]).toEqual([403, 'OAUTH_ROUTE_NOT_ALLOWED']);
    expect(USERS.superUser).toBeTruthy();
  });
});

describe('(2) tentativas de contornar a lista: modo suporte, outros métodos e caminhos disfarçados', () => {
  const a = w.spaces.a;
  const manageBase = `/v1/manage/spaces/${a.id}`;

  /** Pedido cru (o `fetch` não normaliza o caminho com `..`/`//`, ao contrário do `URL`). */
  const raw = async (
    token: string,
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ) => {
    await tick();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
    const text = await res.text();
    let body: { error?: { code?: string } } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // HEAD/OPTIONS sem corpo
    }
    return { status: res.status, code: body.error?.code, text };
  };

  it('X-Support-Session nunca vale pelo MCP: nem na gestão do espaço, nem no Super', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const session = { 'x-support-session': PLACEHOLDER };
    const manage = await raw(owner.token, 'GET', `${manageBase}/courts`, session);
    expect([manage.status, manage.code]).toEqual([403, 'OAUTH_ROUTE_NOT_ALLOWED']);
    const other = await raw(
      owner.token,
      'GET',
      `/v1/manage/spaces/${w.spaces.b.id}/courts`,
      session,
    );
    expect([other.status, other.code]).not.toEqual([200, undefined]);
    expect(other.text).not.toContain('Quadra B1');
    const admin = await raw(root.token, 'GET', '/v1/super/spaces?pageSize=1', session);
    expect(admin.status === 200 || admin.status === 403).toBe(true);
    // Um cabeçalho de suporte NUNCA troca o espaço visto pelo token do MCP.
    expect(admin.text).not.toMatch(/"actingAsSuper":true/);
  });

  it('HEAD, OPTIONS, PATCH e sobrescrita de método não abrem rota fora da lista nem escrevem', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const failures: string[] = [];
    await expectNoWrites(async () => {
      for (const token of [owner.token, root.token]) {
        for (const method of ['HEAD', 'OPTIONS', 'PATCH']) {
          for (const path of [
            `${manageBase}/contacts`,
            `${manageBase}/settings`,
            '/v1/me',
            '/v1/super/admins',
          ]) {
            const res = await raw(token, method, path);
            if (res.status === 200 && res.text.length > 0)
              failures.push(`${method} ${path} → 200 com corpo`);
            if (res.status >= 500) failures.push(`${method} ${path} → ${res.status}`);
          }
        }
        for (const header of ['x-http-method-override', 'x-method-override']) {
          const res = await raw(token, 'GET', `${manageBase}/courts`, { [header]: 'DELETE' });
          if (res.status >= 500) failures.push(`${header} → ${res.status}`);
        }
        const viaQuery = await raw(token, 'GET', `${manageBase}/courts?_method=DELETE`);
        if (viaQuery.status >= 500) failures.push(`_method → ${viaQuery.status}`);
      }
    });
    expect(failures).toEqual([]);
    // As quadras seguem lá.
    const control = await api(`${manageBase}/courts`, owner.token);
    expect(control.body.items?.length ?? control.body.length).toBe(2);
  });

  it('variações de caminho de rotas FORA da lista (contatos, configurações, CSV) nunca devolvem os dados', async () => {
    const owner = await userConn('dona');
    const root = await superConn();
    const manageVariants = [
      `${manageBase}/contacts`,
      `${manageBase}/contacts/`,
      `${manageBase}//contacts`,
      `${manageBase}/%63ontacts`,
      `${manageBase}/courts/..%2fcontacts`,
      `${manageBase}/courts/../contacts`,
      `${manageBase}/CONTACTS`,
      `${manageBase}/contacts;x=1`,
      `${manageBase}/contacts?x=1#frag`,
      `${manageBase}/contacts/export.csv`,
      `${manageBase}/statement.csv?from=${w.windows.from}T00:00:00.000Z&to=${w.windows.to}T23:00:00.000Z`,
      `${manageBase}/settings`,
      `${manageBase}/online-payments/settings`,
      `${manageBase}/online-payments/merchant-account`,
      `${manageBase}/online-payments/wallet/payouts`,
      `${manageBase}/recurring-bookings`,
      `${manageBase}/subscriptions`,
      `${manageBase}/teachers`,
      `/v1//manage/spaces/${a.id}/contacts`,
      `/v1/manage/spaces/${a.id}/team/invites`,
    ];
    const superVariants = [
      '/v1/super/contacts',
      '/v1/super//contacts',
      '/v1/super/%63ontacts',
      '/v1/super/spaces/../contacts',
      '/v1/super/admins',
      '/v1/super/deletion-requests',
      '/v1/super/finance/payments.csv',
      '/v1/super/online-payments/revenue.csv',
      '/v1/super/online-payments/fees',
      '/v1/super/online-payments/merchant-accounts',
      `/v1/super/spaces/${a.id}/settings`,
      '/v1/super/catalog/sports',
      '/v1/super/ads/advertisers',
    ];
    const failures: string[] = [];
    for (const [token, variants] of [
      [owner.token, manageVariants],
      [root.token, superVariants],
    ] as const) {
      for (const path of variants) {
        const res = await raw(token, 'GET', path);
        const leaked = findLeak(res.text);
        if (res.status === 200 || res.status >= 500 || leaked) {
          failures.push(`${path} → ${res.status} ${res.code ?? ''} ${leaked}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

const API_BASE = `http://127.0.0.1:${PORTS.api}`;

/** Sinais de que uma rota de contato/configuração respondeu de verdade. */
function findLeak(text: string): string {
  return /\+55\d{10,11}|@exemplo\.com|"phone"|"document"|"iban"|"accountNumber"|inviteToken/.test(
    text,
  )
    ? 'vazou contato'
    : '';
}

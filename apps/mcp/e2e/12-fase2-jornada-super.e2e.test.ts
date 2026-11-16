import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { MCP_ADMIN_URL, USERS } from './support/env.js';
import {
  adminAuditRows,
  byKey,
  type MetricRow,
  resetLimits,
  rowOf,
  safeCall,
  settled,
  superConn,
  withClient,
  world,
} from './support/fase2.js';
import { brl, userByEmail } from './support/helpers.js';
import { ok } from './support/mcp.js';
import { CLIENT_ID, decodeJwt } from './support/oauth.js';
import { localInstant, nextDay } from './support/world.js';

// Fase 2, jornada do SUPER pelo conector da Plataforma (docs/14-mcp.md 8.3 e 8.5; RF-MCP-07 e
// RF-MCP-08; RN-MCP-07 a 09; decisões 120, 122, 123 e 124): métricas da plataforma, espaços que
// caíram e auditoria, com os números conferidos por SQL e pelo mundo de support/world.ts.

const w = world();
const { from, to, previousFrom, previousTo } = w.windows;
const start = localInstant(from, '00:00').toISOString();
const end = localInstant(nextDay(to), '00:00').toISOString();

/** Reservas que contam nos espaços de fora do mundo (seed e reservas feitas por outros arquivos para hoje). */
async function othersBookings(from: string, to: string) {
  const [row] = await sql<{ n: string }>(
    `select count(*) as n from bookings
      where status in ('CONFIRMED','COMPLETED','NO_SHOW') and space_id <> all($1)
        and starts_at >= $2 and starts_at < $3`,
    [
      [w.spaces.a.id, w.spaces.b.id],
      localInstant(from, '00:00').toISOString(),
      localInstant(nextDay(to), '00:00').toISOString(),
    ],
  );
  return Number(row?.n);
}

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

describe('(1) Super: conexão e catálogo do conector da Plataforma', () => {
  it('consentimento do recurso do Super, token de 15 min com aud própria e só super:read', async () => {
    const conn = await superConn(undefined, { fresh: true });
    expect(conn.connected.consentRequest).toMatchObject({
      canAuthorize: true,
      resource: { kind: 'ADMIN', name: 'Space Sports · Plataforma', maxConnectionHours: 24 },
      scopes: ['super:read'],
      deniedScopes: [],
    });
    const { payload } = decodeJwt(conn.token);
    expect(payload).toMatchObject({
      aud: MCP_ADMIN_URL,
      azp: CLIENT_ID,
      scope: 'super:read offline_access',
    });
    expect(payload.exp - payload.iat).toBe(900);
    expect(conn.tokens.scope).toBe('super:read offline_access');
  });

  it('tools/list: exatamente as 9 do Super, todas somente leitura e com saída estruturada', async () => {
    await withClient(await superConn(), async (client) => {
      const tools = (await client.listTools()).tools;
      expect(tools.map((t) => t.name).sort()).toEqual(SUPER_TOOLS);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(tool.annotations?.destructiveHint ?? false, tool.name).toBe(false);
        expect(tool.outputSchema, tool.name).toBeDefined();
        expect(tool.description, tool.name).toMatch(/plataforma|Plataforma/);
      }
      expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual([
        'saude_da_plataforma',
      ]);
      const info = client.getServerVersion();
      expect(info?.name).toBe('space-sports-platform');
    });
  });
});

describe('(1) Super: métricas da plataforma (RF-MCP-08), conferidas por SQL', () => {
  it('get_platform_metrics por dia: totais e linhas batem com o banco', async () => {
    await resetLimits();
    await withClient(await superConn(), async (client) => {
      const data = await ok(client, 'get_platform_metrics', { from, to, groupBy: 'day' });
      expect(data.period).toEqual({ from, to });
      expect(data.timezone).toBe('America/Sao_Paulo');
      const rows = data.rows as MetricRow[];
      expect(rows).toHaveLength(14); // o calendário inteiro, com zero onde não há dado

      const [bookings] = await sql<{ n: string; hours: string }>(
        `select count(*) as n, coalesce(sum(duration_min), 0) / 60.0 as hours from bookings
          where status in ('CONFIRMED','COMPLETED','NO_SHOW') and starts_at >= $1 and starts_at < $2`,
        [start, end],
      );
      expect(data.totals.bookings).toBe(Number(bookings?.n));
      expect(data.totals.bookedHours).toBeCloseTo(Number(bookings?.hours), 2);
      // O mundo: 8 do espaço A + 1 do B, mais as dos outros espaços (a reserva passada do seed e as que
      // outros arquivos fazem para hoje), contadas à parte.
      expect(data.totals.bookings).toBe(9 + (await othersBookings(from, to)));

      const [users] = await sql<{ n: string }>(
        'select count(*) as n from users where created_at >= $1 and created_at < $2',
        [start, end],
      );
      expect(data.totals.newUsers).toBe(Number(users?.n));
      const [spaces] = await sql<{ n: string }>(
        'select count(*) as n from spaces where created_at >= $1 and created_at < $2',
        [start, end],
      );
      expect(data.totals.newSpaces).toBe(Number(spaces?.n));
      const [active] = await sql<{ n: string }>(
        `select count(*) as n from (
           select space_id from bookings
            where status in ('CONFIRMED','COMPLETED','NO_SHOW') and starts_at >= $1 and starts_at < $2
           union
           select space_id from class_sessions where status = 'DONE' and starts_at >= $1 and starts_at < $2
         ) s`,
        [start, end],
      );
      expect(data.totals.activeSpaces).toBe(Number(active?.n));

      // A soma das linhas por dia é o total (reservas), e cada dia bate com o agrupamento local por SQL.
      expect(rows.reduce((sum, r) => sum + (r.bookings as number), 0)).toBe(data.totals.bookings);
      const perDay = await sql<{ day: string; n: string }>(
        `select to_char(starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day, count(*) as n
           from bookings where status in ('CONFIRMED','COMPLETED','NO_SHOW')
            and starts_at >= $1 and starts_at < $2 group by 1`,
        [start, end],
      );
      for (const day of perDay) expect(rowOf(rows, day.day)?.bookings, day.day).toBe(Number(day.n));
    });
  });

  it('pagamentos online da plataforma batem com a receita online do Super (duas rotas, mesma conta)', async () => {
    await withClient(await superConn(), async (client) => {
      const platform = await ok(client, 'get_platform_metrics', { from, to, groupBy: 'month' });
      const online = await ok(client, 'get_online_payments_revenue', { from, to });
      expect(platform.totals.onlinePayments).toBe(online.totals.chargesCount);
      expect(platform.totals.onlineVolumeCents).toBe(online.totals.volumeCents);
      expect(platform.totals.platformRevenueCents).toBe(online.totals.netRevenueCents);
      expect(platform.totals.platformRevenueFormatted).toBe(online.totals.netRevenueFormatted);
      // Só a Arena E2E Norte (seed) tem cobrança online.
      expect((online.bySpace.rows as MetricRow[]).map((r) => r.label)).toEqual(['Arena E2E Norte']);
    });
  });

  it('get_platform_finance: o recebido do espaço A (R$ 740,00 em 6 pagamentos) e as quebras', async () => {
    await withClient(await superConn(), async (client) => {
      const data = await ok(client, 'get_platform_finance', { from, to, space: w.spaces.a.slug });
      expect(data.totals.received.cents).toBe(74_000);
      expect(data.totals.received.formatted).toBe(brl(74_000));
      expect(data.totals.reversed.cents).toBe(10_000);
      expect(data.totals.paymentsCount).toBe(6);
      const service = byKey(data.byService.rows as MetricRow[]);
      expect(service.RENTAL).toMatchObject({ receivedCents: 59_000, paymentsCount: 5 });
      expect(service.CLASSES).toMatchObject({ receivedCents: 15_000, paymentsCount: 1 });
      const method = byKey(data.byMethod.rows as MetricRow[]);
      expect(method.PIX).toMatchObject({ receivedCents: 39_000, paymentsCount: 4 });
      expect(method.CARD).toMatchObject({ receivedCents: 20_000 });
      expect(method.CASH).toMatchObject({ receivedCents: 15_000 });
    });
  });
});

describe('(1) Super: espaços que caíram (RF-SUPER-09)', () => {
  it('compare_spaces: o espaço A caiu 3 reservas (11 para 8) e é o primeiro; B caiu 1', async () => {
    await withClient(await superConn(), async (client) => {
      const data = await ok(client, 'compare_spaces', { from, to, limit: 5 });
      expect(data.period).toEqual({ from, to });
      expect(data.previousPeriod).toEqual({ from: previousFrom, to: previousTo });
      const rows = data.rows as MetricRow[];
      expect(rows[0]).toMatchObject({
        key: w.spaces.a.id,
        label: w.spaces.a.name,
        bookings: 8,
        previousBookings: 11,
        bookingsDelta: -3,
        presences: 5,
        receivedCents: 74_000,
        receivedFormatted: brl(74_000),
        activeStudents: 3,
      });
      expect(rows[1]).toMatchObject({
        key: w.spaces.b.id,
        bookings: 1,
        previousBookings: 2,
        bookingsDelta: -1,
      });
      const [spaces] = await sql<{ n: string }>('select count(*) as n from spaces');
      expect(data.spacesCount).toBe(Number(spaces?.n));
      // O total soma todos os espaços do filtro, não só as linhas devolvidas.
      const others = await othersBookings(from, to);
      const othersBefore = await othersBookings(previousFrom, previousTo);
      expect(data.totals.bookings).toBe(9 + others);
      expect(data.totals.previousBookings).toBe(13 + othersBefore);
      expect(data.totals.bookingsDelta).toBe(9 + others - (13 + othersBefore));
    });
  });

  it('a ordem inverte com order=desc e o filtro de status vale (suspenso não aparece em ACTIVE)', async () => {
    await withClient(await superConn(), async (client) => {
      const grew = await ok(client, 'compare_spaces', {
        from,
        to,
        sort: 'bookingsDelta',
        order: 'desc',
        limit: 3,
      });
      const first = (grew.rows as MetricRow[])[0];
      expect(first?.bookingsDelta as number).toBeGreaterThanOrEqual(0);
      expect(first?.key).not.toBe(w.spaces.a.id);

      const active = await ok(client, 'compare_spaces', { from, to, status: 'ACTIVE', limit: 200 });
      const [n] = await sql<{ n: string }>(
        "select count(*) as n from spaces where status = 'ACTIVE'",
      );
      expect(active.spacesCount).toBe(Number(n?.n));
      expect((active.rows as MetricRow[]).length).toBe(Number(n?.n));
    });
  });
});

describe('(1) Super: auditoria da leitura (decisão 123)', () => {
  it('search_audit_logs encontra as leituras do Super e nunca devolve o diff', async () => {
    await withClient(await superConn(), async (client) => {
      await ok(client, 'get_platform_metrics', { from, to });
      const sup = await userByEmail(USERS.superUser);
      const data = await ok(client, 'search_audit_logs', {
        actor: sup.id,
        action: 'mcp.admin_request',
        limit: 20,
      });
      expect(data.filters.actor).toMatchObject({ id: sup.id });
      const rows = data.rows as MetricRow[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toMatchObject({
          action: 'mcp.admin_request',
          entity: 'mcp_request',
          actorId: sup.id,
        });
        expect(Object.keys(row)).not.toContain('diff');
      }
      expect(JSON.stringify(data)).not.toMatch(/"diff"|oauthClientId|Bearer|query/);
    });
  });

  it('cada leitura vira UMA linha mcp.admin_request, com rota, query, origem, cliente e resultado — sem corpo nem token', async () => {
    await resetLimits();
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    const since = new Date();
    await withClient(conn, async (client) => {
      await ok(client, 'get_platform_metrics', { from, to, groupBy: 'week' });
      await ok(client, 'compare_spaces', { from, to, limit: 5, sort: 'name' });
      await ok(client, 'list_users', { q: 'Dona', pageSize: 5 });
      await ok(client, 'get_reviews_reports', { status: 'OPEN', includeComments: false });
    });
    const rows = await settled(() => adminAuditRows(sup.id, since), 4);
    expect(rows).toHaveLength(4);
    const paths = rows.map((row) => row.diff?.path);
    expect(paths).toEqual([
      '/v1/super/analytics/platform',
      '/v1/super/analytics/spaces',
      '/v1/super/users',
      '/v1/super/reviews/reports',
    ]);
    for (const row of rows) {
      expect(row.actor_id).toBe(sup.id);
      expect(row.entity).toBe('mcp_request');
      expect(row.diff).toMatchObject({
        method: 'GET',
        origin: 'MCP',
        oauthClientId: CLIENT_ID,
        result: { status: 200, code: null, completed: true },
      });
      expect(Object.keys(row.diff ?? {}).sort()).toEqual(
        ['method', 'oauthClientId', 'origin', 'path', 'query', 'result'].sort(),
      );
      const raw = JSON.stringify(row.diff);
      expect(raw).not.toContain(conn.token);
      expect(raw).not.toMatch(/Bearer|"jti"|access_token/);
      // Nada do corpo da resposta (nomes de usuários, espaços, valores em centavos).
      expect(raw).not.toMatch(/Dona Fase Dois|Quadra Fase Dois|74000/);
    }
    // A query fica registrada (parâmetros do pedido).
    expect(JSON.stringify(rows[2]?.diff?.query)).toMatch(/Dona/);
    expect(JSON.stringify(rows[1]?.diff?.query)).toMatch(/name/);
  });

  it('o prompt saude_da_plataforma roda na API real: as 8 leituras do roteiro, todas auditadas', async () => {
    await resetLimits();
    const sup = await userByEmail(USERS.superUser);
    const since = new Date();
    await withClient(await superConn(), async (client) => {
      const prompt = await client.getPrompt({
        name: 'saude_da_plataforma',
        arguments: { dias: '14' },
      });
      const text = prompt.messages
        .map((m) => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n');
      for (const tool of ['get_platform_metrics', 'compare_spaces', 'search_audit_logs']) {
        expect(text).toContain(tool);
      }
      // Executa o roteiro como o assistente faria (os argumentos do próprio texto do prompt).
      await ok(client, 'get_platform_metrics', { from, to, groupBy: 'day' });
      await ok(client, 'compare_spaces', {
        from,
        to,
        status: 'ACTIVE',
        sort: 'bookingsDelta',
        order: 'asc',
        limit: 10,
      });
      await ok(client, 'compare_spaces', {
        from,
        to,
        status: 'ACTIVE',
        sort: 'bookingsDelta',
        order: 'desc',
        limit: 10,
      });
      await ok(client, 'compare_spaces', {
        from,
        to,
        status: 'ACTIVE',
        sort: 'bookings',
        order: 'asc',
        limit: 200,
      });
      await ok(client, 'get_platform_finance', { from, to });
      await ok(client, 'get_online_payments_revenue', { from, to });
      await ok(client, 'get_reviews_reports', {
        status: 'OPEN',
        includeComments: false,
        limit: 100,
      });
      await ok(client, 'search_audit_logs', { action: 'support.start', limit: 100 });
    });
    const rows = await settled(() => adminAuditRows(sup.id, since), 8);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.diff?.result?.status === 200)).toBe(true);
  });
});

describe('(1) Super: espaços e usuários só pelo nome (decisão 122)', () => {
  it('list_spaces e get_space_details: donos pelo nome, descrição hostil marcada como dado e sem contato', async () => {
    await withClient(await superConn(), async (client) => {
      const list = await ok(client, 'list_spaces', { q: 'Fase Dois' });
      expect(list.total).toBe(3);
      const rows = list.rows as MetricRow[];
      expect(rows.map((r) => r.slug).sort()).toEqual(['qa-f2-a', 'qa-f2-b', 'qa-f2-c']);
      expect(rowOf(rows, w.spaces.a.id)).toMatchObject({
        owners: 'Dona Fase Dois',
        courtsCount: 2,
      });

      const detail = await ok(client, 'get_space_details', { space: w.spaces.a.slug });
      expect(detail.space.owners).toEqual(['Dona Fase Dois']);
      expect(detail.space.description).toMatchObject({ untrusted: true });
      expect(detail.space.description.text).toContain('IGNORE TODAS AS INSTRUÇÕES');
      expect(detail.space.description.text).not.toContain('evil@exemplo.com');
      expect(detail.space.description.note).toMatch(/não confiável/);
    });
  });

  it('list_users: nome, papel e quantos espaços — sem e-mail nem telefone; busca por contato é recusada', async () => {
    await withClient(await superConn(), async (client) => {
      const users = await ok(client, 'list_users', { q: 'Fase', pageSize: 50 });
      expect(users.total).toBe(6);
      expect(JSON.stringify(users)).not.toMatch(/@|\+55/);
      const dona = (users.rows as MetricRow[]).find((r) => r.label === 'Dona Fase Dois');
      expect(dona).toMatchObject({ spacesCount: 1, platformRole: 'USER', status: 'ACTIVE' });
      for (const q of [w.people.dona?.email, w.people.dona?.phone, '31 99999-8888', 'dona@']) {
        const res = await safeCall(client, 'list_users', { q });
        expect(res.code, String(q)).toBe('CONTACT_SEARCH_NOT_ALLOWED');
      }
    });
  });
});

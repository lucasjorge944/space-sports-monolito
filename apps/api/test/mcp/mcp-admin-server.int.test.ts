import type { AddressInfo } from 'node:net';
import { addDays, formatCents, MCP_RESOURCE_SCOPES, utcToZoned } from '@space-sports/shared';
import { and, eq, gte } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, spaceMembers, spaceReviewReports } from '../../src/db/schema/index.js';
import { TZ } from '../analytics/fixtures.js';
import { makeSuper, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, type Space, slotIn } from '../bookings/fixtures.js';
import { insertReviewRow } from '../reviews/qa-fixtures.js';
import {
  ADMIN_RESOURCE,
  CLIENT_ID,
  connect,
  createMcpTestApp,
  ISSUER,
  MCP_RESOURCE,
} from './helpers.js';
import { type McpClient, type McpServerHandle, startMcpServer } from './real-mcp.js';

// Integração apps/mcp ↔ API no conector do Super (MCP2.4; docs/14-mcp.md 8.3 e 8.5; RF-MCP-07;
// decisões 120, 122 e 123): o token sai do fluxo OAuth no recurso do Super (`super:read`), o
// apps/mcp real o valida pelo JWKS na superfície `admin` e chama as rotas `/v1/super` com ele. O
// Super faz a jornada métricas → comparar espaços → auditoria, e cada leitura aparece no
// `audit_logs` (decisão 123). Token de um recurso não vale na superfície do outro.

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
const GUEST_PHONE = '+5531977776666';
/** Contato escrito à mão num comentário sem denúncia de dado pessoal: a API manda, o MCP tira. */
const REVIEW_PHONE = '31 9 8888-7777';
const REPORT_EMAIL = 'quem.denunciou@exemplo.com';
const PEOPLE = {
  sup: { email: 'super.mcp.real@exemplo.com', name: 'Super Real', phone: '+5531922221111' },
  dona: { email: 'dona.plataforma@exemplo.com', name: 'Dona Plataforma', phone: '+5531922223333' },
  jogador: {
    email: 'jogador.plat@exemplo.com',
    name: 'Jogador Plataforma',
    phone: '+5531922224444',
  },
};
const CONTACTS = [
  GUEST_PHONE,
  REVIEW_PHONE,
  REPORT_EMAIL,
  ...Object.values(PEOPLE).flatMap((person) => [person.email, person.phone]),
];

describe('apps/mcp com a API real: conector do Super (plataforma em leitura)', () => {
  let t: TestApp;
  let apiUrl: string;
  let admin: McpServerHandle;
  let player: McpServerHandle;
  let space: Space;
  let sup: SignedUp;
  let dona: SignedUp;
  let supClient: McpClient;
  let superToken: string;
  const today = utcToZoned(new Date(), TZ).date;
  const outputs: string[] = [];
  const startedAt = new Date();

  /** Chama a tool e guarda tudo o que sai (para a varredura de contato). */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await admin.call(supClient, name, args);
    outputs.push(result.text, JSON.stringify(result.data));
    return result;
  };

  beforeAll(async () => {
    t = await createMcpTestApp({
      env: { MCP_ADMIN_RESOURCE_URL: ADMIN_RESOURCE, MCP_ADMIN_ALLOWED_CLIENT_IDS: CLIENT_ID },
    });
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    apiUrl = `http://127.0.0.1:${port}`;
    space = await createSpace(t.db, 'arena-plataforma-mcp-real');
    sup = await signUp(t, PEOPLE.sup.email, PEOPLE.sup.name, PEOPLE.sup.phone);
    await makeSuper(t.db, sup.id);
    dona = await signUp(t, PEOPLE.dona.email, PEOPLE.dona.name, PEOPLE.dona.phone);
    const jogador = await signUp(
      t,
      PEOPLE.jogador.email,
      PEOPLE.jogador.name,
      PEOPLE.jogador.phone,
    );
    await t.db
      .insert(spaceMembers)
      .values({ userId: dona.id, spaceId: space.id, role: 'OWNER', status: 'ACTIVE' });

    // Movimento: reserva de balcão (com telefone) amanhã, com R$ 50,00 pagos hoje em dinheiro.
    const desk = await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/bookings`)
      .set(...bearer(dona))
      .send({
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(26 * 60).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        guestName: 'Cliente do Balcão',
        guestPhone: GUEST_PHONE,
      })
      .expect(201);
    await t
      .http()
      .post(`/v1/manage/spaces/${space.id}/payments`)
      .set(...bearer(dona))
      .send({ payableType: 'BOOKING', payableId: desk.body.id, amountCents: 5_000, method: 'CASH' })
      .expect(201);

    // Avaliação com telefone no texto e uma denúncia (com e-mail nos detalhes, que a API não manda).
    const review = await insertReviewRow(t.db, space.id, {
      userId: jogador.id,
      rating: 2,
      comment: `Atendimento ruim, liguei no ${REVIEW_PHONE} e ninguém atendeu.`,
    });
    await t.db.insert(spaceReviewReports).values({
      reviewId: review.id,
      reporterUserId: dona.id,
      reporterSpaceId: space.id,
      reason: 'OFFENSIVE',
      details: `Escreva para ${REPORT_EMAIL}`,
    });

    admin = await startMcpServer({
      apiUrl,
      issuer: ISSUER,
      jwksUrl: `${apiUrl}/v1/auth/jwks`,
      resourceUrl: ADMIN_RESOURCE,
      surface: 'admin',
    });
    player = await startMcpServer({
      apiUrl,
      issuer: ISSUER,
      jwksUrl: `${apiUrl}/v1/auth/jwks`,
      resourceUrl: MCP_RESOURCE,
    });
    superToken = (await connect(t, sup, { resource: ADMIN_RESOURCE, scope: 'super:read' }))
      .access_token;
    supClient = await admin.connect(superToken);
  });

  afterAll(async () => {
    await admin?.stop();
    await player?.stop();
    await t?.close();
  });

  it('tools/list: só as 9 do Super e o prompt saude_da_plataforma', async () => {
    const tools = (await supClient.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual(SUPER_TOOLS);
    const prompts = (await supClient.listPrompts()).prompts.map((prompt) => prompt.name);
    expect(prompts).toEqual(['saude_da_plataforma']);
  });

  it('jornada do Super: métricas → comparar espaços → auditoria, e as leituras no audit_logs', async () => {
    const from = addDays(today, -29);
    const to = addDays(today, 1);

    const metrics = await call('get_platform_metrics', { from, to, groupBy: 'week' });
    expect(metrics.isError, metrics.text).toBe(false);
    expect(metrics.data.period).toEqual({ from, to });
    expect(metrics.data.totals.bookings).toBeGreaterThanOrEqual(1);
    expect(metrics.data.columns.map((column: { key: string }) => column.key)).toContain(
      'platformRevenueCents',
    );

    const compare = await call('compare_spaces', {
      from,
      to,
      sort: 'bookings',
      order: 'desc',
      limit: 200,
    });
    expect(compare.isError, compare.text).toBe(false);
    const row = compare.data.rows.find((item: { key: string }) => item.key === space.id);
    expect(row).toMatchObject({
      label: 'Espaço arena-plataforma-mcp-real',
      bookings: 1,
      receivedCents: 5_000,
      receivedFormatted: formatCents(5_000),
    });
    expect(compare.data.previousPeriod.to).toBe(addDays(from, -1));

    const audit = await call('search_audit_logs', {
      action: 'mcp.admin_request',
      actor: sup.id,
      from: today,
      to: today,
    });
    expect(audit.isError, audit.text).toBe(false);
    // As leituras anteriores do próprio Super pelo conector já estão na auditoria.
    expect(audit.data.rows.length).toBeGreaterThanOrEqual(2);
    for (const entry of audit.data.rows) {
      expect(entry).toMatchObject({
        action: 'mcp.admin_request',
        entity: 'mcp_request',
        actorId: sup.id,
        actorName: PEOPLE.sup.name,
      });
      expect(entry).not.toHaveProperty('diff');
    }

    // Cada leitura da jornada vira uma linha `mcp.admin_request` com a rota, a origem MCP, o
    // cliente e o resultado (gravado quando a resposta fecha).
    const expected = [
      '/v1/super/analytics/platform',
      '/v1/super/analytics/spaces',
      '/v1/super/audit-logs',
    ];
    const deadline = Date.now() + 3_000;
    let rows: { diff: Record<string, unknown> | null }[] = [];
    const done = () =>
      expected.every((path) =>
        rows.some(
          (item) =>
            item.diff?.path === path &&
            (item.diff?.result as { status?: number } | null)?.status === 200,
        ),
      );
    while (Date.now() < deadline) {
      rows = await t.db
        .select({ diff: auditLogs.diff })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'mcp.admin_request'),
            eq(auditLogs.actorId, sup.id),
            gte(auditLogs.createdAt, startedAt),
          ),
        );
      if (done()) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(done(), JSON.stringify(rows.slice(-6))).toBe(true);
    const platform = rows.find((item) => item.diff?.path === '/v1/super/analytics/platform');
    expect(platform?.diff).toEqual({
      method: 'GET',
      path: '/v1/super/analytics/platform',
      query: { from, to, groupBy: 'week' },
      origin: 'MCP',
      oauthClientId: CLIENT_ID,
      result: { status: 200, code: null, completed: true },
    });
    expect(JSON.stringify(rows)).not.toContain(superToken);
  });

  it('as demais tools com a API real: espaços, finanças, online, denúncias e usuários', async () => {
    const spaces = await call('list_spaces', { q: 'plataforma-mcp' });
    expect(spaces.isError, spaces.text).toBe(false);
    expect(spaces.data.rows).toEqual([
      expect.objectContaining({ key: space.id, owners: PEOPLE.dona.name, courtsCount: 2 }),
    ]);

    const details = await call('get_space_details', { space: 'arena-plataforma-mcp-real' });
    expect(details.isError, details.text).toBe(false);
    expect(details.data.space).toMatchObject({ id: space.id, owners: [PEOPLE.dona.name] });
    expect(details.data.openingHours.rows).toHaveLength(7);

    // Id de espaço que não existe como filtro: "não encontrado", nunca uma consulta com zeros.
    const missing = await call('get_platform_finance', {
      space: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.isError).toBe(true);
    expect(missing.data.error.code).toBe('SPACE_NOT_FOUND');

    const finance = await call('get_platform_finance', {
      from: today,
      to: today,
      space: space.id,
    });
    expect(finance.isError, finance.text).toBe(false);
    expect(finance.data.totals.received).toEqual({ cents: 5_000, formatted: formatCents(5_000) });
    expect(finance.data.byMethod.rows).toEqual([
      expect.objectContaining({ key: 'CASH', receivedCents: 5_000 }),
    ]);

    const revenue = await call('get_online_payments_revenue', {});
    expect(revenue.isError, revenue.text).toBe(false);
    expect(revenue.data.totals).toHaveProperty('netRevenueCents');

    const reports = await call('get_reviews_reports', { status: 'OPEN' });
    expect(reports.isError, reports.text).toBe(false);
    const report = reports.data.rows.find((item: { spaceId: string }) => item.spaceId === space.id);
    expect(
      reports.data.columns.find((column: { key: string }) => column.key === 'comment'),
    ).toMatchObject({ untrusted: true });
    expect(report).toMatchObject({
      reason: 'OFFENSIVE',
      reportedBySpace: true,
      rating: 2,
      comment: 'Atendimento ruim, liguei no [contato removido] e ninguém atendeu.',
    });

    const users = await call('list_users', { q: 'Plataforma' });
    expect(users.isError, users.text).toBe(false);
    expect(users.data.rows.map((item: { label: string }) => item.label).sort()).toEqual([
      PEOPLE.dona.name,
      PEOPLE.jogador.name,
    ]);

    // Busca por contato: recusada pelo apps/mcp (a API já procuraria só no nome).
    const byEmail = await call('list_users', { q: PEOPLE.dona.email });
    expect(byEmail.data.error.code).toBe('CONTACT_SEARCH_NOT_ALLOWED');
  });

  it('nenhuma saída tem contato (nem o escrito à mão nos textos)', () => {
    const all = outputs.join('\n');
    for (const contact of CONTACTS) expect(all, contact).not.toContain(contact);
    expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it('um token não serve na superfície do outro recurso', async () => {
    const playerToken = (await connect(t, dona, { scope: MCP_RESOURCE_SCOPES.USER.join(' ') }))
      .access_token;
    // Token do jogador (e da gestão) na superfície do Super: 401.
    await expect(admin.connect(playerToken)).rejects.toThrow();
    // Token do Super na superfície do jogador: 401.
    await expect(player.connect(superToken)).rejects.toThrow();
    // Cada um na sua: funciona.
    expect((await (await player.connect(playerToken)).listTools()).tools.length).toBe(27);
    expect(
      admin.logs.some((line) => line.event === 'auth_rejected' && line.surface === 'admin'),
    ).toBe(true);
    expect(admin.logs.find((line) => line.event === 'tool_call')).toMatchObject({
      surface: 'admin',
      sub: sup.id,
    });
  });
});

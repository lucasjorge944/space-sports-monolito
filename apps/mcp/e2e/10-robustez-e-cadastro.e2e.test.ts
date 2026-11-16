import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { API_URL, MCP_URL, USERS } from './support/env.js';
import { apiBookingBody, freshPlayerToken, pickSlot, spDate } from './support/helpers.js';
import { call, mcpClient, ok, rawMcp } from './support/mcp.js';
import { api, connect, OAuthError } from './support/oauth.js';

describe('robustez — entradas malformadas nunca viram erro 500 nem vazam detalhe interno', () => {
  it('JSON-RPC malformado, corpo enorme e métodos inválidos em /mcp', async () => {
    const user = await freshPlayerToken('robusto');
    const headers = { authorization: `Bearer ${user.token}` };
    const garbage = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{"jsonrpc": "2.0", "id": 1, "method": ',
    });
    expect(garbage.status).toBeLessThan(500);
    const huge = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_spaces', arguments: { text: 'x'.repeat(5_000_000) } },
      }),
    });
    expect([400, 413]).toContain(huge.status);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(MCP_URL, { method, headers });
      expect(res.status, method).toBeLessThan(500);
    }
    const unknown = await rawMcp(headers, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    });
    expect(unknown.status).toBeLessThan(500);
    expect(unknown.text).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  it('argumentos hostis nas tools: texto gigante, SQL, unicode e tipos errados → erro de validação, sem 5xx', async () => {
    const user = await freshPlayerToken('robusto2');
    const client = await mcpClient(user.token);
    try {
      // Texto livre válido: pode devolver "nenhum resultado", mas nunca erro interno nem vazamento.
      const benign: [string, Record<string, unknown>][] = [
        ['search_spaces', { text: "'; drop table spaces; --" }],
        ['search_spaces', { text: 'a'.repeat(10_000) }],
        ['search_spaces', { text: '💥\u202e' }],
        ['get_space', { space: '../../etc/passwd' }],
        ['get_space', { space: "x' OR '1'='1" }],
      ];
      // Entrada inválida: precisa virar erro de validação (isError), sem chamar a API.
      const invalid: [string, Record<string, unknown>][] = [
        ['search_spaces', { city: 123 }],
        ['search_spaces', { near: { lat: 999, lng: 999 } }],
        [
          'check_availability',
          { space: 'arena-e2e', date: '2026-02-30', sport: 'futevolei', durationMin: 60 },
        ],
        [
          'check_availability',
          { space: 'arena-e2e', date: 'amanhã', sport: 'futevolei', durationMin: 60 },
        ],
        ['get_booking', { bookingId: 'não-é-uuid' }],
        ['get_booking', { bookingId: '00000000-0000-4000-8000-000000000000' }],
        ['prepare_booking', {}],
        ['create_booking', {}],
        [
          'cancel_booking',
          { bookingId: '00000000-0000-4000-8000-000000000000', confirmationCode: 'x' },
        ],
        ['confirm_class_attendance', { sessionId: '00000000-0000-4000-8000-000000000000' }],
        ['cancel_class_attendance', { sessionId: 'abc' }],
        ['list_my_classes', { from: '2026-12-31', to: '2020-01-01' }],
        ['list_my_classes', { from: '2020-01-01', to: '2030-01-01' }],
      ];
      const run = async (name: string, args: Record<string, unknown>) =>
        call(client, name, args).catch((error: unknown) => ({
          isError: true,
          text: String(error),
          code: undefined as string | undefined,
        }));
      for (const [name, args] of [...benign, ...invalid]) {
        const res = await run(name, args);
        const label = `${name} ${JSON.stringify(args).slice(0, 60)}`;
        expect(res.text, label).not.toMatch(
          /ECONN|stack|node_modules|at \w+ \(|SELECT |pg_|drizzle/i,
        );
        expect(res.code, label).not.toBe('API_UNAVAILABLE');
      }
      for (const [name, args] of invalid) {
        expect(
          (await run(name, args)).isError,
          `${name} ${JSON.stringify(args).slice(0, 60)}`,
        ).toBe(true);
      }
    } finally {
      await client.close();
    }
  });
});

describe('BUG-MCP-3 — byte NUL (%00) em texto da busca derrubava a API com 500', () => {
  // Corrigido: o Postgres recusa o byte 0x00 em texto, e a API agora recusa NUL em caminho, query e
  // corpo com 400 VALIDATION_ERROR antes de qualquer rota (apps/api/src/common/nul-byte.middleware.ts).
  it('GET /v1/spaces?q=%00 deve responder 4xx (ou lista vazia), nunca 500', async () => {
    const res = await fetch(`${API_URL}/v1/spaces?q=a%00b`);
    expect(res.status).toBeLessThan(500);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /v1/spaces/a%00b (slug com NUL) deve responder 4xx, nunca 500', async () => {
    const res = await fetch(`${API_URL}/v1/spaces/a%00b`);
    expect(res.status).toBeLessThan(500);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('search_spaces com NUL no texto deve devolver erro de validação, não API_UNAVAILABLE', async () => {
    const user = await freshPlayerToken('nul');
    const client = await mcpClient(user.token);
    try {
      const res = await call(client, 'search_spaces', { text: 'are\u0000na' });
      expect(res.code).not.toBe('API_UNAVAILABLE');
      expect(res.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('espaço fora do ar e cadastro incompleto', () => {
  it('espaço SUSPENSO some da busca e não aceita reserva pelo MCP', async () => {
    const user = await freshPlayerToken('suspenso');
    const client = await mcpClient(user.token);
    const [space] = await sql<{ id: string; status: string }>(
      `select id, status from spaces where slug='arena-e2e-sul'`,
    );
    try {
      await sql(`update spaces set status='SUSPENDED' where id=$1`, [space?.id]);
      const found = await ok(client, 'search_spaces', { text: 'Arena E2E Sul' });
      expect(found.spaces.map((s: { slug: string }) => s.slug)).not.toContain('arena-e2e-sul');
      const detail = await call(client, 'get_space', { space: 'arena-e2e-sul' });
      expect(detail.isError).toBe(true);
      const prepared = await call(client, 'prepare_booking', {
        space: 'arena-e2e-sul',
        date: spDate(5),
        startTime: '10:00',
        durationMin: 60,
        peopleCount: 2,
        sport: 'futevolei',
      });
      expect(prepared.isError).toBe(true);
      expect(prepared.data.confirmation).toBeUndefined();
    } finally {
      await sql(`update spaces set status=$1 where id=$2`, [space?.status, space?.id]);
      await client.close();
    }
  });

  // BUG-MCP-2 (corrigido): a decisão 119 (cadastro completo antes de conectar) só valia no web.
  // Agora a API recusa o consentimento de conta incompleta (403 PROFILE_INCOMPLETE) e, com o token
  // do MCP, a reserva (422 PROFILE_INCOMPLETE), para quem montar o fluxo por fora do web.
  it('BUG-MCP-2: conta SEM telefone não consegue reservar com o token do MCP (decisão 119)', async () => {
    // 1. O consentimento é recusado na própria API (o teste faz o papel do /autorizar).
    const refused = await connect(USERS.semFone).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused, 'a API concluiu o consentimento de conta sem telefone').toBeInstanceOf(
      OAuthError,
    );
    expect((refused as OAuthError).status).toBe(403);
    expect((refused as OAuthError).body).toMatchObject({
      code: 'PROFILE_INCOMPLETE',
      details: { missing: ['phone'] },
    });

    // 2. Defesa em profundidade: conta que conectou completa e perdeu o telefone depois.
    const user = await freshPlayerToken('semfone-depois');
    const client = await mcpClient(user.token);
    try {
      const slot = await pickSlot(client, 'arena-e2e', 19);
      const prepared = await ok(client, 'prepare_booking', {
        space: 'arena-e2e',
        date: slot.date,
        startTime: slot.startTime,
        durationMin: 60,
        peopleCount: 2,
        sport: 'futevolei',
        court: slot.court,
        paymentOption: 'ON_SITE',
      });
      await sql(`update users set phone = null where id = $1`, [user.id]);

      const tool = await call(client, 'create_booking', prepared.confirmation.createBookingInput);
      expect(tool.isError).toBe(true);
      expect(tool.code).toBe('PROFILE_INCOMPLETE');
      expect(tool.text).toContain('completar o cadastro no app do Space Sports');

      const res = await api('/v1/bookings', user.token, {
        method: 'POST',
        json: apiBookingBody(prepared.confirmation.createBookingInput),
        headers: { 'Idempotency-Key': `qa-semfone-${Date.now()}` },
      });
      expect(res.status, 'a API aceitou reserva de organizador sem telefone').toBe(422);
      expect(res.body.error.code).toBe('PROFILE_INCOMPLETE');
      const [{ count } = { count: -1 }] = await sql<{ count: number }>(
        `select count(*)::int as count from bookings where organizer_user_id = $1`,
        [user.id],
      );
      expect(count).toBe(0);
    } finally {
      await sql(`update users set phone = $1 where id = $2`, [user.phone, user.id]);
      await client.close();
    }
  });
});

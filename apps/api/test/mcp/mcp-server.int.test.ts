import type { AddressInfo } from 'node:net';
import { utcToZoned } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookings } from '../../src/db/schema/index.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { createSpace } from '../bookings/fixtures.js';
import {
  CLIENT_ID,
  connect,
  createMcpTestApp,
  decodeJwt,
  ISSUER,
  MCP_RESOURCE,
} from './helpers.js';
import { type McpServerHandle, startMcpServer } from './real-mcp.js';

/**
 * Integração apps/mcp ↔ API (MCP.2 depois da MCP.1): a API real escuta numa porta, o token sai do
 * fluxo OAuth do plugin (CIMD + PKCE + consentimento) e o apps/mcp o valida pelo JWKS real e chama
 * a API com ele, como o Claude faria pelo conector.
 */
describe('apps/mcp com a API real', () => {
  let t: TestApp;
  let mcp: McpServerHandle;
  let user: SignedUp;
  let accessToken: string;

  beforeAll(async () => {
    t = await createMcpTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${port}`;
    await createSpace(t.db, 'arena-mcp-real');
    user = await signUp(t, 'jogadora-mcp@example.com', 'Bruna Teste');
    accessToken = (await connect(t, user)).access_token;
    mcp = await startMcpServer({
      apiUrl,
      issuer: ISSUER,
      jwksUrl: `${apiUrl}/v1/auth/jwks`,
      resourceUrl: MCP_RESOURCE,
    });
  });

  afterAll(async () => {
    await mcp?.stop();
    await t?.close();
  });

  it('o token do plugin (EdDSA, at+jwt, com offline_access) vale no apps/mcp: as 14 tools', async () => {
    const { header, payload } = decodeJwt(accessToken);
    expect(header).toMatchObject({ alg: 'EdDSA', typ: 'at+jwt' });
    expect(String(payload.scope)).toContain('offline_access');

    const client = await mcp.connect(accessToken);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(14);
  });

  it('a saudação usa GET /v1/me/summary (o GET /v1/me não aceita o token do MCP)', async () => {
    const client = await mcp.connect(accessToken);
    const { isError, data } = await mcp.call(client, 'get_my_profile');
    expect(isError).toBe(false);
    expect(data).toEqual({ firstName: 'Bruna', favoriteSports: [] });

    const me = await t.http().get('/v1/me').set('authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
  });

  it('jornada: buscar → horários → reservar (duas etapas) → minhas reservas → cancelar → aulas', async () => {
    const client = await mcp.connect(accessToken);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await mcp.call(client, name, args);
      expect(result.isError, `${name}: ${result.text}`).toBe(false);
      return result.data;
    };

    const found = await call('search_spaces', { text: 'arena-mcp-real' });
    expect(found.spaces.map((space: { slug: string }) => space.slug)).toEqual(['arena-mcp-real']);

    const date = utcToZoned(new Date(Date.now() + 24 * 60 * 60 * 1000), 'America/Sao_Paulo').date;
    const availability = await call('check_availability', {
      space: 'arena-mcp-real',
      date,
      sport: 'futevolei',
      durationMin: 60,
    });
    expect(availability.price).toEqual({ cents: 10_000, formatted: 'R$ 100,00' });
    const court = availability.courts[0];
    const startTime = court.freeStartTimes.includes('10:00') ? '10:00' : court.freeStartTimes[0];
    expect(startTime).toBeTypeOf('string');

    const prepared = await call('prepare_booking', {
      space: 'arena-mcp-real',
      date,
      startTime,
      durationMin: 60,
      peopleCount: 2,
      sport: 'futevolei',
      court: court.name,
    });
    const input = prepared.confirmation.createBookingInput;
    expect(input.paymentOption).toBe('ON_SITE');

    const created = await call('create_booking', input);
    expect(created.booking).toMatchObject({ status: 'CONFIRMED', date, startTime, peopleCount: 2 });
    const bookingId = created.booking.id as string;

    // A Idempotency-Key derivada do código devolve a mesma reserva.
    const again = await call('create_booking', input);
    expect(again.booking.id).toBe(bookingId);
    const [row] = await t.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.channel).toBe('MCP');
    expect(row?.organizerUserId).toBe(user.id);

    const mine = await call('list_my_bookings');
    expect(mine.bookings.map((booking: { id: string }) => booking.id)).toContain(bookingId);

    const cancel = await call('prepare_cancel_booking', { bookingId });
    const cancelled = await call('cancel_booking', cancel.confirmation.cancelBookingInput);
    expect(cancelled.booking.status).toBe('CANCELLED');

    const classes = await call('list_my_classes');
    expect(classes.classes).toEqual([]);

    const toolCalls = mcp.logs.filter((line) => line.event === 'tool_call');
    expect(toolCalls.length).toBeGreaterThan(5);
    for (const line of toolCalls) {
      expect(line).toMatchObject({ sub: user.id, clientId: CLIENT_ID, result: 'ok' });
    }
  });

  it('a sessão do app (token opaco) não vale no apps/mcp: 401', async () => {
    const res = await fetch(mcp.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });
});

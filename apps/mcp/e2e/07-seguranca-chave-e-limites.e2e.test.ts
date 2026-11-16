import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { API_OFF_URL, API_URL, MCP_OFF_URL, PORTS, USERS } from './support/env.js';
import { freshPlayerToken, pickSlot, signUpUser } from './support/helpers.js';
import { call, mcpClient, ok, rawMcp } from './support/mcp.js';
import { api, appSession, connect } from './support/oauth.js';
import { type Running, startApi, startMcp } from './support/processes.js';

describe('(2) segurança — chave de emergência MCP_ENABLED=false (RN-MCP-04)', () => {
  let apiOff: Running;
  let mcpOff: Running;
  let token: string;
  let appToken: string;

  beforeAll(async () => {
    // Token emitido com o MCP LIGADO; depois o interruptor é desligado em outra instância da API
    // (mesmo banco, mesmo emissor), como a chave de emergência faria no parâmetro do staging.
    token = (await freshPlayerToken('chave')).token;
    appToken = (await appSession(USERS.a)).token;
    apiOff = await startApi({
      port: PORTS.apiOff,
      env: { MCP_ENABLED: 'false', BETTER_AUTH_URL: API_URL },
    });
    mcpOff = await startMcp({
      port: PORTS.mcpOff,
      apiUrl: API_OFF_URL,
      env: { MCP_ENABLED: 'false' },
    });
  }, 120_000);

  afterAll(async () => {
    await apiOff?.stop();
    await mcpOff?.stop();
  });

  it('a API com MCP_ENABLED=false responde 503 MCP_DISABLED a QUALQUER Bearer com formato de JWT', async () => {
    for (const path of ['/v1/me/summary', '/v1/spaces', '/v1/bookings', '/v1/me']) {
      const res = await api(path, token, {}, API_OFF_URL);
      expect([res.status, res.body.error?.code], path).toEqual([503, 'MCP_DISABLED']);
    }
    // Até um JWT qualquer (assinatura inválida) recebe o 503 da chave, sem chegar à validação.
    const fake = `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.c2ln`;
    const res = await api('/v1/spaces', fake, {}, API_OFF_URL);
    expect([res.status, res.body.error?.code]).toEqual([503, 'MCP_DISABLED']);
  });

  it('o servidor de autorização sai do ar: authorize, token, jwks e metadata respondem 503 MCP_DISABLED', async () => {
    const issuer = `${API_OFF_URL}/v1/auth`;
    const targets: [string, string][] = [
      [
        'GET',
        `${issuer}/oauth2/authorize?response_type=code&client_id=x&redirect_uri=https://x/cb`,
      ],
      ['POST', `${issuer}/oauth2/token`],
      ['POST', `${issuer}/oauth2/register`],
      ['POST', `${issuer}/oauth2/revoke`],
      ['GET', `${issuer}/jwks`],
      ['GET', `${API_OFF_URL}/.well-known/oauth-authorization-server/v1/auth`],
    ];
    for (const [method, url] of targets) {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${url}`).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MCP_DISABLED');
    }
  });

  it('app e web NÃO são afetados: login, sessão normal, /v1/me e busca de espaços seguem funcionando', async () => {
    expect((await api('/v1/me', appToken, {}, API_OFF_URL)).status).toBe(200);
    expect((await api('/v1/spaces', appToken, {}, API_OFF_URL)).status).toBe(200);
    expect((await api('/v1/bookings', appToken, {}, API_OFF_URL)).status).toBe(200);
    const login = await fetch(`${API_OFF_URL}/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:43330' },
      body: JSON.stringify({ email: USERS.a, password: 'senha-e2e-1234' }),
    });
    expect(login.status).toBe(200);
    expect((await fetch(`${API_OFF_URL}/v1/health`)).status).toBe(200);
  });

  it('o apps/mcp com MCP_ENABLED=false responde 503 em /mcp (com ou sem token) e mantém /health', async () => {
    expect(
      (await rawMcp({ authorization: `Bearer ${token}` }, undefined, MCP_OFF_URL)).status,
    ).toBe(503);
    expect((await rawMcp({}, undefined, MCP_OFF_URL)).status).toBe(503);
    expect((await fetch(MCP_OFF_URL.replace('/mcp', '/health'))).status).toBe(200);
    // A instância ligada segue normal (a chave é por instância/ambiente).
    expect((await rawMcp({ authorization: `Bearer ${token}` })).status).toBe(200);
  });

  it('voltando a ligar (instância principal intocada), o mesmo token ainda vale: a chave não apaga nada', async () => {
    expect((await api('/v1/me/summary', token)).status).toBe(200);
  });
});

describe('(2) segurança — rate limit por usuário (RN-MCP-03)', () => {
  it('escritas: 10 por 10 min; a 11ª responde 429 com Retry-After; leituras, outro usuário e o app não são afetados', async () => {
    const victim = await freshPlayerToken('rl-w');
    const other = await freshPlayerToken('rl-w2');
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof api>> | undefined;
    for (let i = 0; i < 12; i++) {
      // Corpo inválido: 400 de validação — a escrita é contada ANTES do handler, recusada ou não.
      last = await api('/v1/bookings', victim.token, {
        method: 'POST',
        json: {},
        headers: { 'Idempotency-Key': `qa-rl-${i}` },
      });
      statuses.push(last.status);
    }
    expect(
      statuses.slice(0, 10).every((s) => s === 400),
      statuses.join(','),
    ).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(last?.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(last?.headers.get('retry-after'))).toBeLessThanOrEqual(600);

    // Leituras têm contador próprio; o outro usuário e a sessão do app do MESMO usuário seguem livres.
    expect((await api('/v1/spaces', victim.token)).status).toBe(200);
    const mine = await api('/v1/bookings', other.token, {
      method: 'POST',
      json: {},
      headers: { 'Idempotency-Key': 'qa-rl-other' },
    });
    expect(mine.status).toBe(400);
    const session = await appSession(victim.email);
    const viaApp = await api('/v1/bookings', session.token, {
      method: 'POST',
      json: {},
      headers: { 'Idempotency-Key': 'qa-rl-app' },
    });
    expect(viaApp.status).not.toBe(429);
  });

  it('pelas tools: depois de 10 escritas reais, create/cancel respondem com erro de limite e nada mais é gravado', async () => {
    const user = await freshPlayerToken('rl-tool');
    const client = await mcpClient(user.token);
    try {
      let writes = 0;
      let blocked: Awaited<ReturnType<typeof call>> | undefined;
      for (let day = 20; day < 40 && !blocked; day++) {
        const slot = await pickSlot(client, 'arena-e2e', day);
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
        const created = await call(
          client,
          'create_booking',
          prepared.confirmation.createBookingInput,
        );
        if (created.isError) {
          blocked = created;
          break;
        }
        writes++;
        const cancel = await ok(client, 'prepare_cancel_booking', {
          bookingId: created.data.booking.id,
        });
        const cancelled = await call(
          client,
          'cancel_booking',
          cancel.confirmation.cancelBookingInput,
        );
        if (cancelled.isError) {
          blocked = cancelled;
          break;
        }
        writes++;
      }
      expect(blocked, 'o limite de escritas nunca apareceu').toBeDefined();
      expect(writes).toBe(10);
      expect(blocked?.code).toMatch(/TOO_MANY|RATE|LIMIT/i);
      // O audit conta no máximo as 10 + a recusada (a recusa fica antes do handler).
      const [active] = await sql<{ count: string }>(
        `select count(*) from bookings where organizer_user_id=$1 and status <> 'CANCELLED'`,
        [user.id],
      );
      expect(Number(active?.count)).toBeLessThanOrEqual(1);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('leituras: 60 por minuto; a 61ª responde 429', async () => {
    const user = await freshPlayerToken('rl-r');
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof api>> | undefined;
    for (let i = 0; i < 62; i++) {
      last = await api('/v1/me/summary', user.token);
      statuses.push(last.status);
    }
    expect(
      statuses.slice(0, 60).every((s) => s === 200),
      statuses.join(','),
    ).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(last?.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(last?.headers.get('retry-after')).toBeTruthy();
  });

  it('o limite soma todos os clientes do mesmo usuário (não é por cliente)', async () => {
    const user = await signUpUser('rl-cli');
    const one = await connect(user.email);
    const two = await connect(user.email, { clientId: 'https://cimd.e2e.test/segundo.json' });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const token = i % 2 === 0 ? one.tokens.access_token : two.tokens.access_token;
      const res = await api('/v1/bookings', token, {
        method: 'POST',
        json: {},
        headers: { 'Idempotency-Key': `qa-soma-${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

import { randomUUID } from 'node:crypto';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_RATE_LIMITS } from '../../src/auth/oauth-access.service.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';
import { bearerOf, connect, createMcpTestApp, type TokenResponse } from './helpers.js';

/** Mesma imagem do docker-compose.yml. */
const REDIS_IMAGE = 'redis:7-alpine';

// RN-MCP-03: leituras 60/min e escritas 10 a cada 10 min por usuário, 429 com Retry-After.

describe('limites do token do MCP (Redis)', () => {
  let container: StartedTestContainer;
  let t: TestApp;
  let ana: SignedUp;
  let bob: SignedUp;
  let anaToken: TokenResponse;
  let bobToken: TokenResponse;

  beforeAll(async () => {
    container = await new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    t = await createMcpTestApp({
      env: {
        REDIS_URL: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
        MCP_RATE_LIMIT_ENABLED: 'true',
      },
    });
    ana = await signUp(t, 'ana.limite@exemplo.com', 'Ana');
    bob = await signUp(t, 'bob.limite@exemplo.com', 'Bob');
    anaToken = await connect(t, ana);
    bobToken = await connect(t, bob);
  });
  afterAll(async () => {
    await t?.close();
    await container?.stop();
  });

  it('leituras: 60 por minuto por usuário; a 61ª recebe 429 com Retry-After', async () => {
    const auth = bearerOf(anaToken.access_token);
    for (let i = 0; i < MCP_RATE_LIMITS.read.max; i++) {
      expect(
        (
          await t
            .http()
            .get('/v1/bookings')
            .set(...auth)
        ).status,
      ).toBe(200);
    }
    const blocked = await t
      .http()
      .get('/v1/spaces')
      .set(...auth);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(MCP_RATE_LIMITS.read.window);
    expect(blocked.headers['x-retry-after']).toBe(String(retryAfter));
    // Outro usuário e a sessão do app da própria Ana seguem livres.
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearerOf(bobToken.access_token))
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearer(ana))
      ).status,
    ).toBe(200);
  });

  it('escritas: 10 a cada 10 minutos por usuário (contam mesmo as recusadas)', async () => {
    const auth = bearerOf(bobToken.access_token);
    for (let i = 0; i < MCP_RATE_LIMITS.write.max; i++) {
      const res = await t
        .http()
        .post(`/v1/bookings/${randomUUID()}/cancel`)
        .set(...auth)
        .send({});
      expect(res.status).toBe(404);
    }
    const blocked = await t
      .http()
      .post(`/v1/bookings/${randomUUID()}/cancel`)
      .set(...auth)
      .send({});
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(MCP_RATE_LIMITS.read.window);
    expect(retryAfter).toBeLessThanOrEqual(MCP_RATE_LIMITS.write.window);
  });
});

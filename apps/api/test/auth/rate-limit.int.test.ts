import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_LIMIT_KEY_PREFIX } from '../../src/auth/redis-rate-limit.js';
import { PUBLIC_DELETION_LIMITS } from '../../src/me/account.service.js';
import { createTestApp, type TestApp } from './helpers.js';

/** Mesma imagem do docker-compose.yml. */
const REDIS_IMAGE = 'redis:7-alpine';
/** Regra padrão do Better Auth para /sign-in/*: 3 tentativas a cada 10 s por IP. */
const SIGN_IN_MAX = 3;

describe('rate limit do Better Auth no Redis', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let apiA: TestApp;
  let apiB: TestApp;

  beforeAll(async () => {
    container = await new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    redis = new Redis(url);
    // Duas instâncias da API (bancos diferentes) com o mesmo Redis.
    const env = {
      REDIS_URL: url,
      AUTH_RATE_LIMIT_ENABLED: 'true',
      AUTH_TRUSTED_PROXIES: '10.0.0.0/8',
    };
    [apiA, apiB] = await Promise.all([createTestApp({ env }), createTestApp({ env })]);
  });
  afterAll(async () => {
    await Promise.all([apiA?.close(), apiB?.close()]);
    redis?.disconnect();
    await container?.stop();
  });

  const signIn = (api: TestApp, forwardedFor: string) =>
    api
      .http()
      .post('/v1/auth/sign-in/email')
      .set('x-forwarded-for', forwardedFor)
      .send({ email: 'ninguem@exemplo.com', password: 'senha-errada-123' });

  it('o limite é compartilhado entre as instâncias e fica no Redis', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < SIGN_IN_MAX; i++) {
      expect((await signIn(i % 2 === 0 ? apiA : apiB, ip)).status).toBe(401);
    }

    const blocked = await signIn(apiB, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: expect.any(String) },
      requestId: expect.any(String),
    });
    expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
    expect((await signIn(apiA, ip)).status).toBe(429);

    const key = `${RATE_LIMIT_KEY_PREFIX}${ip}|/sign-in/email`;
    expect(Number(await redis.get(key))).toBe(SIGN_IN_MAX + 2);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });

  it('outro IP tem o próprio limite', async () => {
    expect((await signIn(apiA, '203.0.113.8')).status).toBe(401);
  });

  it('com proxies confiáveis, o IP é o do cliente, não o do proxy nem o forjado', async () => {
    // O cliente forja 198.51.100.99; o proxy (10.0.0.5) acrescenta o IP real, 198.51.100.1.
    expect((await signIn(apiA, '198.51.100.99, 198.51.100.1, 10.0.0.5')).status).toBe(401);
    expect(await redis.exists(`${RATE_LIMIT_KEY_PREFIX}198.51.100.1|/sign-in/email`)).toBe(1);
    expect(await redis.exists(`${RATE_LIMIT_KEY_PREFIX}198.51.100.99|/sign-in/email`)).toBe(0);
    expect(await redis.exists(`${RATE_LIMIT_KEY_PREFIX}10.0.0.5|/sign-in/email`)).toBe(0);
  });

  describe('pedido de exclusão pela página web (decisão 40)', () => {
    const deletion = (api: TestApp, forwardedFor: string, email: string) =>
      api
        .http()
        .post('/v1/public/deletion-request')
        .set('x-forwarded-for', forwardedFor)
        .send({ email, password: 'senha-errada-123' });

    it('limita as tentativas por e-mail, de qualquer IP e instância', async () => {
      const email = 'alvo@exemplo.com';
      for (let i = 0; i < PUBLIC_DELETION_LIMITS.email.max; i++) {
        const api = i % 2 === 0 ? apiA : apiB;
        expect((await deletion(api, `198.51.100.${10 + i}`, email)).status).toBe(202);
      }
      const blocked = await deletion(apiA, '198.51.100.50', 'Alvo@Exemplo.com');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
      expect(
        await redis.exists(`${RATE_LIMIT_KEY_PREFIX}email:${email}|/public/deletion-request`),
      ).toBe(1);
    });

    it('limita as tentativas por IP, com e-mails diferentes', async () => {
      const ip = '203.0.113.90';
      for (let i = 0; i < PUBLIC_DELETION_LIMITS.ip.max; i++) {
        expect((await deletion(apiB, ip, `pessoa${i}@exemplo.com`)).status).toBe(202);
      }
      expect((await deletion(apiA, ip, 'mais-uma@exemplo.com')).status).toBe(429);
      expect((await deletion(apiA, '203.0.113.91', 'mais-uma@exemplo.com')).status).toBe(202);
    });
  });
});

import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AD_DELIVERY_LIMIT,
  AD_EVENT_ITEMS_LIMIT,
  AD_EVENTS_LIMIT,
} from '../../src/ads/public-ads.controller.js';
import { createTestApp, type TestApp } from '../auth/helpers.js';

// RN-ADS-04: a entrega e o envio público de eventos têm limite por IP (Redis, como os outros
// limites). O IP só entra na chave do contador, que expira com a janela; nada vai para o banco.

describe('anúncios: limite por IP', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let t: TestApp;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    redis = new Redis(url);
    t = await createTestApp({
      env: {
        REDIS_URL: url,
        AUTH_RATE_LIMIT_ENABLED: 'true',
        AUTH_IP_ADDRESS_HEADERS: 'x-forwarded-for',
      },
    });
  });
  afterAll(async () => {
    await t?.close();
    redis?.disconnect();
    await container?.stop();
  });

  it('para no teto por IP, com X-Retry-After; outro IP segue', async () => {
    const send = (ip: string) =>
      t
        .http()
        .post('/v1/ads/events')
        .set('x-forwarded-for', ip)
        .send({ events: [{ token: 'invalido', type: 'IMPRESSION' }] });

    for (let i = 0; i < AD_EVENTS_LIMIT.max; i++) await send('198.51.100.1').expect(202);
    const blocked = await send('198.51.100.1').expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
    await send('198.51.100.2').expect(202);
    // Só o contador, com TTL, fica no Redis.
    const keys = await redis.keys('*ads/events*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it('eventos: o lote consome o número de eventos (teto por minuto por IP)', async () => {
    const batch = (size: number) => ({
      events: Array.from({ length: size }, () => ({ token: 'invalido', type: 'IMPRESSION' })),
    });
    const send = (ip: string, size: number) =>
      t.http().post('/v1/ads/events').set('x-forwarded-for', ip).send(batch(size));

    // 600 eventos em 12 lotes de 50: bem abaixo dos 120 envios, mas no teto de eventos.
    const full = AD_EVENT_ITEMS_LIMIT.max / 50;
    expect(full).toBeLessThan(AD_EVENTS_LIMIT.max);
    for (let i = 0; i < full; i++) await send('198.51.100.10', 50).expect(202);
    const blocked = await send('198.51.100.10', 1).expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
    await send('198.51.100.11', 50).expect(202);
  });

  it('entrega: GET /v1/ads para no teto por IP; outro IP segue', async () => {
    const deliver = (ip: string) =>
      t.http().get('/v1/ads').set('x-forwarded-for', ip).query({ placement: 'EXPLORE_FEED' });

    for (let i = 0; i < AD_DELIVERY_LIMIT.max; i++) await deliver('198.51.100.20').expect(200);
    const blocked = await deliver('198.51.100.20').expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
    await deliver('198.51.100.21').expect(200);
    expect(await redis.keys('*198.51.100.20|/ads')).toHaveLength(1);
  });
});

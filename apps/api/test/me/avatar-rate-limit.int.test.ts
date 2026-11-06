import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATAR_UPLOAD_LIMIT } from '../../src/me/avatar.service.js';
import { PhotoStorage } from '../../src/storage/photo-storage.js';
import { createTestApp, signUp, type TestApp } from '../auth/helpers.js';
import { FakeStorage } from '../spaces/fixtures.js';
import { bearer } from '../super/fixtures.js';

// RF-AUTH-02: cada URL de upload aceita um PUT de qualquer tamanho até a conferência, então os
// pedidos de URL da foto de perfil têm limite por usuário (Redis, como os outros limites).

describe('foto de perfil: limite dos pedidos de URL de upload', () => {
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
      env: { REDIS_URL: url, AUTH_RATE_LIMIT_ENABLED: 'true' },
      providers: [{ provide: PhotoStorage, useValue: new FakeStorage() }],
    });
  });
  afterAll(async () => {
    await t?.close();
    redis?.disconnect();
    await container?.stop();
  });

  it('para no teto por usuário, com X-Retry-After; outro usuário segue', async () => {
    const [a, b] = [
      await signUp(t, 'limite-foto-a@exemplo.com'),
      await signUp(t, 'limite-foto-b@exemplo.com'),
    ];
    const presign = (user: typeof a) =>
      t
        .http()
        .post('/v1/me/avatar/uploads')
        .set(...bearer(user))
        .send({ contentType: 'image/jpeg' });

    for (let i = 0; i < AVATAR_UPLOAD_LIMIT.max; i++) await presign(a).expect(201);
    const blocked = await presign(a).expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['x-retry-after'])).toBeGreaterThan(0);
    await presign(b).expect(201);
  });
});

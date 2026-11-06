import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, setupApp } from '../src/app.setup.js';
import { type Env, loadEnv } from '../src/config/env.js';

// Usa os serviços do docker compose (`pnpm db:up`); as URLs podem ser sobrescritas por env.
const baseEnv = loadEnv({
  DATABASE_URL: 'postgres://space_sports:space_sports@localhost:5432/space_sports',
  REDIS_URL: 'redis://localhost:6379',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  BETTER_AUTH_SECRET: 'e2e-secret-com-pelo-menos-32-caracteres',
  ...process.env,
  NODE_ENV: 'test',
});

async function createApp(env: Env): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env)],
  }).compile();
  const app = setupApp(moduleRef.createNestApplication(APP_OPTIONS));
  await app.init();
  return app;
}

describe('com Postgres e Redis no ar', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp(baseEnv);
  });
  afterAll(() => app.close());

  it('GET /v1/health responde 200 com as duas checagens up', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      info: { postgres: { status: 'up' }, redis: { status: 'up' } },
      error: {},
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propaga o x-request-id recebido', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health')
      .set('x-request-id', 'trace-42');
    expect(res.headers['x-request-id']).toBe('trace-42');
  });

  it('rotas inexistentes seguem o formato padrão de erro com requestId', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/nao-existe')
      .set('x-request-id', 'trace-404')
      .expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Cannot GET /v1/nao-existe' },
      requestId: 'trace-404',
    });
  });

  it('JSON malformado responde 400 INVALID_JSON com requestId (passou pelo pino-http)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/health')
      .set('content-type', 'application/json')
      .set('x-request-id', 'trace-json')
      .send('{"senha": s')
      .expect(400);

    expect(res.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'JSON inválido.' },
      requestId: 'trace-json',
    });
  });

  it('/health sem o prefixo /v1 não existe', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('publica o OpenAPI em /docs-json e a UI em /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toHaveProperty('/v1/health');

    await request(app.getHttpServer()).get('/docs').expect(200);
  });
});

describe('com dependências fora do ar', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp({
      ...baseEnv,
      DATABASE_URL: 'postgres://space_sports:space_sports@127.0.0.1:1/space_sports',
      REDIS_URL: 'redis://127.0.0.1:1',
    });
  });
  afterAll(() => app.close());

  it('GET /v1/health responde 503 HEALTH_CHECK_FAILED com o resultado de cada checagem', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(503);

    // Só o status de cada dependência: nada das mensagens cruas dos drivers (host, usuário).
    expect(res.body).toEqual({
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Uma ou mais dependências estão indisponíveis.',
        details: { postgres: { status: 'down' }, redis: { status: 'down' } },
      },
      requestId: expect.any(String),
    });
    expect(JSON.stringify(res.body.error.details)).not.toMatch(/message|127\.0\.0\.1|space_sports/);
  });
});

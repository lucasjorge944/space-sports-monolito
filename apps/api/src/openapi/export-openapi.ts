import { NestFactory } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { API_PREFIX, APP_OPTIONS, buildOpenApiDocument } from '../app.setup.js';
import { type Env, loadEnv } from '../config/env.js';

/**
 * Env fixo do export: o documento não pode depender do .env de quem roda. As URLs nunca são
 * acessadas (o pool do Postgres e o Redis só conectam no primeiro uso). O login por telefone fica
 * desligado como nos ambientes (decisão 65): as rotas /phone-number/* não entram no documento.
 * O gateway é o `fake`, para o simulador entrar no documento.
 */
export const OPENAPI_EXPORT_ENV: Env = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://openapi:openapi@localhost:5432/openapi',
  REDIS_URL: 'redis://localhost:6379',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  BETTER_AUTH_SECRET: 'openapi-export-secret-sem-uso-real-000',
  BETTER_AUTH_URL: 'http://localhost:3333',
  SMS_PROVIDER: 'none',
  // O simulador de pagamentos (RF-ONPAY-12) só existe com o fake: o documento inclui as rotas
  // dele para o cliente gerado (o web mostra a aba só quando a API as expõe).
  PAYMENTS_PROVIDER: 'fake',
  PAYMENTS_FAKE_WEBHOOK_SECRET: 'openapi-export-webhook-secret-sem-uso-real',
});

/**
 * Documento OpenAPI igual ao de /docs-json, sem subir servidor: fonte do cliente gerado em
 * packages/api-client (`pnpm generate:api-client`).
 */
export async function exportOpenApiDocument(env: Env = OPENAPI_EXPORT_ENV): Promise<OpenAPIObject> {
  const app = await NestFactory.create(AppModule.register(env), { ...APP_OPTIONS, logger: false });
  try {
    app.setGlobalPrefix(API_PREFIX);
    return buildOpenApiDocument(app);
  } finally {
    await app.close();
  }
}

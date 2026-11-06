import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, setupApp } from './app.setup.js';
import { InvalidEnvError, loadEnv } from './config/env.js';

// Em dev, carrega o .env do app ou da raiz do monorepo (variáveis já definidas têm prioridade).
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule.register(env), APP_OPTIONS);
  setupApp(app);
  await app.listen(env.PORT);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof InvalidEnvError ? err.message : err);
  process.exit(1);
});

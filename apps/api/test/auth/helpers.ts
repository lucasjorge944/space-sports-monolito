import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, setupApp } from '../../src/app.setup.js';
import { AUTH_COOKIE_PREFIX } from '../../src/auth/auth.js';
import { SMS_SENDER } from '../../src/auth/auth.tokens.js';
import { SmsSender } from '../../src/auth/sms-sender.js';
import { loadEnv } from '../../src/config/env.js';
import type { Database } from '../../src/db/client.js';
import { users } from '../../src/db/schema/index.js';
import { Mailer, type MailMessage } from '../../src/mail/mailer.js';
import { createTestDatabase } from '../db/helpers.js';

export const WEB_ORIGIN = 'http://localhost:3000';
export const API_URL = 'http://localhost:3333';
export const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token`;
export const PASSWORD = 'senha-forte-123';
/** Telefone do cadastro nos testes (decisão 64: obrigatório e não verificado; pode se repetir). */
export const PHONE = '+5531988880000';

export class FakeMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Último e-mail para o endereço (espera o envio, que não bloqueia a resposta). */
  async lastTo(to: string): Promise<MailMessage> {
    return waitFor(() => this.sent.findLast((message) => message.to === to));
  }
}

export class FakeSms extends SmsSender {
  readonly sent: { phoneNumber: string; code: string }[] = [];

  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    this.sent.push({ phoneNumber, code });
  }

  async lastCode(phoneNumber: string): Promise<string> {
    const otp = await waitFor(() => this.sent.findLast((sms) => sms.phoneNumber === phoneNumber));
    return otp.code;
  }
}

export type TestApp = {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  db: Database;
  mailer: FakeMailer;
  sms: FakeSms;
  close: () => Promise<void>;
};

/**
 * App Nest completa sobre um banco clonado do template (Testcontainers), com e-mail e SMS
 * falsos. `imports` acrescenta módulos (ex.: controllers de teste dos guards) e `env` sobrescreve
 * variáveis.
 */
export async function createTestApp({
  imports = [],
  env: overrides = {},
  providers = [],
}: {
  imports?: ModuleMetadata['imports'];
  env?: Record<string, string>;
  /** Providers substituídos por fakes (ex.: Geocoder, PhotoStorage). */
  providers?: { provide: unknown; useValue: unknown }[];
} = {}): Promise<TestApp> {
  const database = await createTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    // Redis é lazy e nenhuma rota de auth o usa.
    REDIS_URL: 'redis://127.0.0.1:1',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    BETTER_AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    BETTER_AUTH_URL: API_URL,
    TRUSTED_ORIGINS: `${WEB_ORIGIN},spacesports://`,
    SMS_PROVIDER: 'console',
    ...overrides,
  });
  const mailer = new FakeMailer();
  const sms = new FakeSms();
  let builder = Test.createTestingModule({
    imports: [AppModule.register(env), ...imports],
  })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(SMS_SENDER)
    // Como o createSmsSender: SMS_PROVIDER=none não tem sender.
    .useValue(env.SMS_PROVIDER === 'none' ? null : sms);
  for (const { provide, useValue } of providers) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = setupApp(moduleRef.createNestApplication(APP_OPTIONS));
  await app.init();

  return {
    app,
    http: () => request(app.getHttpServer()),
    db: database.db,
    mailer,
    sms,
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
}

/** Valor do cookie de sessão na resposta (ou undefined). */
export function sessionCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.split(';')[0];
}

export type SignedUp = { id: string; email: string; cookie: string; token: string };

/** Cadastra por e-mail + senha + telefone e devolve o id, o cookie (web) e o token bearer (app). */
export async function signUp(
  t: TestApp,
  email: string,
  name = 'Jogador Teste',
  phone = PHONE,
): Promise<SignedUp> {
  const res = await t
    .http()
    .post('/v1/auth/sign-up/email')
    .send({ name, email, password: PASSWORD, phone });
  if (res.status !== 200)
    throw new Error(`Cadastro falhou: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = sessionCookie(res);
  const token = res.headers['set-auth-token'];
  if (!cookie || typeof token !== 'string') throw new Error('Cadastro sem sessão.');
  return { id: res.body.user.id, email: res.body.user.email, cookie, token };
}

export async function makeSuper(db: Database, userId: string): Promise<void> {
  await db.update(users).set({ platformRole: 'SUPER' }).where(eq(users.id, userId));
}

async function waitFor<T>(find: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error('Tempo esgotado esperando o envio.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

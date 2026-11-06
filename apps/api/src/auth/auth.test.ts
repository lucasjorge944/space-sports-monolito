import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { InProcessDomainEvents } from '../events/domain-events.js';
import type { Mailer } from '../mail/mailer.js';
import { DisabledPhotoStorage } from '../storage/photo-storage.js';
import { createAuth } from './auth.js';
import { ConsoleSmsSender } from './sms-sender.js';

// Nenhuma consulta é feita: o pool e o Redis (lazy) nunca conectam.
const pool = new pg.Pool({ connectionString: 'postgres://u:p@127.0.0.1:1/db' });
const redis = new Redis({ lazyConnect: true });
const db = createDatabase(pool);
const mailer = { send: async () => undefined } as unknown as Mailer;

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db',
  REDIS_URL: 'redis://127.0.0.1:1',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  BETTER_AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  TRUSTED_ORIGINS: 'http://localhost:3000',
};

function build(env: Record<string, string>, sms: ConsoleSmsSender | null = null) {
  return createAuth({
    env: loadEnv({ ...baseEnv, ...env }),
    db,
    mailer,
    sms,
    redis,
    events: new InProcessDomainEvents(),
    storage: new DisabledPhotoStorage(),
  }).options;
}

describe('createAuth: provedores ligados pelo env', () => {
  afterAll(async () => {
    redis.disconnect();
    await pool.end();
  });

  it('sem credenciais, só e-mail + senha', () => {
    const options = build({});
    expect(options.emailAndPassword?.enabled).toBe(true);
    expect(options.socialProviders).toEqual({});
    expect(options.plugins?.map((plugin) => plugin.id)).not.toContain('phone-number');
    expect(options.trustedOrigins).toEqual(['http://localhost:3000']);
  });

  it('liga Google e Apple quando id e secret estão no env', () => {
    const options = build({
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      APPLE_CLIENT_ID: 'apple-id',
      APPLE_CLIENT_SECRET: 'apple-jwt',
      APPLE_APP_BUNDLE_IDENTIFIER: 'dev.spacesports.app',
    });
    expect(options.socialProviders).toMatchObject({
      google: { clientId: 'google-id', clientSecret: 'google-secret' },
      apple: {
        clientId: 'apple-id',
        clientSecret: 'apple-jwt',
        appBundleIdentifier: 'dev.spacesports.app',
      },
    });
    // O callback da Apple chega por form_post de appleid.apple.com.
    expect(options.trustedOrigins).toContain('https://appleid.apple.com');
  });

  it('login por telefone: só com AUTH_PHONE_LOGIN_ENABLED=true e um sender de SMS (decisão 65)', () => {
    const ids = (env: Record<string, string>, sms: ConsoleSmsSender | null) =>
      build(env, sms).plugins?.map((plugin) => plugin.id);
    expect(ids({}, new ConsoleSmsSender())).not.toContain('phone-number');
    expect(ids({ AUTH_PHONE_LOGIN_ENABLED: 'true' }, null)).not.toContain('phone-number');
    expect(ids({ AUTH_PHONE_LOGIN_ENABLED: 'true' }, new ConsoleSmsSender())).toContain(
      'phone-number',
    );
  });

  it('telefone no modelo do usuário com os nomes do plugin, nas colunas phone/phone_verified', () => {
    // Desligado: os campos vêm de additionalFields, sem entrada pelo corpo das rotas.
    expect(build({}).user?.additionalFields).toMatchObject({
      phoneNumber: { fieldName: 'phone', input: false },
      phoneNumberVerified: { fieldName: 'phoneVerified', input: false },
    });
    // Ligado: o plugin declara os mesmos campos; additionalFields não repete.
    const on = build({ AUTH_PHONE_LOGIN_ENABLED: 'true' }, new ConsoleSmsSender());
    expect(on.user?.additionalFields).not.toHaveProperty('phoneNumber');
  });

  it('Google: liga só com e-mail verificado pelo provedor, sem provedores confiáveis', () => {
    expect(build({}).account?.accountLinking).toMatchObject({
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
      requireLocalEmailVerified: false,
      updateUserInfoOnLink: false,
    });
  });

  it('sessão por cookie (web) e bearer (app Expo) sempre ligadas', () => {
    const ids = build({}).plugins?.map((plugin) => plugin.id);
    expect(ids).toEqual(expect.arrayContaining(['bearer', 'expo']));
  });

  it('rate limit no Redis: ligado por env; IP do cliente por headers e proxies confiáveis', () => {
    const off = build({});
    expect(off.rateLimit).toMatchObject({ enabled: false, customStorage: expect.any(Object) });
    expect(off.advanced?.ipAddress).toEqual({});

    const on = build({
      AUTH_RATE_LIMIT_ENABLED: 'true',
      AUTH_IP_ADDRESS_HEADERS: 'cf-connecting-ip,x-forwarded-for',
      AUTH_TRUSTED_PROXIES: '10.0.0.0/8, 192.0.2.10',
    });
    expect(on.rateLimit?.enabled).toBe(true);
    expect(on.advanced?.ipAddress).toEqual({
      ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      trustedProxies: ['10.0.0.0/8', '192.0.2.10'],
    });
  });
});

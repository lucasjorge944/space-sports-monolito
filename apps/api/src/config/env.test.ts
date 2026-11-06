import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from './env.js';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://api.spacesports.dev',
  ADS_DELIVERY_SECRET: 'a'.repeat(32),
  PAYMENTS_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadEnv', () => {
  it('aplica defaults e converte números', () => {
    const { PAYMENTS_FAKE_WEBHOOK_SECRET, ...env } = loadEnv(valid);
    expect(PAYMENTS_FAKE_WEBHOOK_SECRET).toHaveLength(44);
    expect(env).toEqual({
      ...valid,
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_FROM: 'Space Sports <nao-responda@spacesports.local>',
      PORT: 3333,
      TRUSTED_ORIGINS: [],
      WEB_URL: 'http://localhost:3000',
      AUTH_PHONE_LOGIN_ENABLED: false,
      SMS_PROVIDER: 'none',
      AUTH_RATE_LIMIT_ENABLED: true,
      JOBS_ENABLED: true,
      AUTH_IP_ADDRESS_HEADERS: [],
      AUTH_TRUSTED_PROXIES: [],
      BOOKING_REMINDER_LEAD_MIN: 120,
      REVIEW_REQUEST_DELAY_MIN: 120,
      S3_REGION: 'sa-east-1',
      S3_FORCE_PATH_STYLE: false,
      DEPLOY_ENV: 'production',
      PAYMENTS_PROVIDER: 'none',
      PAYMENTS_FAKE_WEBHOOK_URL: 'http://127.0.0.1:3333/v1/webhooks/payments/fake',
      PAYMENTS_FAKE_APPROVAL_DELAY_MS: 5000,
      PAYMENTS_FAKE_CHARGEBACK_DELAY_MS: 60000,
      PAYMENTS_FAKE_PIX_RELEASE_DAYS: 1,
      PAYMENTS_FAKE_CARD_RELEASE_DAYS: 30,
      PAYMENTS_FAKE_PIX_COST_BPS: 99,
      PAYMENTS_FAKE_CARD_COST_BPS: 349,
      PAYMENTS_FAKE_CARD_COST_FIXED_CENTS: 39,
    });
  });

  it('PAYMENTS_DATA_KEY: 32 bytes em base64, obrigatória em produção; fora dela é gerada (decisão 97)', () => {
    const { PAYMENTS_DATA_KEY: _key, ...withoutKey } = valid;
    expect(() => loadEnv(withoutKey)).toThrow(InvalidEnvError);
    const dev = loadEnv({ ...withoutKey, NODE_ENV: 'development' }).PAYMENTS_DATA_KEY;
    expect(Buffer.from(dev, 'base64')).toHaveLength(32);
    expect(() => loadEnv({ ...valid, PAYMENTS_DATA_KEY: 'curta' })).toThrow(InvalidEnvError);
  });

  it('PAYMENTS_PROVIDER: fake fora de produção, none em produção; fake recusado em produção (RN-ONPAY-09)', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).PAYMENTS_PROVIDER).toBe('fake');
    expect(loadEnv({ ...valid, NODE_ENV: 'test' }).PAYMENTS_PROVIDER).toBe('fake');
    expect(loadEnv(valid).PAYMENTS_PROVIDER).toBe('none');
    expect(
      loadEnv({ ...valid, NODE_ENV: 'test', PAYMENTS_PROVIDER: 'none' }).PAYMENTS_PROVIDER,
    ).toBe('none');
    expect(() => loadEnv({ ...valid, PAYMENTS_PROVIDER: 'fake' })).toThrow(InvalidEnvError);
    try {
      loadEnv({ ...valid, PAYMENTS_PROVIDER: 'fake' });
    } catch (err) {
      expect((err as InvalidEnvError).issues.map((i) => i.path.join('.'))).toEqual([
        'PAYMENTS_PROVIDER',
      ]);
    }
    expect(() => loadEnv({ ...valid, PAYMENTS_PROVIDER: 'asaas' })).toThrow(InvalidEnvError);
    // O staging roda a build de produção com o fake, declarando DEPLOY_ENV=staging.
    expect(
      loadEnv({ ...valid, DEPLOY_ENV: 'staging', PAYMENTS_PROVIDER: 'fake' }).PAYMENTS_PROVIDER,
    ).toBe('fake');
    expect(() =>
      loadEnv({ ...valid, DEPLOY_ENV: 'production', PAYMENTS_PROVIDER: 'fake' }),
    ).toThrow(InvalidEnvError);
  });

  it('JOBS_ENABLED: ligado fora de test, desligado em test, e a variável vence', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).JOBS_ENABLED).toBe(true);
    expect(loadEnv({ ...valid, NODE_ENV: 'test' }).JOBS_ENABLED).toBe(false);
    expect(loadEnv({ ...valid, JOBS_ENABLED: 'false' }).JOBS_ENABLED).toBe(false);
    expect(loadEnv({ ...valid, NODE_ENV: 'test', JOBS_ENABLED: 'true' }).JOBS_ENABLED).toBe(true);
  });

  it('exige NODE_ENV explícito (sem default)', () => {
    const { NODE_ENV: _, ...withoutNodeEnv } = valid;
    expect(() => loadEnv(withoutNodeEnv)).toThrow(/NODE_ENV/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('falha listando todas as variáveis inválidas ou ausentes', () => {
    const run = () =>
      loadEnv({ ...valid, DATABASE_URL: 'mysql://x', REDIS_URL: undefined, PORT: 'abc' });
    expect(run).toThrow(InvalidEnvError);
    expect(run).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
    expect(run).toThrow(/PORT/);
  });

  it('ADS_DELIVERY_SECRET: obrigatória em produção; fora dela é gerada a cada boot', () => {
    const { ADS_DELIVERY_SECRET: _, ...withoutSecret } = valid;
    expect(() => loadEnv(withoutSecret)).toThrow(/ADS_DELIVERY_SECRET/);
    expect(() => loadEnv({ ...valid, ADS_DELIVERY_SECRET: 'curta' })).toThrow(
      /ADS_DELIVERY_SECRET/,
    );
    for (const NODE_ENV of ['development', 'test']) {
      const first = loadEnv({ ...withoutSecret, NODE_ENV }).ADS_DELIVERY_SECRET;
      expect(first.length).toBeGreaterThanOrEqual(32);
      expect(loadEnv({ ...withoutSecret, NODE_ENV }).ADS_DELIVERY_SECRET).not.toBe(first);
    }
  });

  it('exige BETTER_AUTH_SECRET com pelo menos 32 caracteres', () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: 'curto' })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('BETTER_AUTH_URL: obrigatória em produção; em dev usa localhost:PORT', () => {
    const { BETTER_AUTH_URL: _, ...withoutUrl } = valid;
    expect(() => loadEnv(withoutUrl)).toThrow(/BETTER_AUTH_URL/);
    expect(loadEnv({ ...withoutUrl, NODE_ENV: 'development', PORT: '4000' })).toMatchObject({
      BETTER_AUTH_URL: 'http://localhost:4000',
    });
  });

  it('WEB_URL: explícita (sem barra no fim) ou a primeira origem http(s) de TRUSTED_ORIGINS', () => {
    expect(loadEnv({ ...valid, WEB_URL: 'https://app.spacesports.dev/' }).WEB_URL).toBe(
      'https://app.spacesports.dev',
    );
    expect(
      loadEnv({ ...valid, TRUSTED_ORIGINS: 'spacesports://,exp://*,https://app.spacesports.dev' })
        .WEB_URL,
    ).toBe('https://app.spacesports.dev');
  });

  it('lê TRUSTED_ORIGINS separadas por vírgula', () => {
    expect(
      loadEnv({ ...valid, TRUSTED_ORIGINS: ' http://localhost:3000, spacesports:// ,' })
        .TRUSTED_ORIGINS,
    ).toEqual(['http://localhost:3000', 'spacesports://']);
  });

  it('S3: bucket e URL pública juntos; região padrão sa-east-1; chaves de dev juntas', () => {
    expect(() => loadEnv({ ...valid, S3_BUCKET: 'fotos' })).toThrow(/S3_PUBLIC_URL/);
    expect(() => loadEnv({ ...valid, S3_PUBLIC_URL: 'https://d1.cloudfront.net' })).toThrow(
      /S3_PUBLIC_URL/,
    );
    const s3 = { S3_BUCKET: 'fotos', S3_PUBLIC_URL: 'https://d1.cloudfront.net' };
    const env = loadEnv({ ...valid, ...s3, S3_REGION: '', S3_FORCE_PATH_STYLE: '' });
    expect(env).toMatchObject({ ...s3, S3_REGION: 'sa-east-1', S3_FORCE_PATH_STYLE: false });
    expect(env.S3_ACCESS_KEY_ID).toBeUndefined();

    expect(() => loadEnv({ ...valid, ...s3, S3_ACCESS_KEY_ID: 'minio' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
    const minio = loadEnv({
      ...valid,
      ...s3,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: 'minio',
      S3_SECRET_ACCESS_KEY: 'minio-secret',
    });
    expect(minio).toMatchObject({
      S3_FORCE_PATH_STYLE: true,
      S3_ENDPOINT: 'http://localhost:9000',
    });
    expect(() => loadEnv({ ...valid, S3_ENDPOINT: 'ftp://minio' })).toThrow(/S3_ENDPOINT/);
  });

  it('provedores sociais: id e secret juntos; vazio conta como não definido', () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadEnv({ ...valid, APPLE_CLIENT_SECRET: 'jwt' })).toThrow(/APPLE_CLIENT_SECRET/);
    const env = loadEnv({ ...valid, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('OTP por telefone: console fora de produção; proibido em produção', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).SMS_PROVIDER).toBe('console');
    expect(loadEnv({ ...valid, NODE_ENV: 'test', SMS_PROVIDER: 'none' }).SMS_PROVIDER).toBe('none');
    expect(() => loadEnv({ ...valid, SMS_PROVIDER: 'console' })).toThrow(/SMS_PROVIDER/);
  });

  it('login por telefone: desligado por padrão em todos os ambientes (decisão 65)', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      expect(loadEnv({ ...valid, NODE_ENV }).AUTH_PHONE_LOGIN_ENABLED).toBe(false);
    }
    expect(
      loadEnv({ ...valid, NODE_ENV: 'test', AUTH_PHONE_LOGIN_ENABLED: 'true' })
        .AUTH_PHONE_LOGIN_ENABLED,
    ).toBe(true);
  });

  it('rate limit: ligado só em produção por padrão; proxies confiáveis precisam ser IP ou CIDR', () => {
    expect(loadEnv({ ...valid, NODE_ENV: 'development' }).AUTH_RATE_LIMIT_ENABLED).toBe(false);
    expect(
      loadEnv({ ...valid, NODE_ENV: 'test', AUTH_RATE_LIMIT_ENABLED: 'true' })
        .AUTH_RATE_LIMIT_ENABLED,
    ).toBe(true);
    expect(loadEnv({ ...valid, AUTH_RATE_LIMIT_ENABLED: 'false' }).AUTH_RATE_LIMIT_ENABLED).toBe(
      false,
    );
    expect(
      loadEnv({ ...valid, AUTH_TRUSTED_PROXIES: '10.0.0.0/8,2001:db8::1' }).AUTH_TRUSTED_PROXIES,
    ).toEqual(['10.0.0.0/8', '2001:db8::1']);
    expect(() => loadEnv({ ...valid, AUTH_TRUSTED_PROXIES: 'proxy.interno' })).toThrow(
      /AUTH_TRUSTED_PROXIES/,
    );
  });
});

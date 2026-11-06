import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E real do pagamento online (RF-ONPAY; specs `e2e/real/pagamentos-online*.spec.ts`). Mesma
// API real e mesmo seed do playwright.real.config.ts, mas com `JOBS_ENABLED=true`: o gateway fake
// entrega os webhooks e aprova o cadastro pela fila (BullMQ no Redis), e sem isso nenhum pagamento
// se confirma. Por isso fica fora da suíte padrão (que roda com os jobs desligados).
// Pré-requisitos: Postgres (PostGIS), Redis e Mailpit no ar, banco migrado, `pnpm --filter
// @space-sports/api build`. Portas e banco por variável, como no config padrão:
//   E2E_WEB_PORT, E2E_API_PORT, E2E_DATABASE_URL, REDIS_URL, E2E_SMTP_PORT, E2E_MAILPIT_URL.
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 3335);
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgres://space_sports:space_sports@localhost:5432/space_sports_e2e';

export default defineConfig({
  testDir: './e2e/real',
  testMatch: /pagamentos-online.*\.spec\.ts/,
  globalSetup: './e2e/real/global-setup.ts',
  // Um worker: os testes seguem em sequência sobre o mesmo espaço.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${webPort}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      env: {
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
        BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        BETTER_AUTH_URL: `http://localhost:${webPort}`,
        TRUSTED_ORIGINS: `http://localhost:${webPort}`,
        JOBS_ENABLED: 'true',
        PORT: String(apiPort),
        NODE_ENV: 'development',
        SMTP_HOST: 'localhost',
        SMTP_PORT: process.env.E2E_SMTP_PORT ?? '1025',
        SMTP_FROM: 'Space Sports <nao-responda@spacesports.local>',
        PAYMENTS_PROVIDER: 'fake',
        // O fake entrega os webhooks na própria API e aprova o cadastro em meio segundo.
        PAYMENTS_FAKE_WEBHOOK_URL: `http://127.0.0.1:${apiPort}/v1/webhooks/payments/fake`,
        PAYMENTS_FAKE_APPROVAL_DELAY_MS: '500',
        NODE_OPTIONS: `--import ${resolve(__dirname, 'e2e/real/support/cep-fetch-stub.mjs')}`,
      },
      url: `http://localhost:${apiPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next dev --port ${webPort}`,
      env: {
        NEXT_DIST_DIR: '.next-e2e-real',
        API_URL: `http://localhost:${apiPort}`,
        AUTH_PROVIDERS: '',
      },
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

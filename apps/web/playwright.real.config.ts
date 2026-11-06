import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E contra a API REAL (Postgres + Redis do docker compose, banco `*_e2e` com o seed de teste de
// apps/api/test/e2e-seed). Complementa o e2e com API simulada (playwright.config.ts), que não
// consegue provar regras de servidor como o conflito de horário (SLOT_UNAVAILABLE).
// Pré-requisitos: `docker compose up -d postgres redis mailpit`, banco criado, `pnpm --filter
// @space-sports/api build` e `pnpm --filter @space-sports/api db:migrate` com o mesmo DATABASE_URL.
// Portas e banco podem ser trocados por variável (E2E_WEB_PORT, E2E_API_PORT, E2E_DATABASE_URL): assim
// uma execução não briga com outro worktree que use as portas padrão. Os specs leem o mesmo
// `support/env.ts`.
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 3335);
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgres://space_sports:space_sports@localhost:5432/space_sports_e2e';

export default defineConfig({
  testDir: './e2e/real',
  // O pagamento online precisa dos jobs ligados: tem config própria (playwright.real-payments.config.ts).
  testIgnore: /pagamentos-online.*\.spec\.ts/,
  globalSetup: './e2e/real/global-setup.ts',
  // Um worker: os testes compartilham a agenda do mesmo espaço e rodam em sequência.
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
        JOBS_ENABLED: 'false',
        PORT: String(apiPort),
        NODE_ENV: 'development',
        SMTP_HOST: 'localhost',
        SMTP_PORT: process.env.E2E_SMTP_PORT ?? '1025',
        SMTP_FROM: 'Space Sports <nao-responda@spacesports.local>',
        // ViaCEP e BrasilAPI simulados (cep.spec.ts): o e2e não depende de rede nem de cache antigo.
        NODE_OPTIONS: `--import ${resolve(__dirname, 'e2e/real/support/cep-fetch-stub.mjs')}`,
      },
      url: `http://localhost:${apiPort}/v1/health`,
      reuseExistingServer: !process.env.CI,
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
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

const port = 3100;
const mockApiPort = 3334;

export default defineConfig({
  testDir: './e2e',
  // e2e/real roda contra a API real, com playwright.real.config.ts.
  testIgnore: '**/real/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API simulada (contrato de /v1/auth e /v1/me): o e2e do web não depende de banco nem de Redis.
      command: 'node e2e/mock-api.mjs',
      env: { MOCK_API_PORT: String(mockApiPort) },
      url: `http://localhost:${mockApiPort}/__calls`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm exec next dev --port ${port}`,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        API_URL: `http://localhost:${mockApiPort}`,
        AUTH_PROVIDERS: 'google',
      },
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

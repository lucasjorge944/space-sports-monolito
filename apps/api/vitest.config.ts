import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O SWC emite os metadados de decorators que a injeção de dependência do Nest precisa.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        extends: true,
        test: { name: 'e2e', include: ['test/**/*.e2e.test.ts'], testTimeout: 20_000 },
      },
      {
        // Postgres real via Testcontainers (precisa de Docker); não depende do docker compose.
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          globalSetup: ['test/db/global-setup.ts'],
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});

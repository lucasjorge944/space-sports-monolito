import { defineConfig } from 'vitest/config';

// E2E local do MCP (docs/14-mcp.md, "Como testar"): API real + apps/mcp reais em processos próprios,
// Postgres e Redis em contêineres (e2e/run.sh). Os arquivos rodam em sequência: compartilham o banco
// do seed e o Redis (limites por usuário).
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

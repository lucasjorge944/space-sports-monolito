import { existsSync } from 'node:fs';

// Como no main.ts: carrega o .env do app ou da raiz do monorepo (variáveis já definidas ganham).
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

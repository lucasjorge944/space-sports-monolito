import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  // `generate` não precisa de banco; `migrate`/`studio` usam o DATABASE_URL do .env.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  // A extensão postgis cria tabelas próprias (spatial_ref_sys) que não fazem parte do schema.
  extensionsFilters: ['postgis'],
  strict: true,
  verbose: true,
});

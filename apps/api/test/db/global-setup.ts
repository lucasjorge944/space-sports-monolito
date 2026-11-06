import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { TEMPLATE_DB, withDatabase } from './database-url.js';

/** Mesmo Postgres + PostGIS do docker-compose.yml. */
const IMAGE = 'postgis/postgis:17-3.5';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL de administração (banco `postgres`) do container de teste. */
    pgAdminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Sobe um Postgres descartável (Testcontainers), aplica as migrações num banco template e
 * entrega a URL aos testes. Cada arquivo de teste clona o template (ver helpers.ts).
 */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer(IMAGE).start();
  const adminUrl = withDatabase(container.getConnectionUri(), 'postgres');

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: withDatabase(adminUrl, TEMPLATE_DB) });
  try {
    await runMigrations(createDatabase(pool));
  } finally {
    await pool.end();
  }

  project.provide('pgAdminUrl', adminUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

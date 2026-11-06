import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../../src/db/client.js';
import { TEMPLATE_DB, withDatabase } from './database-url.js';

export type TestDatabase = {
  db: Database;
  pool: pg.Pool;
  /** URL do banco clonado (para subir a app Nest apontando para ele). */
  url: string;
  drop: () => Promise<void>;
};

/** Banco isolado para um arquivo de teste, clonado do template já migrado. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl');
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await withAdmin(adminUrl, (admin) =>
    admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`),
  );

  const url = withDatabase(adminUrl, name);
  const pool = new pg.Pool({ connectionString: url });
  return {
    db: createDatabase(pool),
    pool,
    url,
    drop: async () => {
      await pool.end();
      await withAdmin(adminUrl, (admin) => admin.query(`DROP DATABASE ${name}`));
    },
  };
}

async function withAdmin<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

/** Erro do Postgres por trás do erro do Drizzle (que embrulha o original em `cause`). */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let current: unknown = err;
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') {
      return current as { code: string; constraint?: string };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return {};
}

/** Promessa que deve rejeitar com um erro do Postgres; devolve código e constraint. */
export async function expectPgError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return pgError(err);
  }
  throw new Error('A operação deveria ter falhado no banco.');
}

/** Primeira linha de um resultado; falha o teste se vier vazio. */
export function first<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('Consulta sem resultado.');
  return row;
}

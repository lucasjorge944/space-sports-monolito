import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DATABASE_URL } from './env.js';

// `pg` é dependência da API, não do apps/mcp: resolve a partir de apps/api.
const require = createRequire(resolve(import.meta.dirname, '../../../api/package.json'));
interface PgClient {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}
const pg = require('pg') as { Client: new (options: { connectionString: string }) => PgClient };

/** Consulta direta ao banco do e2e (só leitura de conferência e ajuste de cenário). */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

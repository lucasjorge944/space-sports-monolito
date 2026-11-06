import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/** Drizzle sobre um pool já existente (o mesmo do DatabaseModule). */
export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

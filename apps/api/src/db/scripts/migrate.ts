import './load-env.js';
import pg from 'pg';
import { createDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { loadScriptEnv, type ScriptEnv } from './env.js';

let env: ScriptEnv;
try {
  env = loadScriptEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
try {
  await runMigrations(createDatabase(pool));
  console.log('Migrações aplicadas.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

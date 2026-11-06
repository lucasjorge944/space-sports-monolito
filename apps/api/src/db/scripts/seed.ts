import './load-env.js';
import pg from 'pg';
import { createDatabase } from '../client.js';
import { SeedSuperUserConflictError, seed } from '../seed.js';
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
  const superUser =
    env.SEED_SUPER_EMAIL && env.SEED_SUPER_NAME
      ? {
          email: env.SEED_SUPER_EMAIL,
          name: env.SEED_SUPER_NAME,
          password: env.SEED_SUPER_PASSWORD,
        }
      : undefined;
  if (!superUser)
    console.warn('SEED_SUPER_EMAIL/SEED_SUPER_NAME não definidos: usuário Super não criado.');
  else if (!superUser.password)
    console.warn('SEED_SUPER_PASSWORD não definida: o Super só entra pelo "esqueci a senha".');
  await seed(createDatabase(pool), { superUser });
  console.log('Seed aplicado.');
} catch (err) {
  console.error(err instanceof SeedSuperUserConflictError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

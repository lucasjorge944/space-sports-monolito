import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { createDatabase, type Database } from '../db/client.js';

export const PG_POOL = Symbol('PG_POOL');
/** Instância do Drizzle (`Database`) sobre o mesmo pool. Injete com `@Inject(DB)`. */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => {
        const logger = new Logger('Postgres');
        const pool = new pg.Pool({
          connectionString: env.DATABASE_URL,
          connectionTimeoutMillis: 3_000,
        });
        pool.on('error', (err) => logger.error({ err }, 'Erro em conexão ociosa do pool'));
        return pool;
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database => createDatabase(pool),
    },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

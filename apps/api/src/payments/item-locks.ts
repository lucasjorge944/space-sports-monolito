import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { paymentInProgress } from './payments.errors.js';

/** Quanto um segundo toque espera a operação em andamento no mesmo item antes de desistir. */
const LOCK_TIMEOUT = '30s';
/** Operações com trava ao mesmo tempo (cada uma segura uma conexão deste pool). */
const MAX_HOLDERS = 5;

/**
 * Trava por item de cobrança (RN-ONPAY-03): criação, troca e registro no local, um de cada vez, com
 * a trava (advisory lock de transação) presa durante a chamada ao gateway. A trava fica num pool
 * próprio e pequeno: quem a segura faz o trabalho no pool principal, então os dois nunca disputam as
 * mesmas conexões, e uma rajada de pagamentos não esgota o pool da API.
 */
@Injectable()
export class ItemLocks implements OnApplicationShutdown {
  private readonly logger = new Logger(ItemLocks.name);
  private readonly pool: pg.Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: MAX_HOLDERS,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 10_000,
    });
    this.pool.on('error', (err) => this.logger.error({ err }, 'Erro em conexão ociosa das travas'));
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      } catch (err) {
        if ((err as { code?: string }).code === '55P03') throw paymentInProgress();
        throw err;
      }
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw err;
    } finally {
      client.release(broken);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

import { Logger } from '@nestjs/common';
import type { BetterAuthOptions } from 'better-auth';
import type { Redis } from 'ioredis';

export type RateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions['rateLimit']>['customStorage']
>;

type RateLimitResult = { allowed: boolean; retryAfter: number | null };

/**
 * O storage do Better Auth, com `cost` opcional: quanto a chamada consome da janela (padrão 1).
 * Ex.: o lote de eventos dos anúncios consome o número de eventos.
 */
export type RedisRateLimitStorage = RateLimitStorage & {
  consume(
    key: string,
    rule: { window: number; max: number },
    cost?: number,
  ): Promise<RateLimitResult>;
};

/** Prefixo das chaves no Redis; o Better Auth monta a chave como `<ip>|<caminho>`. */
export const RATE_LIMIT_KEY_PREFIX = 'auth:rate-limit:';

/**
 * Rate limit do Better Auth no Redis, compartilhado entre as instâncias da API: janela fixa por
 * chave, com o contador e o TTL criados na mesma transação (MULTI), sem corrida entre instâncias.
 *
 * Se o Redis cair, a requisição passa (fail-open) e o log avisa: o login não para por falta do
 * Redis, mas fica sem limite enquanto ele não volta.
 */
export function redisRateLimitStorage(redis: Redis): RedisRateLimitStorage {
  const logger = new Logger('AuthRateLimit');
  // Loga só a transição para erro, para não inundar o log durante uma queda.
  let healthy = true;

  return {
    async consume(
      key: string,
      { window, max }: { window: number; max: number },
      cost: number = 1,
    ): Promise<RateLimitResult> {
      const redisKey = `${RATE_LIMIT_KEY_PREFIX}${key}`;
      try {
        const results = await redis
          .multi()
          .set(redisKey, 0, 'EX', window, 'NX')
          .incrby(redisKey, Math.max(1, Math.trunc(cost)))
          .pttl(redisKey)
          .exec();
        const failed = !results || results.some(([err]) => err);
        if (failed) throw results?.find(([err]) => err)?.[0] ?? new Error('MULTI abortado');
        healthy = true;

        const count = Number(results[1]?.[1]);
        if (count <= max) return { allowed: true, retryAfter: null };
        const ttlMs = Number(results[2]?.[1]);
        return { allowed: false, retryAfter: ttlMs > 0 ? Math.ceil(ttlMs / 1000) : window };
      } catch (err) {
        if (healthy) logger.warn({ err }, 'Rate limit sem Redis: requisições liberadas');
        healthy = false;
        return { allowed: true, retryAfter: null };
      }
    },
  };
}

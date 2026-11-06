import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { redisRateLimitStorage } from '../auth/redis-rate-limit.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { REDIS } from '../infra/redis.module.js';
import { withinRedisBudget } from '../infra/redis-budget.js';
import { tooManyRequests } from '../me/me.errors.js';

export type RateLimitRule = { window: number; max: number };

/**
 * Limite das rotas públicas do convite e do descadastro e da confirmação de vínculo: janela fixa
 * no Redis, ligada por AUTH_RATE_LIMIT_ENABLED. Sem Redis, a requisição passa (como no login).
 */
@Injectable()
export class RateLimiter {
  private readonly storage;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) redis: Redis,
  ) {
    this.storage = redisRateLimitStorage(redis);
  }

  /** `cost`: quanto a chamada consome da janela (padrão 1). */
  async consume(key: string, rule: RateLimitRule, cost = 1): Promise<void> {
    if (!this.env.AUTH_RATE_LIMIT_ENABLED) return;
    const { allowed, retryAfter } = await withinRedisBudget(
      Promise.resolve(this.storage.consume(key, rule, cost)),
    ).catch(() => ({ allowed: true, retryAfter: null }));
    if (!allowed) throw tooManyRequests({ retryAfter });
  }
}

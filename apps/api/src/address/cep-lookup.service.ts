import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CepAddress, cepAddressSchema, normalizeCep } from '@space-sports/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { redisRateLimitStorage } from '../auth/redis-rate-limit.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { REDIS } from '../infra/redis.module.js';
import { withinRedisBudget } from '../infra/redis-budget.js';
import { tooManyRequests } from '../me/me.errors.js';
import { cepInvalid, cepLookupUnavailable, cepNotFound } from './address.errors.js';
import { CEP_PROVIDERS } from './cep-providers.js';

const DAY_SEC = 24 * 60 * 60;

export const CEP_CACHE_PREFIX = 'address:cep:';
export const CEP_FOUND_TTL_SEC = 30 * DAY_SEC;
export const CEP_NOT_FOUND_TTL_SEC = DAY_SEC;
/** Por usuário: um formulário de endereço faz poucas buscas. */
export const CEP_RATE_LIMIT = { window: 60, max: 30 } as const;
/** `address` nulo: o CEP não existe. */
const cachedSchema = z.object({ address: cepAddressSchema.nullable() });

/**
 * Busca de endereço por CEP (decisão 52). O resultado, inclusive o "não encontrado", fica no
 * Redis; sem Redis, a busca segue direto nos provedores, sem cache e sem limite de taxa. A falha
 * dos provedores não é guardada.
 */
@Injectable()
export class CepLookupService {
  private readonly logger = new Logger(CepLookupService.name);
  private readonly rateLimit;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.rateLimit = redisRateLimitStorage(redis);
  }

  async lookup(userId: string, value: string): Promise<CepAddress> {
    await this.consumeRateLimit(userId);
    const cep = normalizeCep(value);
    if (!cep) throw cepInvalid();

    const cached = await this.readCache(cep);
    const address = cached ? cached.address : await this.fromProviders(cep);
    if (!address) throw cepNotFound();
    return address;
  }

  private async fromProviders(cep: string): Promise<CepAddress | null> {
    for (const provider of CEP_PROVIDERS) {
      try {
        const address = await provider.lookup(cep);
        await this.writeCache(cep, address);
        return address;
      } catch (err) {
        this.logger.warn({ err, provider: provider.name }, 'Provedor de CEP indisponível');
      }
    }
    throw cepLookupUnavailable();
  }

  private async readCache(cep: string): Promise<z.infer<typeof cachedSchema> | null> {
    try {
      const raw = await withinRedisBudget(this.redis.get(`${CEP_CACHE_PREFIX}${cep}`));
      return raw ? cachedSchema.parse(JSON.parse(raw)) : null;
    } catch (err) {
      this.logger.warn({ err }, 'Falha ao ler o cache de CEP');
      return null;
    }
  }

  private async writeCache(cep: string, address: CepAddress | null): Promise<void> {
    const ttl = address ? CEP_FOUND_TTL_SEC : CEP_NOT_FOUND_TTL_SEC;
    try {
      await withinRedisBudget(
        this.redis.set(`${CEP_CACHE_PREFIX}${cep}`, JSON.stringify({ address }), 'EX', ttl),
      );
    } catch (err) {
      this.logger.warn({ err }, 'Falha ao gravar o cache de CEP');
    }
  }

  private async consumeRateLimit(userId: string): Promise<void> {
    if (!this.env.AUTH_RATE_LIMIT_ENABLED) return;
    const { allowed, retryAfter } = await withinRedisBudget(
      Promise.resolve(this.rateLimit.consume(`user:${userId}|/address/cep`, CEP_RATE_LIMIT)),
    ).catch(() => ({ allowed: true, retryAfter: null }));
    if (!allowed) throw tooManyRequests({ retryAfter });
  }
}

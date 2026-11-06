import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SuggestedUser } from '@space-sports/shared';
import type { Redis } from 'ioredis';
import type { DbOrTx } from '../bookings/db-utils.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';
import { withinRedisBudget } from '../infra/redis-budget.js';
import { firstName } from '../users/normalize.js';
import { accountsByPhone } from './contact-store.js';

export const PHONE_LOOKUP_KEY_PREFIX = 'contacts:phone-lookup:';

/** Telefones distintos consultados por pessoa, por hora. Rever a mesma reserva não gasta cota. */
export const PHONE_LOOKUP_LIMITS = {
  organizer: { window: 60 * 60, max: 30 },
  staff: { window: 60 * 60, max: 120 },
} as const;

export type PhoneLookupScope = keyof typeof PHONE_LOOKUP_LIMITS;

/**
 * Conta sugerida pelo telefone (RF-CONTACT-05). Quem convida escolhe o número, então a resposta
 * revelaria quem tem conta: a cota por pessoa é o que impede a enumeração. Passou da cota ou o
 * Redis caiu, a sugestão some sem erro: o detalhe da reserva continua respondendo e quem testa
 * números não distingue "sem conta" de "sem cota".
 */
@Injectable()
export class PhoneSuggestions {
  private readonly logger = new Logger(PhoneSuggestions.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Telefone → conta sugerida. */
  async find(
    scope: PhoneLookupScope,
    viewerId: string,
    phones: string[],
    db: DbOrTx = this.db,
  ): Promise<Map<string, SuggestedUser>> {
    const distinct = [...new Set(phones)];
    if (!distinct.length) return new Map();
    const admitted = await this.admit(scope, viewerId, distinct);
    const accounts = await accountsByPhone(db, admitted);
    return new Map(
      accounts.map(({ id, name, phone }) => [phone, { id, firstName: firstName(name) }]),
    );
  }

  private async admit(
    scope: PhoneLookupScope,
    viewerId: string,
    phones: string[],
  ): Promise<string[]> {
    if (!this.env.AUTH_RATE_LIMIT_ENABLED) return phones;
    const key = `${PHONE_LOOKUP_KEY_PREFIX}${scope}:${viewerId}`;
    const admitted: string[] = [];
    try {
      for (const phone of phones) {
        if (await withinRedisBudget(this.admitOne(key, phone, PHONE_LOOKUP_LIMITS[scope]))) {
          admitted.push(phone);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Sugestão de conta sem Redis: nenhuma consulta nova');
    }
    return admitted;
  }

  /** Conta na cota. O telefone só fica no conjunto (e em hash) se couber: o teto é exato. */
  private async admitOne(
    key: string,
    phone: string,
    rule: { window: number; max: number },
  ): Promise<boolean> {
    const member = createHash('sha256').update(phone).digest('hex');
    const results = await this.redis
      .multi()
      .sadd(key, member)
      .expire(key, rule.window, 'NX')
      .scard(key)
      .exec();
    const failed = !results || results.some(([err]) => err);
    if (failed) throw results?.find(([err]) => err)?.[0] ?? new Error('MULTI abortado');
    const isNew = Number(results[0]?.[1]) === 1;
    if (!isNew || Number(results[2]?.[1]) <= rule.max) return true;
    await this.redis.srem(key, member);
    return false;
  }
}

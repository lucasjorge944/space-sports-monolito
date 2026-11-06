import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { redisRateLimitStorage } from './redis-rate-limit.js';

/** Redis falso: só o MULTI que o storage usa (guarda o incremento pedido). */
function fakeRedis(exec: () => Promise<unknown>, increments: number[] = []) {
  const chain = {
    set: () => chain,
    incrby: (_key: string, by: number) => {
      increments.push(by);
      return chain;
    },
    pttl: () => chain,
    exec,
  };
  return { multi: () => chain } as unknown as Redis;
}

describe('redisRateLimitStorage', () => {
  const rule = { window: 10, max: 3 };

  it('libera até o máximo e depois devolve o tempo restante da janela', async () => {
    const allowed = redisRateLimitStorage(
      fakeRedis(async () => [
        [null, 'OK'],
        [null, 3],
        [null, 9_000],
      ]),
    );
    expect(await allowed.consume('ip|/sign-in/email', rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });

    const blocked = redisRateLimitStorage(
      fakeRedis(async () => [
        [null, null],
        [null, 4],
        [null, 7_200],
      ]),
    );
    expect(await blocked.consume('ip|/sign-in/email', rule)).toEqual({
      allowed: false,
      retryAfter: 8,
    });
  });

  it('consome o custo pedido (padrão 1)', async () => {
    const increments: number[] = [];
    const storage = redisRateLimitStorage(
      fakeRedis(
        async () => [
          [null, 'OK'],
          [null, 1],
          [null, 9_000],
        ],
        increments,
      ),
    );
    await storage.consume('ip|/ads/events', rule);
    await storage.consume('ip|/ads/events', rule, 25);
    await storage.consume('ip|/ads/events', rule, 0);
    expect(increments).toEqual([1, 25, 1]);
  });

  it('com o Redis fora do ar, libera a requisição (fail-open)', async () => {
    const down = redisRateLimitStorage(
      fakeRedis(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await down.consume('ip|/sign-in/email', rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });

    const commandError = redisRateLimitStorage(
      fakeRedis(async () => [
        [new Error('OOM'), null],
        [null, 99],
        [null, 1_000],
      ]),
    );
    expect((await commandError.consume('ip|/sign-in/email', rule)).allowed).toBe(true);
  });
});

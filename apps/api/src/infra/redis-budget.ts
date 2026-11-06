/** Com o Redis fora do ar, a fila de reconexão do ioredis levaria segundos por comando. */
const REDIS_BUDGET_MS = 250;

export function withinRedisBudget<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis sem resposta.')), REDIS_BUDGET_MS);
  });
  return Promise.race([operation, expired]).finally(() => clearTimeout(timer));
}

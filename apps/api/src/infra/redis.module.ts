import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const logger = new Logger('Redis');
        const client = new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3_000,
        });
        // Loga só a transição para erro, para não inundar o log a cada tentativa de reconexão.
        let healthy = true;
        client.on('ready', () => {
          healthy = true;
        });
        client.on('error', (err) => {
          if (healthy) logger.warn({ err }, 'Falha na conexão com o Redis');
          healthy = false;
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}

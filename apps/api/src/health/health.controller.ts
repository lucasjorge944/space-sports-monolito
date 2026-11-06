import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { Public } from '../auth/decorators.js';
import { AppException } from '../common/app.exception.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { PG_POOL } from '../infra/database.module.js';
import { REDIS } from '../infra/redis.module.js';

const CHECK_TIMEOUT_MS = 3_000;

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck({ swaggerDocumentation: true, noCache: true })
  @ApiOperation({
    operationId: 'getHealth',
    summary: 'Saúde da API e das dependências (Postgres e Redis)',
  })
  @ApiServiceUnavailableResponse({
    description: 'Alguma dependência está fora; `error.details` traz o resultado de cada checagem.',
    type: ErrorResponseDto,
  })
  async check() {
    try {
      return await this.health.check([
        () =>
          this.indicator
            .check('postgres')
            .attempt(async () => {
              await this.pool.query('SELECT 1');
            })
            .withTimeout(CHECK_TIMEOUT_MS),
        () =>
          this.indicator
            .check('redis')
            .attempt(async () => {
              if (this.redis.status === 'wait' || this.redis.status === 'end')
                await this.redis.connect();
              await this.redis.ping();
            })
            .withTimeout(CHECK_TIMEOUT_MS),
      ]);
    } catch (err) {
      if (!(err instanceof ServiceUnavailableException)) throw err;
      // A resposta do terminus traz as mensagens cruas dos drivers (host, usuário do banco):
      // vão só para o log; o cliente recebe apenas o status de cada dependência.
      const result = err.getResponse() as HealthCheckResult;
      this.logger.warn({ health: result }, 'Health check falhou');
      throw new AppException({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'HEALTH_CHECK_FAILED',
        message: 'Uma ou mais dependências estão indisponíveis.',
        details: statusOnly(result),
      });
    }
  }
}

function statusOnly(result: HealthCheckResult): Record<string, { status: string }> {
  return Object.fromEntries(
    Object.entries(result.details).map(([key, { status }]) => [key, { status }]),
  );
}

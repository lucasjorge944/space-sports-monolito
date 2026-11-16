import { HttpStatus } from '@nestjs/common';
import { ANALYTICS_MAX_RANGE_DAYS } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

// Códigos estáveis dos erros da camada de métricas (o cliente trata por eles).

/** RN-MCP-09: até 366 dias por consulta (datas locais, inclusive). */
export const analyticsPeriodTooLong = () =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'ANALYTICS_PERIOD_TOO_LONG',
    message: `Consulte no máximo ${ANALYTICS_MAX_RANGE_DAYS} dias por vez.`,
    details: { maxDays: ANALYTICS_MAX_RANGE_DAYS },
  });

/** Só `from`, no futuro: o fim padrão (hoje) ficaria antes do início. */
export const analyticsPeriodInverted = () =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'ANALYTICS_PERIOD_INVALID',
    message: 'O fim do período (`to`, padrão hoje) não pode ser anterior ao início (`from`).',
  });

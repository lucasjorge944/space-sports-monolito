import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { type FinanceQuery, type FinanceSummary, financeQuerySchema } from '@space-sports/shared';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { FinanceService, periodOf } from './finance.service.js';
import { superSchemas as schemas } from './super.openapi.js';

/** Financeiro consolidado: só leitura sobre os pagamentos que os espaços registram (RF-SUPER-05). */
@ApiTags('super-finance')
@ApiAuth()
@SuperOnly()
@Controller('super/finance')
export class SuperFinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  @ApiOperation({
    operationId: 'superFinanceSummary',
    summary: 'Recebido por espaço, serviço e forma de pagamento',
    description:
      'Período por data local (America/Sao_Paulo, inclusive); padrão: dia 1 do mês até hoje. Pagamentos estornados não entram em "recebido" (aparecem em `totals.reversedCents`). `byService`: `RENTAL` (reservas, participantes e mensalidades antigas de mensalista), `CLASSES`, `TOURNAMENTS`. `byChannel`: no local (`ON_SITE`) × online (`ONLINE`, pago pelo app; valor líquido de estornos, decisão 93). Valores em centavos.',
  })
  @ApiZodQuery(financeQuerySchema)
  @ApiZodResponse(schemas.financeSummary)
  summary(
    @Query(new ZodValidationPipe(financeQuerySchema)) query: FinanceQuery,
  ): Promise<FinanceSummary> {
    return this.service.summary(query);
  }

  @Get('payments.csv')
  @ApiOperation({
    operationId: 'superFinanceExportCsv',
    summary: 'Exportar os registros de pagamento do período em CSV',
    description:
      'Um registro por linha (inclusive estornados, com `estornado_em_utc`), em UTF-8 com BOM e vírgula como separador, com datas em dd/mm/aaaa. Colunas: id, pago_em_utc, pago_em_local, espaco, servico, tipo, forma, canal (`no_local` ou `online`), valor_centavos, estornado_em_utc. Sem dados pessoais dos pagadores. Cada exportação fica na auditoria (`super.finance.export_csv`, com o período e o espaço filtrado).',
  })
  @ApiZodQuery(financeQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(financeQuerySchema)) query: FinanceQuery,
    @Res() res: Response,
  ): Promise<void> {
    await this.service.auditExport(user.id, query);
    const { from, to } = periodOf(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pagamentos-${from}_${to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(Readable.from(this.service.exportCsv(query)), res);
  }
}

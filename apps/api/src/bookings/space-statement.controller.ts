import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type Statement,
  type StatementFilters,
  type StatementQuery,
  statementEntrySchema,
  statementFiltersSchema,
  statementQuerySchema,
  statementSchema,
  statementServiceSchema,
} from '@space-sports/shared';
import type { Response } from 'express';
import { ApiAuth, SpacePermission } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodQuery, ApiZodResponse, openApiSchema } from '../openapi/zod-openapi.js';
import { StatementService } from './statement.service.js';

for (const io of ['input', 'output'] as const) {
  openApiSchema(statementServiceSchema, 'StatementService', io);
}
openApiSchema(statementEntrySchema, 'StatementEntry', 'output');
openApiSchema(statementSchema, 'Statement', 'output');

const FILTERS_DESCRIPTION =
  'Período por `paid_at` em UTC, meio-aberto: `from` ≤ pago < `to` (ISO 8601 com fuso). `service`: `RENTAL` (reserva e partes da conta dividida), `RECURRING` (mensalidade do mensalista) ou `CLASS`; `method`: forma de pagamento; `channel`: `ON_SITE` (registrado no espaço) ou `ONLINE` (pago pelo app, RN-ONPAY-04). O pagamento online entra pelo valor líquido de estornos (decisão 93).';

/** Extrato de recebimentos do espaço (RF-PAY-03), com as permissões de "a receber hoje". */
@ApiTags('space-bookings')
@ApiAuth()
@Controller('manage/spaces/:spaceId')
export class SpaceStatementController {
  constructor(private readonly service: StatementService) {}

  @Get('statement')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'getSpaceStatement',
    summary: 'Extrato de recebimentos do período',
    description: `RF-PAY-03. ${FILTERS_DESCRIPTION} Os itens vêm do mais recente para o mais antigo, paginados por cursor, e incluem os estornados (com \`reversedAt\`). \`totals\` e \`byMethod\` valem para o período e filtros inteiros (todas as páginas) e não contam os estornados, que vão em \`totals.reversedCents\`. Valores em centavos. Cursor inválido: 400 \`INVALID_CURSOR\`.`,
  })
  @ApiZodQuery(statementQuerySchema)
  @ApiZodResponse(statementSchema)
  statement(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery,
  ): Promise<Statement> {
    return this.service.statement(spaceId, query);
  }

  @Get('statement.csv')
  @SpacePermission('payment.record')
  @ApiOperation({
    operationId: 'exportSpaceStatementCsv',
    summary: 'Exportar o extrato do período em CSV',
    description: `RF-PAY-03. ${FILTERS_DESCRIPTION} Um registro por linha, em ordem cronológica, inclusive estornados (com \`estornado_em_utc\`); UTF-8 com BOM e vírgula como separador. Datas em dd/mm/aaaa (\`mensalidade_mes\` em mm/aaaa); as locais, no fuso do espaço. Colunas: id, pago_em_utc, pago_em_local, servico, tipo, forma, canal (\`no_local\` ou \`online\`), valor_centavos, pagador, quadra, reserva_inicio_local, mensalidade_mes, registrado_por, observacao, estornado_em_utc.`,
  })
  @ApiZodQuery(statementFiltersSchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportCsv(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(statementFiltersSchema)) filters: StatementFilters,
    @Res() res: Response,
  ): Promise<void> {
    const day = (date: Date) => date.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="extrato-${day(filters.from)}_${day(filters.to)}.csv"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(Readable.from(this.service.exportCsv(spaceId, filters)), res);
  }
}

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Body, Controller, Delete, Get, Param, Put, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type MonthlyFeeReport,
  type MonthlyFeeReportQuery,
  monthlyFeeReportQuerySchema,
  type PlatformFees,
  type PlatformRevenue,
  type PlatformRevenueQuery,
  platformRevenueQuerySchema,
  type SuperMerchantAccountList,
  type SuperMerchantAccountsQuery,
  superMerchantAccountsQuerySchema,
  type UpdateDefaultFeesInput,
  type UpdateSpaceFeesInput,
  updateDefaultFeesSchema,
  updateSpaceFeesSchema,
} from '@space-sports/shared';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { spaceNotFound } from '../spaces/spaces.errors.js';
import { MerchantAccountsService } from './merchant-accounts.service.js';
import { paymentSchemas as schemas } from './payments.openapi.js';
import { revenuePeriod, SuperPaymentsService } from './super-payments.service.js';

const csvHeaders = (res: Response, filename: string) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
};

/**
 * Pagamento online no Super (RF-ONPAY-10 e 11): taxas padrão e por espaço, cadastros no gateway e
 * receita da plataforma, com o relatório mensal para a NFS-e. Só o papel da plataforma.
 */
@ApiTags('super-online-payments')
@ApiAuth()
@SuperOnly()
@Controller('super/online-payments')
export class SuperOnlinePaymentsController {
  constructor(
    private readonly service: SuperPaymentsService,
    private readonly merchants: MerchantAccountsService,
  ) {}

  @Get('fees')
  @ApiOperation({
    operationId: 'superGetPaymentFees',
    summary: 'Taxa padrão e condições por espaço',
    description:
      'RF-ONPAY-10, decisão 83: Pix e cartão em pontos-base, mínimo em centavos, quem paga (`SPACE`) e quem alterou por último; os espaços com taxa própria (campo nulo = padrão) e o ambiente de pagamento.',
  })
  @ApiZodResponse(schemas.fees)
  fees(): Promise<PlatformFees> {
    return this.service.fees();
  }

  @Put('fees')
  @ApiOperation({
    operationId: 'superUpdateDefaultPaymentFees',
    summary: 'Alterar a taxa padrão',
    description:
      'Vale para as cobranças criadas daqui em diante (as já criadas guardam a taxa da época). `feePayer` diferente de `SPACE`: 422 `FEE_PAYER_NOT_ALLOWED` (decisão 82). Auditado: `super.payment_fee.update_default`.',
  })
  @ApiZodBody(schemas.updateDefaultFees)
  @ApiZodResponse(schemas.fees)
  updateDefaults(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateDefaultFeesSchema)) body: UpdateDefaultFeesInput,
  ): Promise<PlatformFees> {
    return this.service.updateDefaults(user.id, body);
  }

  @Put('fees/spaces/:spaceId')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superUpdateSpacePaymentFees',
    summary: 'Definir a taxa própria de um espaço',
    description:
      'Campo nulo = taxa padrão naquele campo. `feePayer: PLAYER`: 422 `FEE_PAYER_NOT_ALLOWED`. Espaço inexistente: 404 `SPACE_NOT_FOUND`. Auditado: `super.payment_fee.update_space`.',
  })
  @ApiZodBody(schemas.updateSpaceFees)
  @ApiZodResponse(schemas.fees)
  updateSpace(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
    @Body(new ZodValidationPipe(updateSpaceFeesSchema)) body: UpdateSpaceFeesInput,
  ): Promise<PlatformFees> {
    return this.service.updateSpace(user.id, spaceId, body);
  }

  @Delete('fees/spaces/:spaceId')
  @ApiUuidParam('spaceId')
  @ApiOperation({
    operationId: 'superRemoveSpacePaymentFees',
    summary: 'Voltar o espaço à taxa padrão',
    description: 'Auditado: `super.payment_fee.update_space` (todos os campos nulos).',
  })
  @ApiZodResponse(schemas.fees)
  removeSpace(
    @CurrentUser() user: AuthUser,
    @Param('spaceId', new UuidParamPipe(spaceNotFound)) spaceId: string,
  ): Promise<PlatformFees> {
    return this.service.updateSpace(user.id, spaceId, {
      pixFeeBps: null,
      cardFeeBps: null,
      minFeeCents: null,
      feePayer: null,
    });
  }

  @Get('merchant-accounts')
  @ApiOperation({
    operationId: 'superListMerchantAccounts',
    summary: 'Cadastros no gateway por status',
    description: 'RF-ONPAY-10: com o documento e a conta mascarados.',
  })
  @ApiZodQuery(superMerchantAccountsQuerySchema)
  @ApiZodResponse(schemas.merchants)
  merchantAccounts(
    @Query(new ZodValidationPipe(superMerchantAccountsQuerySchema))
    query: SuperMerchantAccountsQuery,
  ): Promise<SuperMerchantAccountList> {
    return this.merchants.listForSuper(query);
  }

  @Get('revenue')
  @ApiOperation({
    operationId: 'superGetPlatformRevenue',
    summary: 'Receita da plataforma',
    description:
      'RF-ONPAY-11: cobranças pagas no período (data local de America/Sao_Paulo, inclusiva; padrão do dia 1 do mês até hoje), por espaço, meio e mês: volume, taxa bruta, tarifa do gateway, taxa devolvida e receita líquida (taxa − tarifa − taxa devolvida).',
  })
  @ApiZodQuery(platformRevenueQuerySchema)
  @ApiZodResponse(schemas.revenue)
  revenue(
    @Query(new ZodValidationPipe(platformRevenueQuerySchema)) query: PlatformRevenueQuery,
  ): Promise<PlatformRevenue> {
    return this.service.revenue(query);
  }

  @Get('revenue.csv')
  @ApiOperation({
    operationId: 'superExportPlatformRevenueCsv',
    summary: 'Exportar a receita por espaço em CSV',
    description:
      'Colunas: espaco_id, espaco, cobrancas, volume_centavos, taxa_bruta_centavos, tarifa_gateway_centavos, taxa_devolvida_centavos, receita_liquida_centavos. Auditado: `super.payment_revenue.export_csv`.',
  })
  @ApiZodQuery(platformRevenueQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async revenueCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(platformRevenueQuerySchema)) query: PlatformRevenueQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { from, to } = revenuePeriod(query);
    csvHeaders(res, `receita-pagamentos-${from}_${to}.csv`);
    await pipeline(Readable.from(this.service.revenueCsv(user.id, query)), res);
  }

  @Get('reports/monthly')
  @ApiOperation({
    operationId: 'superGetMonthlyFeeReport',
    summary: 'Relatório mensal de taxas por espaço (NFS-e)',
    description:
      'Decisão 91: por espaço, a taxa bruta, a devolvida e a base da nota, com o documento completo do cadastro no gateway (o único lugar em que ele aparece). Cada leitura fica na auditoria: `super.payment_report.view`.',
  })
  @ApiZodQuery(monthlyFeeReportQuerySchema)
  @ApiZodResponse(schemas.monthlyReport)
  monthlyReport(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(monthlyFeeReportQuerySchema)) query: MonthlyFeeReportQuery,
  ): Promise<MonthlyFeeReport> {
    return this.service.monthlyReport(user.id, query.month);
  }

  @Get('reports/monthly.csv')
  @ApiOperation({
    operationId: 'superExportMonthlyFeeReportCsv',
    summary: 'Exportar o relatório mensal de taxas (NFS-e) em CSV',
    description:
      'Colunas: mes, espaco, razao_social, tipo_documento, documento (completo), taxa_bruta_centavos, taxa_devolvida_centavos, base_nota_centavos. Auditado: `super.payment_report.export_csv`.',
  })
  @ApiZodQuery(monthlyFeeReportQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async monthlyReportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(monthlyFeeReportQuerySchema)) query: MonthlyFeeReportQuery,
    @Res() res: Response,
  ): Promise<void> {
    csvHeaders(res, `taxas-nfse-${query.month}.csv`);
    await pipeline(Readable.from(this.service.monthlyReportCsv(user.id, query.month)), res);
  }
}

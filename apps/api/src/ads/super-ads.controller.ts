import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AdCampaign,
  type AdCampaignDetail,
  type AdCampaignList,
  type AdCampaignStatusChange,
  type AdCampaignsQuery,
  type AdCreative,
  type AdImageUpload,
  type AdReport,
  type AdReportQuery,
  type Advertiser,
  type AdvertiserList,
  type AdvertisersQuery,
  adCampaignStatusChangeSchema,
  adCampaignsQuerySchema,
  adReportQuerySchema,
  advertisersQuerySchema,
  type CreateAdCampaign,
  type CreateAdCreative,
  type CreateAdImageUpload,
  type CreateAdvertiser,
  createAdCampaignSchema,
  createAdCreativeSchema,
  createAdImageUploadSchema,
  createAdvertiserSchema,
  type ReorderAdCreatives,
  reorderAdCreativesSchema,
  type UpdateAdCampaign,
  type UpdateAdCreative,
  type UpdateAdvertiser,
  updateAdCampaignSchema,
  updateAdCreativeSchema,
  updateAdvertiserSchema,
} from '@space-sports/shared';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, SuperOnly } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { advertiserNotFound, campaignNotFound, creativeNotFound } from './ads.errors.js';
import { adsSchemas as schemas } from './ads.openapi.js';
import { AdvertiserBodyPipe } from './advertiser-body.pipe.js';
import { AdvertisersService } from './advertisers.service.js';
import { AdCampaignsService } from './campaigns.service.js';
import { AdCreativesService } from './creatives.service.js';
import { AdReportService, REPORT_CSV_COLUMNS } from './report.service.js';

const advertiserId = () => Param('advertiserId', new UuidParamPipe(advertiserNotFound));
const campaignId = () => Param('campaignId', new UuidParamPipe(campaignNotFound));
const creativeId = () => Param('creativeId', new UuidParamPipe(creativeNotFound));

const IMAGE_ERRORS =
  '`AD_IMAGE_KEY_INVALID`, `AD_IMAGE_NOT_UPLOADED`, `AD_IMAGE_TOO_LARGE`, `AD_IMAGE_INVALID`, `AD_IMAGE_WRONG_ASPECT` e `AD_IMAGE_TOO_SMALL` (422, com `details` de tamanho e formato), `AD_IMAGE_REQUIRED` (422), `AD_DESTINATION_SPACE_NOT_FOUND` (422) e `STORAGE_UNAVAILABLE` (503).';

/**
 * Anúncios no painel Super (RF-ADS-01, 02, 03 e 09; decisões 73 a 76). Só o papel da plataforma
 * (RN-ADS-02): nem o painel do espaço nem o espaço anunciante veem nada daqui. Tudo que escreve
 * vai para a auditoria (RN-ADS-06).
 */
@ApiTags('super-ads')
@ApiAuth()
@SuperOnly()
@Controller('super/ads')
export class SuperAdsController {
  constructor(
    private readonly advertisers: AdvertisersService,
    private readonly campaigns: AdCampaignsService,
    private readonly creatives: AdCreativesService,
    private readonly reports: AdReportService,
  ) {}

  // Anunciantes ------------------------------------------------------------------------------------

  @Get('advertisers')
  @ApiOperation({ operationId: 'superListAdvertisers', summary: 'Anunciantes (busca e filtros)' })
  @ApiZodQuery(advertisersQuerySchema)
  @ApiZodResponse(schemas.advertiserList)
  listAdvertisers(
    @Query(new ZodValidationPipe(advertisersQuerySchema)) query: AdvertisersQuery,
  ): Promise<AdvertiserList> {
    return this.advertisers.list(query);
  }

  @Get('advertisers/:advertiserId')
  @ApiUuidParam('advertiserId')
  @ApiOperation({ operationId: 'superGetAdvertiser', summary: 'Anunciante' })
  @ApiZodResponse(schemas.advertiser)
  getAdvertiser(@advertiserId() id: string): Promise<Advertiser> {
    return this.advertisers.get(id);
  }

  @Post('advertisers')
  @ApiOperation({
    operationId: 'superCreateAdvertiser',
    summary: 'Criar anunciante',
    description:
      'Empresa (`COMPANY`) ou espaço parceiro (`SPACE`, com `spaceId` de espaço ativo; decisão 74). Erros: `AD_CATEGORY_FORBIDDEN` (422, apostas e bebidas alcoólicas, RN-ADS-01), `AD_SPACE_NOT_FOUND` (422), `ADVERTISER_SPACE_TAKEN` (409, o espaço já tem anunciante ativo). Auditado: `super.advertiser.create`.',
  })
  @ApiZodBody(schemas.createAdvertiser)
  @ApiZodResponse(schemas.advertiser, HttpStatus.CREATED)
  createAdvertiser(
    @CurrentUser() user: AuthUser,
    @Body(new AdvertiserBodyPipe(createAdvertiserSchema)) body: CreateAdvertiser,
  ): Promise<Advertiser> {
    return this.advertisers.create(user.id, body);
  }

  @Patch('advertisers/:advertiserId')
  @ApiUuidParam('advertiserId')
  @ApiOperation({
    operationId: 'superUpdateAdvertiser',
    summary: 'Editar, ativar ou desativar anunciante',
    description:
      'Tipo e espaço não mudam. `active: false` tira do ar todas as campanhas do anunciante. Erros: `AD_CATEGORY_FORBIDDEN` (422), `ADVERTISER_SPACE_TAKEN` (409, ao reativar). Auditado: `super.advertiser.update`, `super.advertiser.activate` e `super.advertiser.deactivate`.',
  })
  @ApiZodBody(schemas.updateAdvertiser)
  @ApiZodResponse(schemas.advertiser)
  updateAdvertiser(
    @CurrentUser() user: AuthUser,
    @advertiserId() id: string,
    @Body(new AdvertiserBodyPipe(updateAdvertiserSchema)) body: UpdateAdvertiser,
  ): Promise<Advertiser> {
    return this.advertisers.update(user.id, id, body);
  }

  // Campanhas --------------------------------------------------------------------------------------

  @Get('campaigns')
  @ApiOperation({
    operationId: 'superListAdCampaigns',
    summary: 'Campanhas (filtros e situação "no ar")',
    description:
      'Cada campanha traz `delivery.onAir` e, fora do ar, os motivos (`NOT_ACTIVE`, `NOT_STARTED`, `ENDED`, `ADVERTISER_INACTIVE`, `NO_CREATIVES`). Mais novas primeiro.',
  })
  @ApiZodQuery(adCampaignsQuerySchema)
  @ApiZodResponse(schemas.campaignList)
  listCampaigns(
    @Query(new ZodValidationPipe(adCampaignsQuerySchema)) query: AdCampaignsQuery,
  ): Promise<AdCampaignList> {
    return this.campaigns.list(query);
  }

  @Get('campaigns/:campaignId')
  @ApiUuidParam('campaignId')
  @ApiOperation({ operationId: 'superGetAdCampaign', summary: 'Campanha com as peças' })
  @ApiZodResponse(schemas.campaignDetail)
  getCampaign(@campaignId() id: string): Promise<AdCampaignDetail> {
    return this.campaigns.get(id);
  }

  @Post('campaigns')
  @ApiOperation({
    operationId: 'superCreateAdCampaign',
    summary: 'Criar campanha',
    description:
      'Datas em UTC. Cidades e esportes vazios = todos. Erros: `ADVERTISER_NOT_FOUND` (404), `AD_CITY_NOT_FOUND` e `AD_SPORT_NOT_FOUND` (422). Auditado: `super.ad_campaign.create`.',
  })
  @ApiZodBody(schemas.createCampaign)
  @ApiZodResponse(schemas.campaign, HttpStatus.CREATED)
  createCampaign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAdCampaignSchema)) body: CreateAdCampaign,
  ): Promise<AdCampaign> {
    return this.campaigns.create(user.id, body);
  }

  @Patch('campaigns/:campaignId')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superUpdateAdCampaign',
    summary: 'Editar campanha',
    description:
      'Erros: `AD_INVALID_PERIOD` (422), `AD_PLACEMENT_LOCKED` (409, a vaga só muda sem peças), `AD_CITY_NOT_FOUND` e `AD_SPORT_NOT_FOUND` (422). Auditado: `super.ad_campaign.update`.',
  })
  @ApiZodBody(schemas.updateCampaign)
  @ApiZodResponse(schemas.campaign)
  updateCampaign(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @Body(new ZodValidationPipe(updateAdCampaignSchema)) body: UpdateAdCampaign,
  ): Promise<AdCampaign> {
    return this.campaigns.update(user.id, id, body);
  }

  @Post('campaigns/:campaignId/status')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superChangeAdCampaignStatus',
    summary: 'Mudar o status da campanha',
    description:
      '`DRAFT` → `ACTIVE`/`ARCHIVED`; `ACTIVE` ↔ `PAUSED`; qualquer um → `ARCHIVED` (final). Erro: `AD_INVALID_STATUS_TRANSITION` (409). Auditado: `super.ad_campaign.status`.',
  })
  @ApiZodBody(schemas.campaignStatus)
  @ApiZodResponse(schemas.campaign)
  changeCampaignStatus(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @Body(new ZodValidationPipe(adCampaignStatusChangeSchema)) body: AdCampaignStatusChange,
  ): Promise<AdCampaign> {
    return this.campaigns.changeStatus(user.id, id, body);
  }

  @Post('campaigns/:campaignId/duplicate')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superDuplicateAdCampaign',
    summary: 'Duplicar campanha',
    description:
      'Cópia em `DRAFT`, com " (cópia)" no nome, as mesmas peças e cópias das imagens. Erro: `STORAGE_UNAVAILABLE` (503) se houver imagem e o storage estiver desligado. Auditado: `super.ad_campaign.duplicate`.',
  })
  @ApiZodResponse(schemas.campaignDetail, HttpStatus.CREATED)
  duplicateCampaign(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
  ): Promise<AdCampaignDetail> {
    return this.campaigns.duplicate(user.id, id);
  }

  // Peças ------------------------------------------------------------------------------------------

  @Post('creatives/uploads')
  @ApiOperation({
    operationId: 'superCreateAdImageUpload',
    summary: 'URL pré-assinada para a imagem de uma peça',
    description:
      'Envie o arquivo com `PUT` na `uploadUrl` (header `Content-Type` igual ao pedido) e depois a `key` como `imageKey` da peça, numa campanha da mesma vaga. `format` traz a proporção, o tamanho mínimo e o máximo (2 MB). Erro: `STORAGE_UNAVAILABLE` (503).',
  })
  @ApiZodBody(schemas.createImageUpload)
  @ApiZodResponse(schemas.imageUpload, HttpStatus.CREATED)
  @ApiServiceUnavailableResponse({ description: '`STORAGE_UNAVAILABLE`.', type: ErrorResponseDto })
  createImageUpload(
    @Body(new ZodValidationPipe(createAdImageUploadSchema)) body: CreateAdImageUpload,
  ): Promise<AdImageUpload> {
    return this.creatives.createUpload(body);
  }

  @Post('campaigns/:campaignId/creatives')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superCreateAdCreative',
    summary: 'Criar peça',
    description: `Entra no fim da lista. A imagem é copiada para \`ads/<campaignId>/\` e conferida pela vaga (2:1 e 960×480 no carrossel; 4:5 e 480×600 no card; 2% de tolerância; até 2 MB). Erros: ${IMAGE_ERRORS} Auditado: \`super.ad_creative.create\`.`,
  })
  @ApiZodBody(schemas.createCreative)
  @ApiZodResponse(schemas.creative, HttpStatus.CREATED)
  createCreative(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @Body(new ZodValidationPipe(createAdCreativeSchema)) body: CreateAdCreative,
  ): Promise<AdCreative> {
    return this.creatives.create(user.id, id, body);
  }

  @Patch('campaigns/:campaignId/creatives/:creativeId')
  @ApiUuidParam('campaignId')
  @ApiUuidParam('creativeId')
  @ApiOperation({
    operationId: 'superUpdateAdCreative',
    summary: 'Editar, trocar a imagem, ativar ou desativar peça',
    description: `\`imageKey\` troca a imagem (a anterior é apagada do storage); \`null\` tira a imagem (só peça de espaço com destino no espaço). Erros: ${IMAGE_ERRORS} Auditado: \`super.ad_creative.update\`, \`super.ad_creative.activate\` e \`super.ad_creative.deactivate\`.`,
  })
  @ApiZodBody(schemas.updateCreative)
  @ApiZodResponse(schemas.creative)
  updateCreative(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @creativeId() creative: string,
    @Body(new ZodValidationPipe(updateAdCreativeSchema)) body: UpdateAdCreative,
  ): Promise<AdCreative> {
    return this.creatives.update(user.id, id, creative, body);
  }

  @Put('campaigns/:campaignId/creatives/order')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superReorderAdCreatives',
    summary: 'Ordenar as peças',
    description:
      'Todos os ids das peças da campanha, na nova ordem. Erro: `AD_INVALID_CREATIVE_ORDER` (422). Auditado: `super.ad_creative.reorder`.',
  })
  @ApiZodBody(schemas.reorderCreatives)
  @ApiZodResponse(schemas.creativeList)
  async reorderCreatives(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @Body(new ZodValidationPipe(reorderAdCreativesSchema)) body: ReorderAdCreatives,
  ): Promise<{ items: AdCreative[] }> {
    return { items: await this.creatives.reorder(user.id, id, body) };
  }

  // Relatório --------------------------------------------------------------------------------------

  @Get('campaigns/:campaignId/report')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superGetAdCampaignReport',
    summary: 'Relatório da campanha (impressões, cliques e CTR)',
    description:
      'RF-ADS-09. Dias em `America/Sao_Paulo`; padrão: do início da campanha até hoje (ou até o último dia dela). Totais, série diária (com os dias zerados) e por peça. Erro: `AD_REPORT_RANGE_TOO_LARGE` (422, mais de um ano).',
  })
  @ApiZodQuery(adReportQuerySchema)
  @ApiZodResponse(schemas.report)
  report(
    @campaignId() id: string,
    @Query(new ZodValidationPipe(adReportQuerySchema)) query: AdReportQuery,
  ): Promise<AdReport> {
    return this.reports.report(id, query);
  }

  @Get('campaigns/:campaignId/report.csv')
  @ApiUuidParam('campaignId')
  @ApiOperation({
    operationId: 'superExportAdCampaignReportCsv',
    summary: 'Exportar o relatório da campanha em CSV',
    description: `Mesmo período do relatório; um dia por linha e a linha \`total\` no fim, em UTF-8 com BOM e vírgula como separador, com datas em dd/mm/aaaa e o CTR em porcentagem. Colunas: ${REPORT_CSV_COLUMNS.join(', ')}. Cada exportação fica na auditoria (\`super.ad_campaign.export_csv\`).`,
  })
  @ApiZodQuery(adReportQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async reportCsv(
    @CurrentUser() user: AuthUser,
    @campaignId() id: string,
    @Query(new ZodValidationPipe(adReportQuerySchema)) query: AdReportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, body } = await this.reports.csv(id, query);
    await this.reports.auditExport(user.id, id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }
}

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type ContactPage,
  type ContactsExportQuery,
  type ContactsQuery,
  contactsExportQuerySchema,
  contactsQuerySchema,
  type SuperContactPage,
  type SuperContactsExportQuery,
  type SuperContactsQuery,
  superContactsExportQuerySchema,
  superContactsQuerySchema,
  type UnsubscribeContactInput,
  type UnsubscribeResult,
  unsubscribeContactSchema,
} from '@space-sports/shared';
import type { Request, Response } from 'express';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import type { AuthUser } from '../auth/auth-context.js';
import { clientIp } from '../auth/client-ip.js';
import { ApiAuth, CurrentUser, Public, SpacePermission, SuperOnly } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { contactNotFound } from './contacts.errors.js';
import { contactSchemas as schemas } from './contacts.openapi.js';
import { ContactsService } from './contacts.service.js';
import { RateLimiter, type RateLimitRule } from './rate-limiter.js';

const CSV_DESCRIPTION =
  'Com os mesmos filtros da lista; um contato por linha, em UTF-8 com BOM e vírgula como separador, com datas em dd/mm/aaaa. Colunas: nome, email, telefone, consentimento_em, origens, ultimo_contato_em, link_descadastro.';

/** Por IP: o link de descadastro é aberto uma vez, por quem recebeu a comunicação. */
export const UNSUBSCRIBE_LIMIT: RateLimitRule = { window: 60, max: 10 };

const sendCsv = async (res: Response, csv: AsyncGenerator<string>) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contatos.csv"');
  res.setHeader('Cache-Control', 'no-store');
  await pipeline(Readable.from(csv), res);
};

/** Base inteira de contatos (RF-CONTACT-06). */
@ApiTags('super-contacts')
@ApiAuth()
@SuperOnly()
@Controller('super/contacts')
export class SuperContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  @ApiOperation({
    operationId: 'superListContacts',
    summary: 'Base de contatos com filtros',
    description:
      'RF-CONTACT-06: dados globais e o que foi informado em cada espaço, com filtros por consentimento vigente, conta vinculada, origem, espaço e busca por nome, e-mail ou telefone.',
  })
  @ApiZodQuery(superContactsQuerySchema)
  @ApiZodResponse(schemas.superPage)
  list(
    @Query(new ZodValidationPipe(superContactsQuerySchema)) query: SuperContactsQuery,
  ): Promise<SuperContactPage> {
    return this.service.listForSuper(query);
  }

  @Get('export.csv')
  @ApiOperation({
    operationId: 'superExportContactsCsv',
    summary: 'Exportar os contatos com consentimento em CSV',
    description: `RF-CONTACT-06. Só contatos com consentimento e sem descadastro. ${CSV_DESCRIPTION} Cada exportação fica na auditoria (\`super.contact.export_csv\`).`,
  })
  @ApiZodQuery(superContactsExportQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(superContactsExportQuerySchema)) filters: SuperContactsExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    await this.service.auditSuperExport(user.id, filters);
    await sendCsv(res, this.service.exportForSuper(filters));
  }

  @Delete(':contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('contactId')
  @ApiOperation({
    operationId: 'superDeleteContact',
    summary: 'Apagar um contato',
    description:
      'RF-CONTACT-08 (pedido do titular): apaga o contato, os touchpoints e o nome digitado nos convites. Reservas e partes ficam no histórico, sem o vínculo. `CONTACT_NOT_FOUND` se não existe. Auditado (`super.contact.delete`), sem dados pessoais.',
  })
  @ApiNoContentResponse({ description: 'Contato apagado.' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('contactId', new UuidParamPipe(contactNotFound)) contactId: string,
  ): Promise<void> {
    return this.service.remove(user.id, contactId);
  }
}

/** Contatos que passaram pelo espaço (RF-CONTACT-07): Dono e Admin. */
@ApiTags('space-contacts')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId/contacts')
export class SpaceContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  @SpacePermission('contact.view')
  @ApiOperation({
    operationId: 'listSpaceContacts',
    summary: 'Contatos que passaram pelo espaço',
    description:
      'RF-CONTACT-07 (decisão 48): só quem tem touchpoint neste espaço, com o nome, o e-mail, o telefone e o consentimento informados aqui. Nada que veio de outro espaço aparece, e a busca e os filtros também olham só esses dados.',
  })
  @ApiZodQuery(contactsQuerySchema)
  @ApiZodResponse(schemas.page)
  list(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(contactsQuerySchema)) query: ContactsQuery,
  ): Promise<ContactPage> {
    return this.service.listForSpace(spaceId, query);
  }

  @Get('export.csv')
  @SpacePermission('contact.view')
  @ApiOperation({
    operationId: 'exportSpaceContactsCsv',
    summary: 'Exportar os contatos do espaço com consentimento em CSV',
    description: `RF-CONTACT-07. Só quem deu consentimento neste espaço e não se descadastrou, com os dados informados aqui. ${CSV_DESCRIPTION} Datas no fuso do espaço. Cada exportação fica na auditoria (\`contact.export_csv\`).`,
  })
  @ApiZodQuery(contactsExportQuerySchema)
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Arquivo CSV.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async exportCsv(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(contactsExportQuerySchema)) filters: ContactsExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    await this.service.auditSpaceExport(user.id, spaceId, filters);
    await sendCsv(res, this.service.exportForSpace(spaceId, filters));
  }
}

/** Descadastro sem conta (RF-CONTACT-08). */
@ApiTags('contacts')
@Public()
@Controller('public/contacts')
export class PublicContactsController {
  constructor(
    private readonly service: ContactsService,
    private readonly rateLimit: RateLimiter,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'unsubscribeContact',
    summary: 'Descadastrar pelo token assinado',
    description:
      'RF-CONTACT-08: `token` é o da coluna `link_descadastro` da exportação. Idempotente; o contato sai das próximas exportações. Rate limit por IP: 429 `TOO_MANY_REQUESTS`, com `X-Retry-After`.',
  })
  @ApiZodBody(schemas.unsubscribe)
  @ApiZodResponse(schemas.unsubscribed)
  @ApiUnprocessableEntityResponse({
    description: '`UNSUBSCRIBE_TOKEN_INVALID`.',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ description: '`TOO_MANY_REQUESTS`.', type: ErrorResponseDto })
  async unsubscribe(
    @Req() req: Request,
    @Body(new ZodValidationPipe(unsubscribeContactSchema)) body: UnsubscribeContactInput,
  ): Promise<UnsubscribeResult> {
    await this.rateLimit.consume(
      `${clientIp(this.auth, req)}|/public/contacts/unsubscribe`,
      UNSUBSCRIBE_LIMIT,
    );
    return this.service.unsubscribe(body.token);
  }
}

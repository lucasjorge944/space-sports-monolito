import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ConnectedAppList,
  type OAuthConsentRequest,
  type OAuthConsentRequestQuery,
  oauthConsentRequestQuerySchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { uuidParam } from '../common/uuid-param.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { ConnectedAppsService } from './connected-apps.service.js';
import { oauthSchemas } from './oauth.openapi.js';

/** Consentimento do MCP no web (`/autorizar`, RF-MCP-01). Só sessão do web (não o token do MCP). */
@ApiTags('oauth')
@ApiAuth()
@Controller('oauth')
export class OAuthConsentController {
  constructor(private readonly service: ConnectedAppsService) {}

  @Get('consent-request')
  @ApiOperation({
    operationId: 'getOAuthConsentRequest',
    summary: 'Pedido de consentimento do MCP (cliente e escopos)',
    description:
      'RF-MCP-01 (decisões 111, 120 e 121; RN-MCP-06). `oauthQuery` é a query inteira com que o Better Auth abriu `/autorizar` (sem o `?`). A API confere a assinatura e a validade (10 min) e devolve o cliente (nome, domínio verificado do CIMD, página e logo, se houver), o conector (`resource.kind`: `USER` = Space Sports, `ADMIN` = Space Sports · Plataforma, só Super, conexão de até 24 h) e os escopos que o servidor vai conceder a esta conta (`scopes`: pedidos ∩ os que a conta pode usar; `deniedScopes`: escopos do conector que esta conta não pode usar, para a tela explicar), com os textos em `MCP_OAUTH_SCOPE_LABELS` e os grupos em `mcpScopeGroupOf` de @space-sports/shared. Com `canAuthorize: false` (nenhum escopo concedível, ex.: quem não é Super no conector da plataforma), a tela não oferece "Permitir": só voltar ao assistente (`accept: false`, que devolve `access_denied`); o "Permitir" nesse caso responde 403 `OAUTH_ACCESS_DENIED`. Para responder, o web chama `POST /v1/auth/oauth2/consent` com `{ accept, oauth_query }` e navega para o `url` devolvido; conta sem nome ou telefone recebe 403 com `code: PROFILE_INCOMPLETE` e `details.missing` nesse POST com `accept: true` e no `POST /v1/auth/oauth2/continue` (decisão 119). Erros: 400 `OAUTH_REQUEST_INVALID` (adulterada, vencida ou sem cliente) e 404 `OAUTH_CLIENT_NOT_FOUND`.',
  })
  @ApiZodQuery(oauthConsentRequestQuerySchema)
  @ApiZodResponse(oauthSchemas.consentRequest)
  @ApiBadRequestResponse({ description: '`OAUTH_REQUEST_INVALID`.', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: '`OAUTH_CLIENT_NOT_FOUND`.', type: ErrorResponseDto })
  consentRequest(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(oauthConsentRequestQuerySchema)) query: OAuthConsentRequestQuery,
  ): Promise<OAuthConsentRequest> {
    return this.service.consentRequest(query.oauthQuery, user.id);
  }
}

/** "Apps conectados" (decisão 116, RF-MCP-05). Só sessão do app e do web (não o token do MCP). */
@ApiTags('me')
@ApiAuth()
@Controller('me/connected-apps')
export class ConnectedAppsController {
  constructor(private readonly service: ConnectedAppsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listConnectedApps',
    summary: 'Apps conectados (assistentes autorizados pelo usuário)',
    description:
      'RF-MCP-05 (decisão 116): clientes OAuth que o usuário autorizou, do mais recente para o mais antigo, com os escopos, a data da autorização e o último uso (gravado no máximo 1 vez por hora). `id` identifica a conexão em `DELETE /v1/me/connected-apps/{id}`.',
  })
  @ApiZodResponse(oauthSchemas.connectedApps)
  async list(@CurrentUser() user: AuthUser): Promise<ConnectedAppList> {
    return { items: await this.service.list(user.id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('id', 'Id da conexão (`id` de `GET /v1/me/connected-apps`).')
  @ApiOperation({
    operationId: 'disconnectConnectedApp',
    summary: 'Desconectar um app',
    description:
      'RN-MCP-04: revoga os tokens de atualização do cliente e apaga o consentimento; o token de acesso em uso deixa de valer na API na hora (e expira em até 15 min). Idempotente: conexão inexistente ou de outro usuário também responde 204.',
  })
  @ApiNoContentResponse()
  disconnect(@CurrentUser() user: AuthUser, @Param('id', uuidParam) id: string): Promise<void> {
    return this.service.disconnect(user.id, id);
  }
}

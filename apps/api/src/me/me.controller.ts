import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type AccountDeletionReceipt,
  type MeResponse,
  type RequestAccountDeletionInput,
  requestAccountDeletionSchema,
  type StaffSpacesResponse,
  type UpdateProfile,
} from '@space-sports/shared';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { optionalBody, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { schemas } from '../team/team.openapi.js';
import { AccountService } from './account.service.js';
import { MeResponseDto } from './me.dto.js';
import { meSchemas } from './me.openapi.js';
import { UpdateProfilePipe } from './profile.pipe.js';
import { ProfileService } from './profile.service.js';
import { StaffSpacesService } from './staff-spaces.service.js';

@ApiTags('me')
@ApiAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly profile: ProfileService,
    private readonly staffSpaces: StaffSpacesService,
    private readonly account: AccountService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'getMe',
    summary: 'Usuário da sessão, papel na plataforma e vínculos com espaços',
    description:
      'Usado pelo web e pelo app para decidir o acesso a /super, /painel e ao modo gestão (RN-AUTH-01 a RN-AUTH-04) e para mostrar o perfil (RF-AUTH-02). Com `profile.missing` não vazio (conta antiga sem telefone, login pelo Google), o app e o painel pedem os dados antes de seguir (decisão 66).',
  })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.profile.me(user.id);
  }

  @Patch('profile')
  @ApiOperation({
    operationId: 'updateMyProfile',
    summary: 'Editar o próprio perfil (parcial)',
    description:
      'RF-AUTH-02 (decisões 64 a 70). Só os campos enviados mudam: `name`, `phone` (E.164 brasileiro; trocar o número grava `phoneVerified = false`), `birthDate` (`YYYY-MM-DD`, de 1900 até hoje; nulo apaga), `gender` (nulo apaga) e `favoriteSports` (lista completa que substitui a anterior; esportes do catálogo, sem repetição, nível opcional). E-mail e foto têm fluxos próprios. Responde como `GET /v1/me`. Erros: 400 `INVALID_PHONE_NUMBER` (telefone inválido ou nulo, como no cadastro); 400 `VALIDATION_ERROR` (outro campo inválido, esporte repetido, data futura ou anterior a 1900, campo desconhecido); 422 `SPORT_NOT_FOUND`.',
  })
  @ApiZodBody(meSchemas.updateProfile)
  @ApiOkResponse({ type: MeResponseDto })
  @ApiBadRequestResponse({
    description: '`INVALID_PHONE_NUMBER` (telefone) ou `VALIDATION_ERROR` (demais campos).',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: '`SPORT_NOT_FOUND`: esporte fora do catálogo.',
    type: ErrorResponseDto,
  })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new UpdateProfilePipe()) body: UpdateProfile,
  ): Promise<MeResponse> {
    return this.profile.update(user.id, body);
  }

  @Get('staff-spaces')
  @ApiOperation({
    operationId: 'getMyStaffSpaces',
    summary:
      'Visão de equipe (somente leitura): espaços com vínculo, papéis, reservas e aulas de hoje',
    description:
      'RN-AUTH-04: base do modo gestão do app. Lista só espaços com vínculo ativo do usuário (vazia para quem não é da equipe), com os papéis dele e a agenda do dia no fuso do espaço: reservas (sem canceladas, sem valores) e aulas com a lista de presença (RF-CLASS-07; quem é só Professor vê as dele). A gestão — escrita — é feita só no web.',
  })
  @ApiZodResponse(schemas.staffSpaces)
  staffSpacesView(@CurrentUser() user: AuthUser): Promise<StaffSpacesResponse> {
    return this.staffSpaces.list(user.id);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'deactivateMe',
    summary: 'Inativar a própria conta (encerra todas as sessões)',
    description:
      'RF-AUTH-03 (decisão 29): a conta fica INACTIVE e o login passa a responder 403 `ACCOUNT_INACTIVE`. Nada é apagado nem cancelado (reservas, mensalistas, pagamentos e vínculos seguem); só o Super reativa. O cliente descarta o token/cookie local depois do 204.',
  })
  @ApiNoContentResponse({ description: 'Conta inativada; as sessões deixam de valer.' })
  @ApiConflictResponse({
    description:
      '`LAST_OWNER`: único Dono (com conta ativa) de um espaço. `SUPER_ACCOUNT`: conta Super precisa perder o acesso antes.',
    type: ErrorResponseDto,
  })
  deactivate(@CurrentUser() user: AuthUser): Promise<void> {
    return this.account.deactivate(user.id);
  }

  @Post('deletion-request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'requestMyAccountDeletion',
    summary: 'Pedir a exclusão da própria conta (inativa na hora)',
    description:
      'RF-AUTH-03 (decisão 40): exige a senha atual (`password`) ou, sem ela, uma sessão aberta há no máximo 10 minutos (conta sem senha: entrar de novo). Cria o pedido (origem `USER`) e inativa a conta como `POST /v1/me/deactivate` (encerra as sessões; o login passa a responder 403 `ACCOUNT_INACTIVE`). A equipe responde até `dueAt` (pedido + 15 dias); para desistir, o titular fala com o atendimento. Manda o e-mail de pedido recebido. O cliente descarta o token/cookie local depois do 201.',
  })
  @ApiZodBody(meSchemas.requestDeletion)
  @ApiZodResponse(meSchemas.deletionReceipt, HttpStatus.CREATED)
  @ApiForbiddenResponse({
    description:
      '`INVALID_PASSWORD`: senha errada. `REAUTHENTICATION_REQUIRED`: sem senha e com a sessão antiga.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      '`DELETION_REQUEST_PENDING`: já há um pedido em análise. `LAST_OWNER`: único Dono (com conta ativa) de um espaço. `SUPER_ACCOUNT`: conta Super precisa perder o acesso antes.',
    type: ErrorResponseDto,
  })
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(optionalBody(requestAccountDeletionSchema)))
    body: RequestAccountDeletionInput,
  ): Promise<AccountDeletionReceipt> {
    // O AuthGuard global garante a sessão nesta rota.
    const sessionId = req.auth?.session.id ?? '';
    return this.account.requestDeletion(user.id, sessionId, body);
  }
}

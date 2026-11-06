import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership, StaffInvitePreview } from '@space-sports/shared';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser, Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { StaffInvitesService } from './staff-invites.service.js';
import { schemas } from './team.openapi.js';

const tokenPipe = new ZodValidationPipe(z.string().min(1).max(200));
const tokenParam = ApiParam({ name: 'token', description: 'Token do link enviado por e-mail.' });

/** Convite de equipe visto por quem o recebeu (RF-NOTIF-02). */
@ApiTags('team')
@Controller('staff-invites')
export class StaffInvitesController {
  constructor(private readonly invites: StaffInvitesService) {}

  @Get(':token')
  @Public()
  @tokenParam
  @ApiOperation({
    operationId: 'getStaffInvite',
    summary: 'Prévia pública do convite de equipe (espaço, papel e e-mail convidado)',
    description:
      'Sem login: a tela de aceite usa o `email` para pré-preencher o cadastro e `hasAccount` para escolher entre login e cadastro. Erros: `STAFF_INVITE_NOT_FOUND` (404), `STAFF_INVITE_UNAVAILABLE` e `STAFF_INVITE_EXPIRED` (409).',
  })
  @ApiZodResponse(schemas.staffInvitePreview)
  preview(@Param('token', tokenPipe) token: string): Promise<StaffInvitePreview> {
    return this.invites.preview(token);
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiAuth()
  @tokenParam
  @ApiOperation({
    operationId: 'acceptStaffInvite',
    summary: 'Aceitar o convite com a conta logada (mesmo e-mail do convite)',
    description:
      'Cria o vínculo com o espaço e devolve os papéis ativos do usuário nele; idempotente para quem já aceitou. A conta precisa ter o e-mail convidado, sem diferenciar maiúsculas, vale para quem acabou de se cadastrar e para quem já tinha conta. Erros: `STAFF_INVITE_EMAIL_MISMATCH` (403: conta sem e-mail ou com outro e-mail), `EMAIL_NOT_VERIFIED` (422: e-mail certo, ainda não verificado), `SPACE_READ_ONLY` (403), `STAFF_INVITE_NOT_FOUND` (404), `STAFF_INVITE_UNAVAILABLE` e `STAFF_INVITE_EXPIRED` (409).',
  })
  @ApiZodResponse(schemas.membership)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('token', tokenPipe) token: string,
  ): Promise<Membership> {
    return this.invites.accept(user, token);
  }
}

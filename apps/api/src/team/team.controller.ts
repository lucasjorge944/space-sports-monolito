import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type InviteStaffInput,
  inviteStaffSchema,
  type ReplaceMemberRolesInput,
  replaceMemberRolesSchema,
  type StaffInvite,
  type Team,
  type TeamMember,
} from '@space-sports/shared';
import type { AuthUser, SpaceAccess } from '../auth/auth-context.js';
import { ApiAuth, CurrentSpaceAccess, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from '../openapi/zod-openapi.js';
import { StaffInvitesService } from './staff-invites.service.js';
import { inviteNotFound, memberNotFound } from './team.errors.js';
import { schemas } from './team.openapi.js';
import { type TeamActor, TeamService } from './team.service.js';

const inviteIdPipe = new UuidParamPipe(inviteNotFound);
const memberIdPipe = new UuidParamPipe(memberNotFound);

const actorOf = (user: AuthUser, access: SpaceAccess | undefined): TeamActor => ({
  userId: user.id,
  roles: access?.roles ?? [],
});

/**
 * Equipe do espaço (RN-AUTH-01/03; matriz de docs/02: "Gerir equipe" é do Dono e do Admin, e o
 * Admin não gerencia o Dono). Espaço suspenso: só leitura.
 */
@ApiTags('team')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId/team')
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly invites: StaffInvitesService,
  ) {}

  @Get()
  @SpacePermission('team.manage')
  @ApiOperation({
    operationId: 'getTeam',
    summary: 'Equipe do espaço: membros com seus papéis e convites em aberto',
  })
  @ApiZodResponse(schemas.team)
  get(@Param('spaceId') spaceId: string): Promise<Team> {
    return this.team.list(spaceId);
  }

  @Post('invites')
  @SpacePermission('team.manage')
  @ApiOperation({
    operationId: 'inviteStaff',
    summary: 'Convidar por e-mail para Admin ou Professor (RF-NOTIF-02)',
    description:
      'Envia um link que expira em 7 dias. O Dono não é convidável aqui (só pelo Super). Erros: `ALREADY_TEAM_MEMBER`, `STAFF_INVITE_PENDING` (409), `OWNER_PROTECTED` (403: o Admin não mexe no vínculo do Dono).',
  })
  @ApiZodBody(schemas.inviteStaff)
  @ApiZodResponse(schemas.staffInvite, HttpStatus.CREATED)
  invite(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(inviteStaffSchema)) body: InviteStaffInput,
  ): Promise<StaffInvite> {
    return this.invites.create(spaceId, actorOf(user, access), body);
  }

  @Post('invites/:inviteId/resend')
  @HttpCode(HttpStatus.OK)
  @SpacePermission('team.manage')
  @ApiUuidParam('inviteId')
  @ApiOperation({
    operationId: 'resendStaffInvite',
    summary: 'Reenviar o convite com link e prazo novos (vale também para o vencido)',
    description:
      'O link anterior deixa de valer. O reenvio de um convite ainda válido só é aceito 60 s depois do último envio. Erros: `STAFF_INVITE_NOT_FOUND`, `STAFF_INVITE_UNAVAILABLE`, `STAFF_INVITE_RESEND_TOO_SOON` (429, `details.retryAfterSec`).',
  })
  @ApiZodResponse(schemas.staffInvite)
  resend(
    @Param('spaceId') spaceId: string,
    @Param('inviteId', inviteIdPipe) inviteId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<StaffInvite> {
    return this.invites.resend(spaceId, actorOf(user, access), inviteId);
  }

  @Delete('invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SpacePermission('team.manage')
  @ApiUuidParam('inviteId')
  @ApiOperation({ operationId: 'revokeStaffInvite', summary: 'Revogar o convite' })
  @ApiNoContentResponse()
  async revoke(
    @Param('spaceId') spaceId: string,
    @Param('inviteId', inviteIdPipe) inviteId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<void> {
    await this.invites.revoke(spaceId, actorOf(user, access), inviteId);
  }

  @Put('members/:userId/roles')
  @SpacePermission('team.manage')
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'replaceTeamMemberRoles',
    summary: 'Substituir os papéis do membro no espaço (RN-AUTH-03)',
    description:
      'Papéis múltiplos por espaço. Erros: `MEMBER_NOT_FOUND` (404), `OWNER_PROTECTED` (403: Admin não altera o Dono), `OWNER_ROLE_RESTRICTED` (403: o papel de Dono só vem da plataforma), `LAST_OWNER` (409), `TEACHER_HAS_CLASS_GROUPS` (409: tirar o papel de quem é o único professor de uma turma ativa ou aula futura; `details` lista quais). Quem perde o papel sai das listas de professores das turmas e aulas futuras.',
  })
  @ApiZodBody(schemas.replaceMemberRoles)
  @ApiZodResponse(schemas.teamMember)
  replaceRoles(
    @Param('spaceId') spaceId: string,
    @Param('userId', memberIdPipe) userId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(replaceMemberRolesSchema)) body: ReplaceMemberRolesInput,
  ): Promise<TeamMember> {
    return this.team.replaceRoles(spaceId, actorOf(user, access), userId, body.roles);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SpacePermission('team.manage')
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'removeTeamMember',
    summary: 'Remover o membro da equipe; o acesso ao espaço acaba na hora',
    description:
      'Erros: `MEMBER_NOT_FOUND` (404), `OWNER_PROTECTED` (403), `LAST_OWNER` (409: o último Dono não pode ser removido), `TEACHER_HAS_CLASS_GROUPS` (409: é o único professor de uma turma ativa ou aula futura; `details` lista quais). Quem sai deixa as listas de professores das turmas e aulas futuras.',
  })
  @ApiNoContentResponse()
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('userId', memberIdPipe) userId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<void> {
    await this.team.remove(spaceId, actorOf(user, access), userId);
  }
}

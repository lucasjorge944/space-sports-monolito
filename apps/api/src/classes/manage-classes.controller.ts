import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type ClassGroup,
  type ClassGroupDetail,
  type ClassGroupsQuery,
  type ClassSessionConflict,
  type ClassSessionDetail,
  type ClassSessionsQuery,
  type ClassSessionsResponse,
  type CreateClassGroupInput,
  type CreatePlanInput,
  classGroupsQuerySchema,
  classSessionsQuerySchema,
  createClassGroupSchema,
  createPlanSchema,
  type Plan,
  type PlansQuery,
  plansQuerySchema,
  type TeachersResponse,
  type UpdateClassGroupInput,
  type UpdateClassSessionInput,
  type UpdatePlanInput,
  updateClassGroupSchema,
  updateClassSessionSchema,
  updatePlanSchema,
} from '@space-sports/shared';
import type { AuthUser, SpaceAccess } from '../auth/auth-context.js';
import { ApiAuth, CurrentSpaceAccess, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { attendanceSchemas } from './attendance.openapi.js';
import { AttendanceService } from './attendance.service.js';
import { ClassGroupsService } from './class-groups.service.js';
import { ClassSessionLifecycleService } from './class-session-lifecycle.service.js';
import { ClassSessionsService } from './class-sessions.service.js';
import { classGroupNotFound, classSessionNotFound, planNotFound } from './classes.errors.js';
import { schemas } from './classes.openapi.js';
import { type ClassesScope, classesScope } from './classes-scope.js';
import { PlansService } from './plans.service.js';

const groupIdPipe = new UuidParamPipe(classGroupNotFound);
const sessionIdPipe = new UuidParamPipe(classSessionNotFound);
const planIdPipe = new UuidParamPipe(planNotFound);

const error = (decorator: typeof ApiConflictResponse, description: string) =>
  decorator({ description, type: ErrorResponseDto });

const groupInvalid = error(
  ApiUnprocessableEntityResponse,
  '`SPORT_NOT_FOUND`, `TEACHER_NOT_FOUND`, `COURT_UNAVAILABLE`, `SPORT_NOT_OFFERED`, `INVALID_DURATION`, `MISALIGNED_START`, `OUTSIDE_OPENING_HOURS`.',
);

/**
 * Aulas no painel do espaço (RF-CLASS-01..03; matriz de docs/02): gerir turmas e planos é do Dono
 * e do Admin (`classes.manage`); a leitura (`classes.view`) é também do Professor, que só vê as
 * turmas e sessões em que está. Espaço suspenso: só leitura (guard).
 */
@ApiTags('classes')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId')
export class ManageClassesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly groups: ClassGroupsService,
    private readonly sessions: ClassSessionsService,
    private readonly plans: PlansService,
    private readonly attendance: AttendanceService,
    private readonly lifecycle: ClassSessionLifecycleService,
  ) {}

  private scope(spaceId: string, user: AuthUser, access?: SpaceAccess): Promise<ClassesScope> {
    return classesScope(this.db, spaceId, user.id, access?.roles ?? []);
  }

  // -------------------------------------------------------------------------------------------
  // Professores

  @Get('teachers')
  @SpacePermission('classes.view')
  @ApiOperation({
    operationId: 'listTeachers',
    summary: 'Professores do espaço (RF-CLASS-01)',
    description:
      'Vínculos `TEACHER` ativos. O convite e a remoção usam a equipe: `POST …/team/invites` com `role: TEACHER` e `PUT …/team/members/:userId/roles`. Quem sai deixa as listas de turmas e aulas; se for o único de uma turma ativa ou de uma aula por acontecer → 409 `TEACHER_HAS_CLASS_GROUPS` (`details.classGroups` e `details.classSessions` listam quais).',
  })
  @ApiZodResponse(schemas.teachers)
  teachers(@Param('spaceId') spaceId: string): Promise<TeachersResponse> {
    return this.groups.teachers(spaceId);
  }

  // -------------------------------------------------------------------------------------------
  // Turmas fixas

  @Get('class-groups')
  @SpacePermission('classes.view')
  @ApiOperation({
    operationId: 'listClassGroups',
    summary: 'Turmas fixas do espaço, com vagas',
    description: 'O Professor (sem outro papel) só vê as turmas em que está entre os professores.',
  })
  @ApiZodQuery(classGroupsQuerySchema)
  @ApiZodResponse(schemas.classGroups)
  async listGroups(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Query(new ZodValidationPipe(classGroupsQuerySchema)) query: ClassGroupsQuery,
  ): Promise<{ items: ClassGroup[] }> {
    const scope = await this.scope(spaceId, user, access);
    return { items: await this.groups.list(spaceId, scope, query) };
  }

  @Post('class-groups')
  @SpacePermission('classes.manage')
  @ApiOperation({
    operationId: 'createClassGroup',
    summary: 'Cadastrar turma fixa (RF-CLASS-02)',
    description:
      'Horário no fuso do espaço. `teacherMemberIds`: um ou mais Professores do espaço, a lista padrão das aulas. Ativa: gera as sessões das próximas 4 semanas e ocupa a quadra (kind CLASS). Conflito com outra turma ou mensalista no horário semanal, ou com reserva, bloqueio ou aula numa das próximas sessões → 409 `CLASS_SCHEDULE_CONFLICT` (`details.conflictsWith`: `CLASS_GROUP`, `RECURRING_BOOKING`, `BOOKING`, `BLOCK`, `CLASS`, `TOURNAMENT`). Professor com turma ou aula em outro espaço no horário → 409 `TEACHER_SCHEDULE_CONFLICT` (a mensagem e `details` têm a data e o horário desta turma, nunca o outro espaço; no mesmo espaço pode).',
  })
  @ApiZodBody(schemas.createClassGroup)
  @ApiZodResponse(schemas.classGroupDetail, HttpStatus.CREATED)
  @error(ApiNotFoundResponse, '`COURT_NOT_FOUND`.')
  @error(ApiConflictResponse, '`CLASS_SCHEDULE_CONFLICT`, `TEACHER_SCHEDULE_CONFLICT`.')
  @groupInvalid
  createGroup(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createClassGroupSchema)) body: CreateClassGroupInput,
  ): Promise<ClassGroupDetail> {
    return this.groups.create(spaceId, user.id, body);
  }

  @Get('class-groups/:classGroupId')
  @SpacePermission('classes.view')
  @ApiUuidParam('classGroupId')
  @ApiOperation({
    operationId: 'getClassGroup',
    summary: 'Detalhe da turma, com as sessões que não couberam na agenda',
  })
  @ApiZodResponse(schemas.classGroupDetail)
  @error(ApiNotFoundResponse, '`CLASS_GROUP_NOT_FOUND`.')
  async getGroup(
    @Param('spaceId') spaceId: string,
    @Param('classGroupId', groupIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<ClassGroupDetail> {
    return this.groups.get(spaceId, await this.scope(spaceId, user, access), id);
  }

  @Patch('class-groups/:classGroupId')
  @SpacePermission('classes.manage')
  @ApiUuidParam('classGroupId')
  @ApiOperation({
    operationId: 'updateClassGroup',
    summary: 'Editar, desativar ou reativar a turma',
    description:
      'Só os campos enviados mudam. Mudar quadra, dia, horário, duração ou `active` regenera as sessões futuras **sem confirmações** (reativar revalida professores, quadra e agenda); as que já têm confirmações ficam como estão. `teacherMemberIds` substitui a lista; a lista e a capacidade vão direto para as sessões futuras sem confirmações, sem revalidar a agenda da quadra; a capacidade e os professores ajustados numa sessão são mantidos. Quem entra na lista, ou toda a lista ao mudar o horário ou reativar, passa pela agenda em outros espaços. Trocar a lista também gera as sessões que ficaram de fora: quem está em conflito na data fica sem aquela aula e, sem ninguém livre, o aviso à gestão continua. Erros: `CLASS_SCHEDULE_CONFLICT`, `TEACHER_SCHEDULE_CONFLICT`, `SLOT_UNAVAILABLE` (outra edição disputou o horário ao mesmo tempo: tente de novo), `CAPACITY_BELOW_ENROLLMENTS`, `CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS` (desativar com alunos matriculados) e `SPORT_CHANGE_NOT_ALLOWED` (trocar o esporte com alunos matriculados), todos 409.',
  })
  @ApiZodBody(schemas.updateClassGroup)
  @ApiZodResponse(schemas.classGroupDetail)
  @error(ApiNotFoundResponse, '`CLASS_GROUP_NOT_FOUND`, `COURT_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`CLASS_SCHEDULE_CONFLICT`, `TEACHER_SCHEDULE_CONFLICT`, `SLOT_UNAVAILABLE`, `CAPACITY_BELOW_ENROLLMENTS`, `CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS`, `SPORT_CHANGE_NOT_ALLOWED`.',
  )
  @groupInvalid
  updateGroup(
    @Param('spaceId') spaceId: string,
    @Param('classGroupId', groupIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateClassGroupSchema)) body: UpdateClassGroupInput,
  ): Promise<ClassGroupDetail> {
    return this.groups.update(spaceId, user.id, id, body);
  }

  @Delete('class-groups/:classGroupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SpacePermission('classes.manage')
  @ApiUuidParam('classGroupId')
  @ApiOperation({
    operationId: 'deleteClassGroup',
    summary: 'Excluir turma sem histórico',
    description:
      'Apaga a turma e as sessões futuras sem confirmações. Com alunos matriculados → 409 `CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS`; com aulas passadas, confirmações ou matrículas encerradas → 409 `CLASS_GROUP_HAS_HISTORY` (desative a turma).',
  })
  @ApiNoContentResponse()
  @error(ApiNotFoundResponse, '`CLASS_GROUP_NOT_FOUND`.')
  @error(ApiConflictResponse, '`CLASS_GROUP_HAS_ACTIVE_ENROLLMENTS`, `CLASS_GROUP_HAS_HISTORY`.')
  async deleteGroup(
    @Param('spaceId') spaceId: string,
    @Param('classGroupId', groupIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.groups.remove(spaceId, user.id, id);
  }

  @Get('class-session-conflicts')
  @SpacePermission('classes.view')
  @ApiOperation({
    operationId: 'listClassSessionConflicts',
    summary: 'Sessões que não couberam na agenda (sinalizadas pelo job)',
    description:
      'Bloqueio, torneio, reserva ou outra aula no horário de uma sessão futura, ou `conflictsWith: TEACHER` quando todos os professores da turma têm aula em outro espaço. O aviso some quando a sessão é gerada ou a turma muda de horário/é desativada.',
  })
  @ApiZodResponse(schemas.conflicts)
  async conflicts(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<{ items: ClassSessionConflict[] }> {
    const scope = await this.scope(spaceId, user, access);
    return { items: await this.groups.conflicts(spaceId, scope) };
  }

  // -------------------------------------------------------------------------------------------
  // Sessões

  @Get('class-sessions')
  @SpacePermission('classes.view')
  @ApiOperation({
    operationId: 'listClassSessions',
    summary: 'Sessões (aulas) do espaço por período',
    description:
      'Datas locais do espaço, `from` a `to` inclusive (padrão: hoje + 27 dias; no máximo 62 dias, senão 422 `CLASS_SESSIONS_RANGE_TOO_LONG`). O Professor (sem outro papel) só vê as sessões em que está entre os professores.',
  })
  @ApiZodQuery(classSessionsQuerySchema)
  @ApiZodResponse(schemas.classSessions)
  async listSessions(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Query(new ZodValidationPipe(classSessionsQuerySchema)) query: ClassSessionsQuery,
  ): Promise<ClassSessionsResponse> {
    return this.sessions.list(spaceId, await this.scope(spaceId, user, access), query);
  }

  @Get('class-sessions/:sessionId')
  @SpacePermission('classes.view')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'getClassSession',
    summary: 'Detalhe da sessão com a lista de presença (RF-CLASS-09)',
    description:
      '`attendances`: confirmados e presenças primeiro, depois a espera em ordem (sem as desistências). `enrolledStudents`: matriculados na turma, para adicionar e marcar presença.',
  })
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  async getSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<ClassSessionDetail> {
    return this.attendance.detail(spaceId, await this.scope(spaceId, user, access), id);
  }

  @Patch('class-sessions/:sessionId')
  @SpacePermission('classes.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'updateClassSession',
    summary: 'Ajustar a capacidade ou os professores da sessão (RF-CLASS-09)',
    description:
      'Vale só para esta aula (a turma não muda). `teacherMemberIds` substitui a lista de professores da aula. Aumentar a capacidade promove a espera (só antes do início da aula). Abaixo das vagas ocupadas (confirmados + presenças marcadas) → 409 `CAPACITY_BELOW_CONFIRMED`; aula encerrada ou cancelada → 409 `CLASS_SESSION_NOT_EDITABLE`; professor com aula em outro espaço no horário → 409 `TEACHER_SCHEDULE_CONFLICT`; outra edição disputando o horário ao mesmo tempo → 409 `SLOT_UNAVAILABLE` (tente de novo); professor sem vínculo TEACHER ativo → 422 `TEACHER_NOT_FOUND`.',
  })
  @ApiZodBody(schemas.updateClassSession)
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`CAPACITY_BELOW_CONFIRMED`, `CLASS_SESSION_NOT_EDITABLE`, `TEACHER_SCHEDULE_CONFLICT`, `SLOT_UNAVAILABLE`.',
  )
  @error(ApiUnprocessableEntityResponse, '`TEACHER_NOT_FOUND`.')
  async updateSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateClassSessionSchema)) body: UpdateClassSessionInput,
  ): Promise<ClassSessionDetail> {
    await this.lifecycle.update(spaceId, user.id, id, body);
    return this.attendance.detail(spaceId, { kind: 'ALL' }, id);
  }

  // -------------------------------------------------------------------------------------------
  // Planos

  @Get('plans')
  @SpacePermission('classes.view')
  @ApiOperation({ operationId: 'listPlans', summary: 'Planos do espaço (RF-CLASS-03)' })
  @ApiZodQuery(plansQuerySchema)
  @ApiZodResponse(schemas.plans)
  async listPlans(
    @Param('spaceId') spaceId: string,
    @Query(new ZodValidationPipe(plansQuerySchema)) query: PlansQuery,
  ): Promise<{ items: Plan[] }> {
    return { items: await this.plans.list(spaceId, query) };
  }

  @Post('plans')
  @SpacePermission('classes.manage')
  @ApiOperation({
    operationId: 'createPlan',
    summary: 'Cadastrar plano',
    description:
      '`weeklyFrequency` N = N turmas fixas por semana; nulo = ilimitado nas turmas matriculadas. Vence todo mês no `billingDay` (1 a 28), sem pró-rata.',
  })
  @ApiZodBody(schemas.createPlan)
  @ApiZodResponse(schemas.plan, HttpStatus.CREATED)
  @error(ApiUnprocessableEntityResponse, '`SPORT_NOT_FOUND`.')
  createPlan(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
  ): Promise<Plan> {
    return this.plans.create(spaceId, user.id, body);
  }

  @Get('plans/:planId')
  @SpacePermission('classes.view')
  @ApiUuidParam('planId')
  @ApiOperation({ operationId: 'getPlan', summary: 'Detalhe do plano' })
  @ApiZodResponse(schemas.plan)
  @error(ApiNotFoundResponse, '`PLAN_NOT_FOUND`.')
  getPlan(
    @Param('spaceId') spaceId: string,
    @Param('planId', planIdPipe) id: string,
  ): Promise<Plan> {
    return this.plans.get(spaceId, id);
  }

  @Patch('plans/:planId')
  @SpacePermission('classes.manage')
  @ApiUuidParam('planId')
  @ApiOperation({
    operationId: 'updatePlan',
    summary: 'Editar ou desativar o plano',
    description:
      'O preço novo vale para as próximas assinaturas (as existentes guardam o valor contratado). Desativado, sai da página pública. Trocar o esporte com assinaturas em andamento → 409 `SPORT_CHANGE_NOT_ALLOWED`.',
  })
  @ApiZodBody(schemas.updatePlan)
  @ApiZodResponse(schemas.plan)
  @error(ApiNotFoundResponse, '`PLAN_NOT_FOUND`.')
  @error(ApiConflictResponse, '`SPORT_CHANGE_NOT_ALLOWED`.')
  @error(ApiUnprocessableEntityResponse, '`SPORT_NOT_FOUND`.')
  updatePlan(
    @Param('spaceId') spaceId: string,
    @Param('planId', planIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
  ): Promise<Plan> {
    return this.plans.update(spaceId, user.id, id, body);
  }

  @Delete('plans/:planId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SpacePermission('classes.manage')
  @ApiUuidParam('planId')
  @ApiOperation({
    operationId: 'deletePlan',
    summary: 'Excluir plano sem assinaturas',
    description: 'Com assinaturas → 409 `PLAN_HAS_SUBSCRIPTIONS` (desative o plano).',
  })
  @ApiNoContentResponse()
  @error(ApiNotFoundResponse, '`PLAN_NOT_FOUND`.')
  @error(ApiConflictResponse, '`PLAN_HAS_SUBSCRIPTIONS`.')
  async deletePlan(
    @Param('spaceId') spaceId: string,
    @Param('planId', planIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.plans.remove(spaceId, user.id, id);
  }
}

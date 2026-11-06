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
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type AddAttendeeInput,
  addAttendeeSchema,
  type CancelClassSessionInput,
  type ClassAttendancesQuery,
  type ClassAttendancesResponse,
  type ClassGroupFrequency,
  type ClassGroupFrequencyQuery,
  type ClassSessionDetail,
  cancelClassSessionSchema,
  classAttendancesQuerySchema,
  classGroupFrequencyQuerySchema,
  type MarkPresenceInput,
  markPresenceSchema,
} from '@space-sports/shared';
import type { AuthUser, SpaceAccess } from '../auth/auth-context.js';
import { ApiAuth, CurrentSpaceAccess, CurrentUser, SpacePermission } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { notInSession } from './attendance.errors.js';
import { attendanceSchemas } from './attendance.openapi.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { ClassSessionLifecycleService } from './class-session-lifecycle.service.js';
import { classGroupNotFound, classSessionNotFound } from './classes.errors.js';
import { type ClassesScope, classesScope } from './classes-scope.js';

const sessionIdPipe = new UuidParamPipe(classSessionNotFound);
const groupIdPipe = new UuidParamPipe(classGroupNotFound);
const userIdPipe = new UuidParamPipe(notInSession);

const error = (decorator: typeof ApiConflictResponse, description: string) =>
  decorator({ description, type: ErrorResponseDto });

/**
 * Lista de presença no painel (RF-CLASS-09/10; RN-CLASS-03/04; matriz de docs/02): abrir,
 * fechar, reabrir, adicionar/remover aluno e marcar presença são de quem tem
 * `attendance.manage` (Dono, Admin e o Professor só nas sessões dele); cancelar a aula é de
 * `classes.manage` (Dono e Admin). Espaço suspenso: só leitura (guard).
 */
@ApiTags('classes')
@ApiAuth()
@ApiUuidParam('spaceId')
@Controller('manage/spaces/:spaceId')
export class ManageAttendanceController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly attendance: AttendanceService,
    private readonly lifecycle: ClassSessionLifecycleService,
    private readonly reports: AttendanceReportsService,
  ) {}

  /** Leitura e operação da lista: Dono e Admin em todas as sessões; o Professor só nas dele. */
  private scope(spaceId: string, user: AuthUser, access?: SpaceAccess) {
    return classesScope(this.db, spaceId, user.id, access?.roles ?? []);
  }

  // -------------------------------------------------------------------------------------------
  // Ciclo da lista (RN-CLASS-04)

  @Post('class-sessions/:sessionId/open')
  @SpacePermission('attendance.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'openClassSession',
    summary: 'Abrir ou reabrir a lista de presença',
    description:
      'Em qualquer modo (AUTOMATIC ou MANUAL), de `SCHEDULED` ou `CLOSED` para `OPEN`, até o fim da aula. Abrir pela primeira vez avisa os alunos; reabrir não. Reaberta depois do horário de fechamento automático, a lista fica aberta até alguém fechar. Auditado.',
  })
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(ApiConflictResponse, '`CLASS_SESSION_STATUS_CONFLICT`.')
  @HttpCode(HttpStatus.OK)
  async open(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<ClassSessionDetail> {
    const scope = await this.scope(spaceId, user, access);
    await this.lifecycle.open(spaceId, user.id, scope, id);
    return this.attendance.detail(spaceId, scope, id);
  }

  @Post('class-sessions/:sessionId/close')
  @SpacePermission('attendance.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'closeClassSession',
    summary: 'Fechar a lista de presença',
    description: 'De `OPEN` para `CLOSED`. Auditado.',
  })
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(ApiConflictResponse, '`CLASS_SESSION_STATUS_CONFLICT`.')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<ClassSessionDetail> {
    const scope = await this.scope(spaceId, user, access);
    await this.lifecycle.close(spaceId, user.id, scope, id);
    return this.attendance.detail(spaceId, scope, id);
  }

  @Post('class-sessions/:sessionId/cancel')
  @SpacePermission('classes.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'cancelClassSession',
    summary: 'Cancelar a aula (feriado, chuva…)',
    description:
      'Só aula que ainda vai acontecer (`SCHEDULED`, `OPEN`, `CLOSED`). Libera a quadra, avisa os alunos (matriculados e quem está na lista) e não volta a ser gerada. A lista fica registrada. Auditado.',
  })
  @ApiZodBody(attendanceSchemas.cancelClassSession)
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(ApiConflictResponse, '`CLASS_SESSION_STATUS_CONFLICT`.')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(cancelClassSessionSchema)) body: CancelClassSessionInput,
  ): Promise<ClassSessionDetail> {
    await this.lifecycle.cancel(spaceId, user.id, id, body.reason);
    return this.attendance.detail(spaceId, { kind: 'ALL' }, id);
  }

  // -------------------------------------------------------------------------------------------
  // Lista (RF-CLASS-09/10)

  @Post('class-sessions/:sessionId/attendances')
  @SpacePermission('attendance.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'addClassSessionAttendee',
    summary: 'Adicionar aluno à aula',
    description:
      'Inclusão manual (`addedByStaff`), sem as travas de matrícula e assinatura; sem vaga (confirmados + presenças marcadas ocupam vaga), vai para o fim da espera. Só aula que ainda vai acontecer. Auditado.',
  })
  @ApiZodBody(attendanceSchemas.addAttendee)
  @ApiZodResponse(attendanceSchemas.classSessionDetail, HttpStatus.CREATED)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`ALREADY_IN_SESSION`, `CLASS_SESSION_STATUS_CONFLICT`, `CLASS_SESSION_OVERLAP` (o aluno já está confirmado ou na espera de outra aula no mesmo horário, em qualquer espaço; `details.conflict`).',
  )
  @error(ApiUnprocessableEntityResponse, '`USER_NOT_FOUND`.')
  async add(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(addAttendeeSchema)) body: AddAttendeeInput,
  ): Promise<ClassSessionDetail> {
    const scope = await this.scope(spaceId, user, access);
    return this.attendance.add(spaceId, user.id, scope, id, body.userId);
  }

  @Delete('class-sessions/:sessionId/attendances/:userId')
  @SpacePermission('attendance.manage')
  @ApiUuidParam('sessionId')
  @ApiUuidParam('userId')
  @ApiOperation({
    operationId: 'removeClassSessionAttendee',
    summary: 'Remover aluno da aula',
    description:
      'Confirmado ou na espera. A vaga liberada promove o primeiro da espera (que é avisado), só antes do início da aula. Quem já teve a presença marcada (`PRESENT`/`ABSENT`) não sai: 409 `PRESENCE_ALREADY_MARKED`. Só aula que ainda vai acontecer. Auditado.',
  })
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(
    ApiConflictResponse,
    '`NOT_IN_SESSION`, `PRESENCE_ALREADY_MARKED`, `CLASS_SESSION_STATUS_CONFLICT`.',
  )
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @Param('userId', userIdPipe) userId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
  ): Promise<ClassSessionDetail> {
    const scope = await this.scope(spaceId, user, access);
    return this.attendance.remove(spaceId, user.id, scope, id, userId);
  }

  @Put('class-sessions/:sessionId/presence')
  @SpacePermission('attendance.manage')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'markClassSessionPresence',
    summary: 'Marcar presença real (presente/faltou)',
    description:
      'A partir do início da aula, também depois de encerrada (`DONE`); não em aula cancelada. Vale para quem está na lista e para os matriculados na turma; os demais → 422 `STUDENT_NOT_IN_SESSION` (adicione antes). Auditado.',
  })
  @ApiZodBody(attendanceSchemas.markPresence)
  @ApiZodResponse(attendanceSchemas.classSessionDetail)
  @error(ApiNotFoundResponse, '`CLASS_SESSION_NOT_FOUND`.')
  @error(ApiConflictResponse, '`PRESENCE_TOO_EARLY`, `CLASS_SESSION_STATUS_CONFLICT`.')
  @error(ApiUnprocessableEntityResponse, '`STUDENT_NOT_IN_SESSION`.')
  async presence(
    @Param('spaceId') spaceId: string,
    @Param('sessionId', sessionIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Body(new ZodValidationPipe(markPresenceSchema)) body: MarkPresenceInput,
  ): Promise<ClassSessionDetail> {
    const scope = await this.scope(spaceId, user, access);
    return this.attendance.markPresence(spaceId, user.id, scope, id, body);
  }

  // -------------------------------------------------------------------------------------------
  // Histórico e frequência

  @Get('class-attendances')
  @SpacePermission('classes.view')
  @ApiOperation({
    operationId: 'listClassAttendances',
    summary: 'Histórico de presença por aluno e/ou turma',
    description:
      'Exige `userId` ou `classGroupId` (senão 422 `ATTENDANCE_FILTER_REQUIRED`). Datas locais do espaço, `from` a `to` inclusive (padrão: os últimos 30 dias; no máximo 366, senão 422 `ATTENDANCE_RANGE_TOO_LONG`). `summary` conta só as aulas dadas (`DONE`). O Professor só vê as sessões dele.',
  })
  @ApiZodQuery(classAttendancesQuerySchema)
  @ApiZodResponse(attendanceSchemas.classAttendances)
  @error(
    ApiUnprocessableEntityResponse,
    '`ATTENDANCE_FILTER_REQUIRED`, `ATTENDANCE_RANGE_TOO_LONG`.',
  )
  async history(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Query(new ZodValidationPipe(classAttendancesQuerySchema)) query: ClassAttendancesQuery,
  ): Promise<ClassAttendancesResponse> {
    const scope: ClassesScope = await this.scope(spaceId, user, access);
    return this.reports.history(spaceId, scope, query);
  }

  @Get('class-groups/:classGroupId/frequency')
  @SpacePermission('classes.view')
  @ApiUuidParam('classGroupId')
  @ApiOperation({
    operationId: 'getClassGroupFrequency',
    summary: 'Frequência da turma no período',
    description:
      'Aulas dadas (`DONE`) e canceladas, presenças/faltas/sem marcação por aluno (matriculados hoje e quem teve presença no período) e totais. Mesmas regras de período do histórico.',
  })
  @ApiZodQuery(classGroupFrequencyQuerySchema)
  @ApiZodResponse(attendanceSchemas.classGroupFrequency)
  @error(ApiNotFoundResponse, '`CLASS_GROUP_NOT_FOUND`.')
  @error(ApiUnprocessableEntityResponse, '`ATTENDANCE_RANGE_TOO_LONG`.')
  async frequency(
    @Param('spaceId') spaceId: string,
    @Param('classGroupId', groupIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentSpaceAccess() access: SpaceAccess | undefined,
    @Query(new ZodValidationPipe(classGroupFrequencyQuerySchema)) query: ClassGroupFrequencyQuery,
  ): Promise<ClassGroupFrequency> {
    return this.reports.frequency(spaceId, await this.scope(spaceId, user, access), id, query);
  }
}

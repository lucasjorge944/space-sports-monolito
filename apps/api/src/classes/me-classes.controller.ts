import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type MyClassSessionDetail,
  type MyClassSessionsQuery,
  type MyClassSessionsResponse,
  myClassSessionsQuerySchema,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { attendanceSchemas } from './attendance.openapi.js';
import { AttendanceService } from './attendance.service.js';
import { classSessionNotFound } from './classes.errors.js';

const sessionIdPipe = new UuidParamPipe(classSessionNotFound);

const notFound = ApiNotFoundResponse({
  description: '`CLASS_SESSION_NOT_FOUND`: não existe ou não é de uma turma do aluno.',
  type: ErrorResponseDto,
});

/**
 * Aulas do aluno no app (RF-CLASS-07/08; RN-CLASS-03/05/06; decisão 24: só nas sessões das
 * turmas em que está matriculado). A visão de equipe fica em `GET /v1/me/staff-spaces`.
 */
@ApiTags('me')
@ApiAuth()
@Controller('me/class-sessions')
export class MeClassesController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @ApiOperation({
    operationId: 'listMyClassSessions',
    summary: 'Aulas da semana/dia das turmas do aluno (RF-CLASS-07)',
    description:
      'Sessões das turmas com matrícula ativa (assinatura ACTIVE ou PAST_DUE) e as em que a gestão incluiu o aluno, canceladas inclusive. Datas locais (America/Sao_Paulo), `from` a `to` inclusive; padrão hoje + 6 dias, no máximo 31 (senão 422 `CLASS_SESSIONS_RANGE_TOO_LONG`). `canConfirm`/`blockedReason` dizem se e por que não pode confirmar agora (`SCHEDULE_OVERLAP`: já está confirmado ou na espera de outra aula no mesmo horário, decisão 37).',
  })
  @ApiZodQuery(myClassSessionsQuerySchema)
  @ApiZodResponse(attendanceSchemas.myClassSessions)
  @ApiUnprocessableEntityResponse({
    description: '`CLASS_SESSIONS_RANGE_TOO_LONG`.',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(myClassSessionsQuerySchema)) query: MyClassSessionsQuery,
  ): Promise<MyClassSessionsResponse> {
    return this.attendance.listMine(user.id, query);
  }

  @Get(':sessionId')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'getMyClassSession',
    summary: 'Detalhe da aula com a lista confirmada e a posição na espera',
  })
  @ApiZodResponse(attendanceSchemas.myClassSessionDetail)
  @notFound
  get(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', sessionIdPipe) id: string,
  ): Promise<MyClassSessionDetail> {
    return this.attendance.getMine(user.id, id);
  }

  @Post(':sessionId/attendance')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'confirmMyClassSession',
    summary: 'Confirmar presença (RF-CLASS-08)',
    description:
      'Com a lista aberta e antes do início. Sem vaga, entra na espera (`myAttendance.status = WAITLIST`, com a posição). Desistir e confirmar de novo vai para o fim da fila.',
  })
  @ApiZodResponse(attendanceSchemas.myClassSessionDetail)
  @notFound
  @ApiForbiddenResponse({
    description:
      '`NOT_ENROLLED_IN_CLASS`, `SUBSCRIPTION_ACCESS_ENDED` (aula depois do último dia do plano cancelado, RN-CLASS-08), `SUBSCRIPTION_PAST_DUE` (RN-CLASS-06, se o espaço não desligou a regra), `SPACE_READ_ONLY`.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      '`ATTENDANCE_LIST_NOT_OPEN`, `ALREADY_IN_SESSION`, `CLASS_SESSION_OVERLAP` (o aluno já está confirmado ou na espera de outra aula que se sobrepõe a esta, em qualquer espaço; `details.conflict`: nome da turma, espaço, início e fim, sem a situação do aluno na lista dela).',
    type: ErrorResponseDto,
  })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', sessionIdPipe) id: string,
  ): Promise<MyClassSessionDetail> {
    return this.attendance.confirm(user.id, id);
  }

  @Delete(':sessionId/attendance')
  @ApiUuidParam('sessionId')
  @ApiOperation({
    operationId: 'withdrawMyClassSession',
    summary: 'Desistir da aula (RN-CLASS-05)',
    description:
      'Confirmado: com a lista aberta e até `cancellableUntil` (`attendance_cancel_deadline_min` antes). Na espera: a qualquer momento antes do início. A vaga liberada promove o primeiro da espera.',
  })
  @ApiZodResponse(attendanceSchemas.myClassSessionDetail)
  @notFound
  @ApiForbiddenResponse({ description: '`SPACE_READ_ONLY`.', type: ErrorResponseDto })
  @ApiConflictResponse({
    description: '`NOT_IN_SESSION`, `ATTENDANCE_LIST_NOT_OPEN`, `CANCEL_DEADLINE_PASSED`.',
    type: ErrorResponseDto,
  })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', sessionIdPipe) id: string,
  ): Promise<MyClassSessionDetail> {
    return this.attendance.withdraw(user.id, id);
  }
}

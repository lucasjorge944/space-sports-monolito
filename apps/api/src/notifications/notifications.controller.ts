import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Device,
  Notification,
  NotificationPage,
  NotificationPreferences,
  NotificationsQuery,
  ReadAllResult,
  RegisterDeviceInput,
  UpdateNotificationPreferencesInput,
} from '@space-sports/shared';
import type { AuthUser } from '../auth/auth-context.js';
import { ApiAuth, CurrentUser } from '../auth/decorators.js';
import { ErrorResponseDto } from '../common/error-response.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiUuidParam, ApiZodBody, ApiZodQuery, ApiZodResponse } from '../openapi/zod-openapi.js';
import { deviceNotFound, notificationNotFound } from './notifications.errors.js';
import { schemas } from './notifications.openapi.js';
import { NotificationsService } from './notifications.service.js';

/** Aparelhos do usuário para o push (RF-NOTIF-01). */
@ApiTags('notifications')
@ApiAuth()
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly service: NotificationsService) {}

  @Put()
  @ApiOperation({
    operationId: 'registerDevice',
    summary: 'Registrar o token de push do aparelho',
    description:
      'Idempotente por token. Chame depois do login e quando o token mudar. Se o token estava em outra conta (mesmo aparelho, outro login), ele passa para a conta da sessão.',
  })
  @ApiZodBody(schemas.registerDevice)
  @ApiZodResponse(schemas.device)
  register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(schemas.registerDevice)) body: RegisterDeviceInput,
  ): Promise<Device> {
    return this.service.registerDevice(user.id, body);
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUuidParam('deviceId')
  @ApiOperation({
    operationId: 'removeDevice',
    summary: 'Remover o token de push (chame no logout)',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: '`DEVICE_NOT_FOUND`.', type: ErrorResponseDto })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('deviceId', new UuidParamPipe(deviceNotFound)) deviceId: string,
  ): Promise<void> {
    return this.service.removeDevice(user.id, deviceId);
  }
}

/** Central de notificações do app (RF-NOTIF-04). */
@ApiTags('notifications')
@ApiAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listNotifications',
    summary: 'Minhas notificações (mais recentes primeiro), com o total de não lidas',
  })
  @ApiZodQuery(schemas.notificationsQuery)
  @ApiZodResponse(schemas.notificationPage)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(schemas.notificationsQuery)) query: NotificationsQuery,
  ): Promise<NotificationPage> {
    return this.service.list(user.id, query);
  }

  // Antes de `:notificationId/read`, para "read-all" não ser lido como id.
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'markAllNotificationsRead', summary: 'Marcar todas como lidas' })
  @ApiZodResponse(schemas.readAllResult)
  readAll(@CurrentUser() user: AuthUser): Promise<ReadAllResult> {
    return this.service.markAllRead(user.id);
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiUuidParam('notificationId')
  @ApiOperation({
    operationId: 'markNotificationRead',
    summary: 'Marcar uma notificação como lida (idempotente)',
  })
  @ApiZodResponse(schemas.notification)
  @ApiNotFoundResponse({ description: '`NOTIFICATION_NOT_FOUND`.', type: ErrorResponseDto })
  read(
    @CurrentUser() user: AuthUser,
    @Param('notificationId', new UuidParamPipe(notificationNotFound)) notificationId: string,
  ): Promise<Notification> {
    return this.service.markRead(user.id, notificationId);
  }
}

/** Preferências por tipo de notificação (RF-NOTIF-04). */
@ApiTags('notifications')
@ApiAuth()
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({
    operationId: 'getNotificationPreferences',
    summary: 'Preferências de push e de central, por tipo',
    description: 'Sempre lista todos os tipos; sem preferência salva, push e inApp ficam ligados.',
  })
  @ApiZodResponse(schemas.notificationPreferences)
  get(@CurrentUser() user: AuthUser): Promise<NotificationPreferences> {
    return this.service.preferences(user.id);
  }

  @Patch()
  @ApiOperation({
    operationId: 'updateNotificationPreferences',
    summary: 'Alterar preferências (só os tipos e canais enviados mudam)',
  })
  @ApiZodBody(schemas.updateNotificationPreferences)
  @ApiZodResponse(schemas.notificationPreferences)
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(schemas.updateNotificationPreferences))
    body: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    return this.service.updatePreferences(user.id, body);
  }
}

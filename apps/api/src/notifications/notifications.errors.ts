import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

export const notificationNotFound = () =>
  new AppException({
    status: HttpStatus.NOT_FOUND,
    code: 'NOTIFICATION_NOT_FOUND',
    message: 'Notificação não encontrada.',
  });

export const deviceNotFound = () =>
  new AppException({
    status: HttpStatus.NOT_FOUND,
    code: 'DEVICE_NOT_FOUND',
    message: 'Dispositivo não encontrado.',
  });

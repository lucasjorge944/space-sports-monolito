import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

/** Storage desligado (sem `S3_BUCKET`/`S3_PUBLIC_URL`): vale para fotos, logo e foto de perfil. */
export const storageUnavailable = () =>
  new AppException({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: 'STORAGE_UNAVAILABLE',
    message: 'Upload de fotos indisponível no momento.',
  });

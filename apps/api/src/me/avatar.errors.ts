import { HttpStatus } from '@nestjs/common';
import { AVATAR_MAX_BYTES } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

export { storageUnavailable } from '../storage/storage.errors.js';

// Erros da foto de perfil (RF-AUTH-02). Códigos genéricos de upload de imagem, para servirem a
// outros fluxos no futuro; a logo do espaço segue com os dela (`*_LOGO_*`).

const error = (code: string, message: string) => () =>
  new AppException({ status: HttpStatus.UNPROCESSABLE_ENTITY, code, message });

/** Chave fora do formato ou de outro usuário (nunca de `uploads/users/<o próprio id>/avatar/`). */
export const invalidUploadKey = error(
  'INVALID_UPLOAD_KEY',
  'O envio da foto expirou ou não é da sua conta. Escolha o arquivo de novo.',
);
export const uploadNotFound = error(
  'UPLOAD_NOT_FOUND',
  'O arquivo da foto não foi encontrado. Envie-o pela URL de upload antes de salvar.',
);
export const imageTooLarge = error(
  'IMAGE_TOO_LARGE',
  `A foto é maior que o limite permitido (${AVATAR_MAX_BYTES / 1024 / 1024} MB).`,
);
export const invalidImageFile = error(
  'INVALID_IMAGE_FILE',
  'O arquivo enviado está vazio ou não é uma imagem do tipo pedido (JPEG, PNG ou WebP).',
);
/** As dimensões lidas vão em `details` (`width`, `height`). */
export const imageNotSquare = (size: { width: number; height: number }) =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'IMAGE_NOT_SQUARE',
    message: `A foto precisa ser quadrada (mesma largura e altura); a imagem enviada tem ${size.width}x${size.height} px.`,
    details: { width: size.width, height: size.height },
  });

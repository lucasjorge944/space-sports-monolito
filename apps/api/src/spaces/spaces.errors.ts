import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

export { storageUnavailable } from '../storage/storage.errors.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const spaceNotFound = error(
  HttpStatus.NOT_FOUND,
  'SPACE_NOT_FOUND',
  'Espaço não encontrado.',
);
export const courtNotFound = error(
  HttpStatus.NOT_FOUND,
  'COURT_NOT_FOUND',
  'Quadra não encontrada.',
);
export const photoNotFound = error(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Foto não encontrada.');
export const courtNameTaken = error(
  HttpStatus.CONFLICT,
  'COURT_NAME_TAKEN',
  'Já existe uma quadra com esse nome neste espaço.',
);
export const courtHasBookings = error(
  HttpStatus.CONFLICT,
  'COURT_HAS_BOOKINGS',
  'A quadra tem reservas ou mensalistas e não pode ser excluída. Marque-a como inativa.',
);
/** Turmas que impedem inativar ou excluir a quadra (citadas na mensagem e em `details`). */
export const courtHasClassGroups = (
  action: 'inactivate' | 'delete',
  classGroups: { id: string; name: string }[],
) =>
  new AppException({
    status: HttpStatus.CONFLICT,
    code: 'COURT_HAS_CLASS_GROUPS',
    message:
      action === 'inactivate'
        ? `A quadra tem turmas ativas (${quoted(classGroups)}). Mude a quadra das turmas ou desative-as antes de inativar a quadra.`
        : `A quadra tem turmas cadastradas (${quoted(classGroups)}) e não pode ser excluída. Mude a quadra das turmas ou marque a quadra como inativa.`,
    details: { classGroups },
  });

const quoted = (items: { name: string }[]) => items.map((item) => `"${item.name}"`).join(', ');

export const unknownSport = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'UNKNOWN_SPORT',
  'Esporte não encontrado no catálogo.',
);
export const unknownAmenity = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'UNKNOWN_AMENITY',
  'Item de infraestrutura não encontrado no catálogo.',
);
export const cityNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'CITY_NOT_FOUND',
  'Cidade não encontrada ou inativa.',
);
export const addressNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'ADDRESS_NOT_FOUND',
  'Não encontramos esse endereço no mapa. Confira os dados ou ajuste o pino manualmente.',
);
export const geocodingUnavailable = error(
  HttpStatus.SERVICE_UNAVAILABLE,
  'GEOCODING_UNAVAILABLE',
  'Não foi possível localizar o endereço agora. Tente de novo em instantes.',
);
export const photoLimitReached = error(
  HttpStatus.CONFLICT,
  'PHOTO_LIMIT_REACHED',
  'O espaço já atingiu o limite de fotos.',
);
export const invalidPhotoKey = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'INVALID_PHOTO_KEY',
  'Chave de foto inválida para este espaço.',
);
export const photoNotUploaded = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'PHOTO_NOT_UPLOADED',
  'O arquivo da foto não foi encontrado. Envie-o pela URL de upload antes de salvar.',
);
export const photoTooLarge = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'PHOTO_TOO_LARGE',
  'A foto é maior que o limite permitido.',
);
export const invalidPhotoFile = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'INVALID_PHOTO_FILE',
  'O arquivo enviado está vazio ou não é do tipo pedido (JPEG, PNG ou WebP).',
);
export const photoAlreadyAdded = error(
  HttpStatus.CONFLICT,
  'PHOTO_ALREADY_ADDED',
  'Essa foto já está na galeria.',
);
export const photoSetMismatch = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'PHOTO_SET_MISMATCH',
  'Envie todas as fotos do espaço, cada uma uma vez, na nova ordem.',
);
export const invalidCursor = error(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'Cursor inválido.');
/** Cursor de `GET /v1/spaces` gerado na outra ordem (`sort`, decisão 109). */
export const cursorSortMismatch = error(
  HttpStatus.BAD_REQUEST,
  'CURSOR_SORT_MISMATCH',
  'O cursor é de outra ordenação. Recomece a busca sem o cursor.',
);

// Logo do espaço (RF-SPACE-11): mesmos casos das fotos, com códigos próprios.
export const invalidLogoKey = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'INVALID_LOGO_KEY',
  'Chave de logo inválida para este espaço.',
);
export const logoNotUploaded = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'LOGO_NOT_UPLOADED',
  'O arquivo da logo não foi encontrado. Envie-o pela URL de upload antes de salvar.',
);
export const logoTooLarge = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'LOGO_TOO_LARGE',
  'A logo é maior que o limite permitido (2 MB).',
);
export const invalidLogoFile = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'INVALID_LOGO_FILE',
  'O arquivo enviado está vazio ou não é uma imagem do tipo pedido (JPEG, PNG ou WebP).',
);
/** Mesmo código do arquivo inválido; as dimensões lidas vão em `details`. */
export const logoNotSquare = (size: { width: number; height: number }) =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'INVALID_LOGO_FILE',
    message: `A logo precisa ser quadrada (mesma largura e altura); a imagem enviada tem ${size.width}x${size.height} px.`,
    details: size,
  });

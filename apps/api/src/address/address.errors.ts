import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const cepInvalid = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'CEP_INVALID',
  'CEP inválido: informe os 8 dígitos.',
);
export const cepNotFound = error(HttpStatus.NOT_FOUND, 'CEP_NOT_FOUND', 'CEP não encontrado.');
/** Decisão 52: a falha na busca nunca impede preencher o endereço à mão. */
export const cepLookupUnavailable = error(
  HttpStatus.SERVICE_UNAVAILABLE,
  'CEP_LOOKUP_UNAVAILABLE',
  'A busca de CEP está indisponível. Preencha o endereço à mão.',
);

import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

export const contactNotFound = error(
  HttpStatus.NOT_FOUND,
  'CONTACT_NOT_FOUND',
  'Contato não encontrado.',
);
/** A tela mostrou uma sugestão que não vale mais (a conta mudou ou o convidado já tem conta). */
export const suggestedUserMismatch = error(
  HttpStatus.CONFLICT,
  'SUGGESTED_USER_MISMATCH',
  'Esta conta não é mais a sugerida.',
);
export const unsubscribeTokenInvalid = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'UNSUBSCRIBE_TOKEN_INVALID',
  'Link de descadastro inválido.',
);

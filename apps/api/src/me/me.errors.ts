import { HttpStatus } from '@nestjs/common';
import { INVALID_PHONE_MESSAGE } from '@space-sports/shared';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

/** RN-AUTH-01: o espaço nunca pode ficar sem um Dono com a conta ativa. */
export const lastOwner = error(
  HttpStatus.CONFLICT,
  'LAST_OWNER',
  'Você é o único Dono de um espaço. Defina outro Dono antes de inativar a conta.',
);
export const superAccount = error(
  HttpStatus.CONFLICT,
  'SUPER_ACCOUNT',
  'Conta da equipe da plataforma: peça a outro Super para remover o seu acesso antes de inativá-la.',
);
export const lastOwnerDeletion = error(
  HttpStatus.CONFLICT,
  'LAST_OWNER',
  'Você é o único Dono de um espaço. Defina outro Dono antes de pedir a exclusão da conta.',
);
export const superAccountDeletion = error(
  HttpStatus.CONFLICT,
  'SUPER_ACCOUNT',
  'Conta da equipe da plataforma: peça a outro Super para remover o seu acesso antes de pedir a exclusão.',
);
/** Decisão 40: um pedido de exclusão pendente por conta. */
export const deletionRequestPending = error(
  HttpStatus.CONFLICT,
  'DELETION_REQUEST_PENDING',
  'Já existe um pedido de exclusão da sua conta em análise.',
);
export const invalidPassword = error(HttpStatus.FORBIDDEN, 'INVALID_PASSWORD', 'Senha incorreta.');
export const reauthenticationRequired = error(
  HttpStatus.FORBIDDEN,
  'REAUTHENTICATION_REQUIRED',
  'Por segurança, informe a senha ou entre de novo na conta antes de pedir a exclusão.',
);
/** Mesmo código do rate limit das rotas de login; `retryAfter` em segundos. */
export const tooManyRequests = (details: { retryAfter: number | null }) =>
  new AppException({
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: 'TOO_MANY_REQUESTS',
    message: 'Muitas tentativas. Tente de novo mais tarde.',
    details,
  });
/** Decisão 69: os esportes favoritos vêm do catálogo. */
export const favoriteSportNotFound = error(
  HttpStatus.UNPROCESSABLE_ENTITY,
  'SPORT_NOT_FOUND',
  'Esporte não encontrado no catálogo.',
);
/** Decisão 64: o mesmo código e a mesma mensagem do cadastro por e-mail (auth.ts). */
export const invalidPhoneNumber = error(
  HttpStatus.BAD_REQUEST,
  'INVALID_PHONE_NUMBER',
  INVALID_PHONE_MESSAGE,
);

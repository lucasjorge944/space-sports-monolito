import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

/** Mensagem do login e das rotas para a conta inativa (a mesma nos dois caminhos). */
export const ACCOUNT_INACTIVE_MESSAGE =
  'Conta inativa. Para reativá-la, fale com o espaço ou com o suporte da plataforma.';

export const unauthenticated = () =>
  new AppException({
    status: HttpStatus.UNAUTHORIZED,
    code: 'UNAUTHENTICATED',
    message: 'Faça login para continuar.',
  });

export const userBlocked = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'USER_BLOCKED',
    message: 'Conta bloqueada.',
  });

/** RF-AUTH-03: conta inativada pelo titular no app; só o Super reativa. */
export const accountInactive = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'ACCOUNT_INACTIVE',
    message: ACCOUNT_INACTIVE_MESSAGE,
  });

export const superRequired = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SUPER_REQUIRED',
    message: 'Acesso restrito à equipe da plataforma.',
  });

export const spaceForbidden = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SPACE_FORBIDDEN',
    message: 'Você não tem permissão para esta ação neste espaço.',
  });

export const spaceReadOnly = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SPACE_READ_ONLY',
    message: 'Este espaço está suspenso ou encerrado: o painel está em modo somente leitura.',
  });

export const supportSessionInvalid = () =>
  new AppException({
    status: HttpStatus.FORBIDDEN,
    code: 'SUPPORT_SESSION_INVALID',
    message: 'Sessão de suporte inválida, expirada ou de outro espaço.',
  });

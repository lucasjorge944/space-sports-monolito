import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';

const error = (status: HttpStatus, code: string, message: string) => () =>
  new AppException({ status, code, message });

/** Query de `/autorizar` adulterada, vencida (10 min) ou sem cliente: o assistente recomeça. */
export const oauthRequestInvalid = error(
  HttpStatus.BAD_REQUEST,
  'OAUTH_REQUEST_INVALID',
  'Pedido de autorização inválido ou vencido. Volte ao assistente e conecte de novo.',
);

export const oauthClientNotFound = error(
  HttpStatus.NOT_FOUND,
  'OAUTH_CLIENT_NOT_FOUND',
  'Aplicativo não encontrado ou desativado.',
);

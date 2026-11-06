import { HttpException, type HttpStatus } from '@nestjs/common';

export interface AppExceptionOptions {
  status: HttpStatus;
  /** Código estável, em SCREAMING_SNAKE_CASE, que os clientes usam para tratar o erro. */
  code: string;
  message: string;
  details?: unknown;
}

/** Erro de domínio com código próprio; o filtro global o serializa no formato padrão. */
export class AppException extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor({ status, code, message, details }: AppExceptionOptions) {
    super(message, status);
    this.code = code;
    this.details = details;
  }
}

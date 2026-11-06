import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppException } from './app.exception.js';
import type { ErrorBody, FieldError } from './error-response.js';

const INTERNAL_ERROR_MESSAGE = 'Erro interno do servidor.';
const VALIDATION_ERROR_MESSAGE = 'Dados inválidos.';

interface Resolved {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Converte qualquer exceção no formato padrão `{ error: { code, message, details? }, requestId }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();

    const { status, ...error } = resolve(exception);
    const retryAfter = retryAfterOf(exception);
    if (retryAfter) response.setHeader('X-Retry-After', String(retryAfter));
    // AppException é uma resposta deliberada: quem a lança decide o que logar.
    if (status >= 500 && !(exception instanceof AppException)) {
      this.logger.error({ err: exception, requestId: request.id }, error.message);
    }

    const body: ErrorBody = {
      error,
      requestId: typeof request.id === 'string' ? request.id : null,
    };
    response.status(status).json(body);
  }
}

/** O mesmo header das rotas de login, em todo 429 da API. */
function retryAfterOf(exception: unknown): number | null {
  if (!(exception instanceof AppException) || exception.code !== 'TOO_MANY_REQUESTS') return null;
  return (exception.details as { retryAfter?: number | null } | undefined)?.retryAfter ?? null;
}

function resolve(exception: unknown): Resolved {
  if (exception instanceof ZodError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: VALIDATION_ERROR_MESSAGE,
      details: toFieldErrors(exception),
    };
  }

  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      ...(exception.details === undefined ? {} : { details: exception.details }),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { status, code: statusCode(status), message: httpExceptionMessage(exception) };
  }

  // Outros erros 4xx de middlewares do Express (ex.: corpo grande demais) trazem status e expose.
  const clientError = asExposedHttpError(exception);
  if (clientError) {
    return {
      status: clientError.status,
      code: statusCode(clientError.status),
      message: clientError.message,
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: INTERNAL_ERROR_MESSAGE,
  };
}

export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/** Código derivado do status HTTP (ex.: 404 → NOT_FOUND). */
function statusCode(status: number): string {
  if (status === HttpStatus.INTERNAL_SERVER_ERROR) return 'INTERNAL_ERROR';
  return HttpStatus[status] ?? 'HTTP_ERROR';
}

function httpExceptionMessage(exception: HttpException): string {
  if (exception.getStatus() >= 500) return INTERNAL_ERROR_MESSAGE;
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return exception.message;
}

function asExposedHttpError(exception: unknown): { status: number; message: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, expose, message } = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (typeof status !== 'number' || status < 400 || status >= 500 || expose !== true) return null;
  return {
    status,
    message: typeof message === 'string' ? message : (HttpStatus[status] ?? 'Bad Request'),
  };
}

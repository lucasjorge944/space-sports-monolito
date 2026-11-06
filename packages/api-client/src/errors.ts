/** Corpo de erro padrão da API: `{ error: { code, message, details? }, requestId }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string | null;
}

/** Código usado quando a resposta de erro não segue o formato padrão (ex.: 502 de um proxy). */
export const UNKNOWN_ERROR_CODE = 'HTTP_ERROR';

/**
 * Erro HTTP da API (status >= 400). `code` é o código estável para tratar na UI (ex.:
 * `UNAUTHENTICATED`, `VALIDATION_ERROR`, `INVALID_EMAIL_OR_PASSWORD`); `message` é o texto da API.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  /** Corpo cru da resposta (JSON já parseado, texto, ou `undefined` se vazio). */
  readonly body: unknown;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | null;
    body?: unknown;
  }) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId ?? null;
    this.body = init.body;
  }

  /** Monta o erro a partir da resposta, aceitando corpos fora do formato padrão. */
  static fromResponse(response: Response, body: unknown): ApiError {
    const headerRequestId = response.headers.get('x-request-id');
    if (isApiErrorBody(body)) {
      return new ApiError({
        status: response.status,
        code: body.error.code,
        message: body.error.message,
        details: body.error.details,
        requestId: body.requestId ?? headerRequestId,
        body,
      });
    }
    return new ApiError({
      status: response.status,
      code: UNKNOWN_ERROR_CODE,
      message: response.statusText || `HTTP ${response.status}`,
      requestId: headerRequestId,
      body,
    });
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

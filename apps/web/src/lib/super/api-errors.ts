import { isApiError } from '@space-sports/api-client';

/** Erros por campo de um `VALIDATION_ERROR` da API (`details: [{ field, message }]`), por caminho (`address.street`). */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const item of error.details as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { field, message } = item as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string' && !(field in result)) {
      result[field] = message;
    }
  }
  return result;
}

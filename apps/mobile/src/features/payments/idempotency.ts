import { isApiError } from '@space-sports/api-client';

/**
 * `Idempotency-Key` por tentativa (decisão 96): uma chave nova a cada toque que cria algo; as
 * repetições automáticas da mesma tentativa reaproveitam a chave. Formato UUID v4 (a API aceita de
 * 8 a 200 caracteres de letras, números e `_ . : -`). Não é segredo: basta não repetir.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } })
    .crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function idempotencyHeaders(key: string): { headers: Record<string, string> } {
  return { headers: { 'Idempotency-Key': key } };
}

/**
 * Resultado desconhecido: a requisição pode ter chegado (rede caiu, timeout, 5xx sem código do
 * domínio). Nesses casos a mesma tentativa repete com a mesma chave.
 */
export function isUnknownOutcome(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return error.status >= 500 && error.code !== 'PAYMENT_GATEWAY_UNAVAILABLE';
}

/** Repetição automática só para resultado desconhecido (até 2 vezes, com a mesma chave). */
export function retryUnknownOutcome(failureCount: number, error: unknown): boolean {
  return isUnknownOutcome(error) && failureCount < 2;
}

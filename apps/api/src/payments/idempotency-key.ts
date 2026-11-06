import { createHash } from 'node:crypto';
import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppException } from '../common/app.exception.js';

const KEY = /^[A-Za-z0-9_.:-]{8,200}$/;

/**
 * Header `Idempotency-Key` (decisão 96): a mesma chave devolve o que a primeira tentativa criou.
 * Opcional; formato inválido responde 400 `INVALID_IDEMPOTENCY_KEY`.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const value = ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !KEY.test(value)) {
      throw new AppException({
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key inválida (8 a 200 caracteres: letras, números, _ . : -).',
      });
    }
    return value;
  },
);

export const ApiIdempotencyKey = () =>
  ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Decisão 96: chave gerada pelo app por tentativa (ex.: uuid). Repetir a chave com o mesmo pedido devolve o que a primeira chamada criou, sem cobrar nem reservar de novo; com um pedido diferente, 422 `IDEMPOTENCY_KEY_REUSED`. O token do cartão não conta na comparação (cada tokenização gera outro).',
  });

type HashValue = string | number | boolean | null | undefined;

/**
 * Hash (SHA-256) dos campos relevantes de um pedido com `Idempotency-Key`: guardado junto da
 * chave, distingue a repetição do mesmo pedido (devolve o que já foi criado) de outro pedido com a
 * mesma chave (`IDEMPOTENCY_KEY_REUSED`). Ordem dos campos e ausente × nulo não mudam o hash.
 */
export function requestHash(scope: string, fields: Record<string, HashValue>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => [key, fields[key] ?? null]);
  return createHash('sha256')
    .update(JSON.stringify([scope, canonical]))
    .digest('hex');
}

/** A chave existe com o hash de outro pedido (os registros antigos, sem hash, não conferem). */
export function assertSameRequest(stored: string | null, current: string | undefined): void {
  if (stored && current && stored !== current) throw idempotencyKeyReused();
}

/** A mesma `Idempotency-Key` foi usada num pedido diferente. */
export const idempotencyKeyReused = () =>
  new AppException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: 'IDEMPOTENCY_KEY_REUSED',
    message:
      'Esta chave de idempotência já foi usada em outro pedido. Gere uma chave nova para cada tentativa diferente.',
  });

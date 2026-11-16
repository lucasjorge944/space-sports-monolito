import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AUTH_BASE_PATH } from '../auth/auth.js';
import { isOAuthServerPath } from '../auth/oauth-server.js';
import { AppException } from './app.exception.js';
import type { FieldError } from './error-response.js';

const NUL = '\u0000';
/**
 * `%00` na URL crua: a única forma de um byte NUL chegar pelo caminho ou pela query (o parser HTTP
 * do Node recusa o byte cru na linha de requisição). `%2500` é o texto "%00", sem NUL.
 */
const ENCODED_NUL = /%00/i;

export const NUL_BYTE_MESSAGE = 'Texto com caractere inválido (byte nulo).';

type Node = { value: unknown; key: string; parent: Node | null };

/**
 * Caminho (`players.0.name`) da primeira string ou chave com o byte NUL; `null` se não houver.
 * Iterativo, sem recursão: um JSON muito aninhado não estoura a pilha, e o caminho só é montado
 * quando acha (sem custo por nível).
 */
export function findNulByte(root: unknown): string | null {
  const stack: Node[] = [{ value: root, key: '', parent: null }];
  for (let node = stack.pop(); node; node = stack.pop()) {
    const { value } = node;
    if (typeof value === 'string') {
      if (value.includes(NUL)) return pathOf(node);
      continue;
    }
    if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      const child: Node = { value: item, key, parent: node };
      if (key.includes(NUL)) return pathOf(child);
      stack.push(child);
    }
  }
  return null;
}

/** Teto do caminho devolvido em `details` (um corpo muito aninhado não volta inteiro). */
const MAX_FIELD_LENGTH = 200;

function pathOf(node: Node): string {
  const keys: string[] = [];
  for (let current: Node | null = node; current?.parent; current = current.parent) {
    keys.push(current.key.replaceAll(NUL, ''));
  }
  return keys.reverse().join('.').slice(0, MAX_FIELD_LENGTH);
}

/** Caminho e query string (sem o `?`) da URL crua. */
function splitUrl(originalUrl: string): { path: string; search: string } {
  const index = originalUrl.indexOf('?');
  return index < 0
    ? { path: originalUrl, search: '' }
    : { path: originalUrl.slice(0, index), search: originalUrl.slice(index + 1) };
}

/**
 * Campo com NUL na requisição: o caminho da URL (`path`), um parâmetro da query ou um campo do
 * corpo. A query é conferida na URL crua inteira, não no `req.query`: o parser do Express descarta
 * os parâmetros depois do milésimo, e o Better Auth (e quem mais reler a URL) os enxerga. O
 * `req.query` só dá o nome do campo; sem ele (parâmetro descartado), o campo é `query`.
 */
export function nulByteField(req: Pick<Request, 'originalUrl' | 'query' | 'body'>): string | null {
  const { path, search } = splitUrl(req.originalUrl);
  if (ENCODED_NUL.test(path)) return 'path';
  if (ENCODED_NUL.test(search)) return findNulByte(req.query) ?? 'query';
  return findNulByte(req.body);
}

/**
 * BUG-MCP-3: o Postgres recusa o byte NUL (`0x00`) em `text`/`varchar`/`jsonb`, e qualquer texto
 * que chegasse ao banco com ele virava 500. Toda requisição com NUL no caminho (parâmetros de
 * rota), na query ou no corpo (JSON ou formulário) responde 400 `VALIDATION_ERROR` antes de
 * qualquer rota, inclusive as do Better Auth. As rotas OAuth respondem no formato do RFC 6749.
 * Fica depois do parser do corpo; os webhooks (corpo cru, `Buffer`) não são inspecionados.
 */
export function rejectNulBytes(req: Request, res: Response, next: NextFunction): void {
  const field = nulByteField(req);
  if (field === null) {
    next();
    return;
  }
  const { path } = splitUrl(req.originalUrl);
  if (
    path.startsWith(`${AUTH_BASE_PATH}/`) &&
    isOAuthServerPath(path.slice(AUTH_BASE_PATH.length))
  ) {
    res.status(HttpStatus.BAD_REQUEST).json({
      error: 'invalid_request',
      error_description: 'parameters must not contain NUL characters',
    });
    return;
  }
  const details: FieldError[] = [{ field, message: NUL_BYTE_MESSAGE, code: 'invalid_format' }];
  next(
    new AppException({
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
      details,
    }),
  );
}

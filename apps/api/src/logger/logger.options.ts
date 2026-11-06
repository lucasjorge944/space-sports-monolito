import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[\w.-]{1,128}$/;

/** Reaproveita o x-request-id recebido (se válido) ou gera um novo, e devolve no header da resposta. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

interface SerializedReq {
  url?: string;
  query?: unknown;
  params?: unknown;
  [key: string]: unknown;
}

interface SerializedRes {
  headers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Tokens que vão no caminho da url (reset de senha do Better Auth e link do convite). */
const TOKEN_IN_PATH = /(\/(?:reset-password|invites)\/)[^/?#]+/;

/**
 * Tira da requisição logada a query string, os params da rota (o caminho já está na url) e os
 * tokens que vão no caminho.
 */
export function withoutQuery({ query: _query, params: _params, ...req }: SerializedReq) {
  if (typeof req.url !== 'string') return req;
  const path = req.url.split('?')[0] ?? '';
  return { ...req, url: path.replace(TOKEN_IN_PATH, '$1[REDACTED]') };
}

/**
 * Tira a query do `location` dos redirects: o Better Auth devolve tokens nela (reset de senha,
 * verificação de e-mail, cookie para o deep link do app).
 */
export function withoutLocationQuery(res: SerializedRes): SerializedRes {
  const location = res.headers?.location;
  if (typeof location !== 'string') return res;
  return { ...res, headers: { ...res.headers, location: location.split(/[?#]/)[0] } };
}

export function loggerOptions(env: Env): Params {
  const defaultLevel =
    env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? defaultLevel,
      genReqId: resolveRequestId,
      customAttributeKeys: { reqId: 'requestId' },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        // Token de sessão do app (plugin bearer do Better Auth).
        'res.headers["set-auth-token"]',
      ],
      autoLogging: { ignore: (req) => req.url?.startsWith('/v1/health') ?? false },
      // Tokens de reset de senha/OTP podem vir na url e nos redirects: nunca vão para o log.
      serializers: { req: withoutQuery, res: withoutLocationQuery },
      // Erros 5xx já são logados como error pelo AllExceptionsFilter.
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'warn' : 'info'),
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
            }
          : undefined,
    },
  };
}

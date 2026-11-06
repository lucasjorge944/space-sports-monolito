import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { resolveRequestId, withoutLocationQuery, withoutQuery } from './logger.options.js';

function call(header?: string) {
  const setHeader = vi.fn();
  const req = {
    headers: header === undefined ? {} : { 'x-request-id': header },
  } as IncomingMessage;
  const id = resolveRequestId(req, { setHeader } as unknown as ServerResponse);
  return { id, setHeader };
}

describe('resolveRequestId', () => {
  it('reaproveita um x-request-id válido e devolve no header', () => {
    const { id, setHeader } = call('abc-123');
    expect(id).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
  });

  it('gera um UUID quando o header falta ou é inválido', () => {
    expect(call().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call('com espaço\n<script>').id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('withoutQuery', () => {
  it('tira a query string da url e o campo query do log da requisição', () => {
    const serialized = withoutQuery({
      id: 'r1',
      method: 'POST',
      url: '/v1/auth/reset?token=segredo&otp=123456',
      query: { token: 'segredo', otp: '123456' },
    });
    expect(serialized).toEqual({ id: 'r1', method: 'POST', url: '/v1/auth/reset' });
    expect(JSON.stringify(serialized)).not.toMatch(/segredo|123456/);
  });

  it('mascara o token do link de reset de senha no caminho e tira os params da rota', () => {
    const serialized = withoutQuery({
      url: '/v1/auth/reset-password/tok3n-secreto?callbackURL=http%3A%2F%2Fweb',
      params: { splat: ['auth', 'reset-password', 'tok3n-secreto'] },
    });
    expect(serialized).toEqual({ url: '/v1/auth/reset-password/[REDACTED]' });

    // O token do convite vale como credencial na página pública.
    expect(withoutQuery({ url: '/v1/public/invites/tok3n-secreto/confirm' })).toEqual({
      url: '/v1/public/invites/[REDACTED]/confirm',
    });
    expect(withoutQuery({ url: '/v1/invites/tok3n-secreto/accept' })).toEqual({
      url: '/v1/invites/[REDACTED]/accept',
    });
  });
});

describe('withoutLocationQuery', () => {
  it('tira a query e o fragmento do location dos redirects', () => {
    expect(
      withoutLocationQuery({
        statusCode: 302,
        headers: { location: 'http://localhost:3000/redefinir?token=segredo#x', vary: 'Origin' },
      }),
    ).toEqual({
      statusCode: 302,
      headers: { location: 'http://localhost:3000/redefinir', vary: 'Origin' },
    });
  });

  it('mantém respostas sem location', () => {
    const res = { statusCode: 200, headers: { 'content-type': 'application/json' } };
    expect(withoutLocationQuery(res)).toBe(res);
  });
});

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppException } from './app.exception.js';
import { findNulByte, nulByteField, rejectNulBytes } from './nul-byte.middleware.js';

const request = (originalUrl: string, query: unknown = {}, body: unknown = undefined) =>
  ({ originalUrl, query, body }) as unknown as Request;

describe('findNulByte (BUG-MCP-3)', () => {
  it('acha o NUL em string ou chave e diz o caminho', () => {
    expect(findNulByte('a\u0000b')).toBe('');
    expect(findNulByte({ q: 'are\u0000na' })).toBe('q');
    expect(findNulByte({ players: [{ name: 'Ana' }, { name: 'Bo\u0000b' }] })).toBe(
      'players.1.name',
    );
    expect(findNulByte({ meta: { 'ch\u0000ave': 1 } })).toBe('meta.chave');
  });

  it('entradas válidas passam: unicode, controle que não é NUL, "\\0" literal, números e Buffer', () => {
    for (const value of [
      undefined,
      null,
      42,
      true,
      'Arena São José 💥‮\t\n',
      '\\u0000 e %00 como texto',
      { amenities: ['wifi', 'bar'], sort: 'rating', nested: { ok: [1, 'x'] } },
      Buffer.from([0, 1, 2]),
    ]) {
      expect(findNulByte(value)).toBeNull();
    }
  });

  it('JSON muito aninhado não estoura a pilha (e o caminho devolvido tem teto)', () => {
    const depth = 100_000;
    const deep = JSON.parse(`${'['.repeat(depth)}"a\\u0000"${']'.repeat(depth)}`);
    expect(findNulByte(deep)).toBe('0.'.repeat(100));
    expect(findNulByte(JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`))).toBeNull();
  });
});

describe('nulByteField', () => {
  it('caminho (parâmetro de rota), query e corpo', () => {
    expect(nulByteField(request('/v1/spaces/a%00b'))).toBe('path');
    expect(nulByteField(request('/v1/spaces/a%2500b'))).toBeNull();
    expect(nulByteField(request('/v1/spaces?q=a%00b', { q: 'a\u0000b' }))).toBe('q');
    expect(nulByteField(request('/v1/me/profile', {}, { name: 'A\u0000' }))).toBe('name');
    expect(nulByteField(request('/v1/spaces?q=arena', { q: 'arena' }, {}))).toBeNull();
  });

  it('confere a URL crua: parâmetro que o parser descartou (depois do milésimo) também conta', () => {
    const many = Array.from({ length: 1000 }, (_, i) => `p${i}=x`).join('&');
    // O `req.query` só tem os 1000 primeiros: o NUL do 1001º não aparece nele.
    const query = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`p${i}`, 'x']));
    expect(nulByteField(request(`/v1/auth/oauth2/authorize?${many}&state=a%00b`, query))).toBe(
      'query',
    );
    expect(nulByteField(request('/v1/spaces?q=a%2500b&city=%2500', { q: 'a%00b' }))).toBeNull();
    expect(nulByteField(request('/v1/spaces?q=%2F%00', { q: '/\u0000' }))).toBe('q');
  });
});

describe('rejectNulBytes', () => {
  const run = (req: Request) => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
    const next = vi.fn();
    rejectNulBytes(req, res, next);
    return { res, json, next };
  };

  it('sem NUL segue adiante', () => {
    const { next, res } = run(request('/v1/spaces', { q: 'arena' }));
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('com NUL: 400 VALIDATION_ERROR com o campo', () => {
    const { next } = run(request('/v1/bookings', {}, { notes: 'x\u0000' }));
    const error = next.mock.calls[0]?.[0] as AppException;
    expect(error).toBeInstanceOf(AppException);
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([
      { field: 'notes', message: expect.any(String), code: 'invalid_format' },
    ]);
  });

  it('rotas OAuth respondem no formato do RFC 6749', () => {
    const { next, res, json } = run(
      request(
        '/v1/auth/oauth2/token',
        {},
        { grant_type: 'refresh_token', refresh_token: '\u0000' },
      ),
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: expect.any(String),
    });
  });
});

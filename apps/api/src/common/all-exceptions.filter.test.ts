import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from './app.exception.js';
import type { ErrorBody } from './error-response.js';

function run(exception: unknown, requestId: unknown = 'req-1') {
  const json = vi.fn((_body: ErrorBody) => undefined);
  const status = vi.fn((_code: number) => ({ json }));
  const setHeader = vi.fn((_name: string, _value: string) => undefined);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId }),
      getResponse: () => ({ status, setHeader }),
    }),
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter();
  const logError = vi
    .spyOn(Reflect.get(filter, 'logger'), 'error')
    .mockImplementation(() => undefined);
  filter.catch(exception, host);

  const body = json.mock.calls[0]?.[0];
  if (!body) throw new Error('o filtro não respondeu');
  return { status: status.mock.calls[0]?.[0], body, logError, setHeader };
}

describe('AllExceptionsFilter', () => {
  it('manda X-Retry-After no 429', () => {
    const exception = new AppException({
      status: HttpStatus.TOO_MANY_REQUESTS,
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitas tentativas.',
      details: { retryAfter: 42 },
    });
    expect(run(exception).setHeader).toHaveBeenCalledWith('X-Retry-After', '42');
  });

  it('converte ZodError em 400 VALIDATION_ERROR com erros por campo', () => {
    const schema = z.object({ email: z.email(), address: z.object({ zip: z.string().length(8) }) });
    const parsed = schema.safeParse({ email: 'x', address: { zip: '1' } });
    if (parsed.success) throw new Error('era para falhar');

    const { status, body } = run(parsed.error);

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        details: [
          { field: 'email', message: expect.any(String), code: 'invalid_format' },
          { field: 'address.zip', message: expect.any(String), code: 'too_small' },
        ],
      },
      requestId: 'req-1',
    });
  });

  it('usa código, mensagem e details da AppException', () => {
    const { status, body } = run(
      new AppException({
        status: HttpStatus.CONFLICT,
        code: 'SLOT_TAKEN',
        message: 'Horário ocupado.',
        details: { courtId: 'c1' },
      }),
    );

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toEqual({
      error: { code: 'SLOT_TAKEN', message: 'Horário ocupado.', details: { courtId: 'c1' } },
      requestId: 'req-1',
    });
  });

  it('não loga AppException 5xx (o código que a lança já decidiu o log)', () => {
    const { status, logError } = run(
      new AppException({ status: 503, code: 'HEALTH_CHECK_FAILED', message: 'Indisponível.' }),
    );
    expect(status).toBe(503);
    expect(logError).not.toHaveBeenCalled();
  });

  it('omite details quando a AppException não tem', () => {
    const { body } = run(
      new AppException({
        status: HttpStatus.FORBIDDEN,
        code: 'NOT_MEMBER',
        message: 'Sem acesso.',
      }),
    );
    expect(body.error).not.toHaveProperty('details');
  });

  it('deriva o código do status nas HttpException do Nest', () => {
    expect(run(new NotFoundException('Espaço não encontrado.'))).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Espaço não encontrado.' } },
    });
    expect(run(new BadRequestException(['a inválido', 'b inválido'])).body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'a inválido; b inválido',
    });
  });

  it('não vaza a mensagem de HttpException 5xx', () => {
    const { status, body, logError } = run(
      new ServiceUnavailableException('host do banco: 10.0.0.5'),
    );
    expect(status).toBe(503);
    expect(body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Erro interno do servidor.',
    });
    expect(logError).toHaveBeenCalledOnce();
  });

  it('responde 500 INTERNAL_ERROR genérico para erros desconhecidos e loga', () => {
    const { status, body, logError } = run(new Error('segredo: senha do banco'));

    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' },
      requestId: 'req-1',
    });
    expect(logError).toHaveBeenCalledOnce();
  });

  it('respeita outros erros 4xx expostos pelos middlewares do Express', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { status, body } = run(tooLarge);

    expect(status).toBe(413);
    expect(body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' });
  });

  it('usa requestId null quando a requisição não tem id', () => {
    expect(run(new NotFoundException(), null).body.requestId).toBeNull();
  });
});

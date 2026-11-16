import { ApiError } from '@space-sports/api-client/dist/fetch.js';
import { describe, expect, it } from 'vitest';
import { ToolError } from '../mcp/tool-error.js';
import { toToolError } from './errors.js';

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  new ApiError({ status, code, message, details, requestId: 'req-1' });

describe('toToolError', () => {
  it('erro de rede ou timeout vira API_UNAVAILABLE', () => {
    expect(toToolError(new TypeError('fetch failed')).code).toBe('API_UNAVAILABLE');
    expect(toToolError(new DOMException('timeout', 'TimeoutError')).code).toBe('API_UNAVAILABLE');
  });

  it('5xx e corpo fora do padrão não repassam a mensagem da API', () => {
    const error = toToolError(apiError(500, 'INTERNAL_ERROR', 'Erro interno: SELECT * FROM users'));
    expect(error.code).toBe('API_UNAVAILABLE');
    expect(error.message).not.toContain('SELECT');
    expect(toToolError(apiError(400, 'HTTP_ERROR', 'Bad Request')).code).toBe('API_UNAVAILABLE');
  });

  it('MCP desligado na API (503 MCP_DISABLED) tem mensagem própria', () => {
    expect(toToolError(apiError(503, 'MCP_DISABLED', 'off')).message).toContain('indisponível');
  });

  it('código conhecido junta a mensagem da API e a orientação', () => {
    const error = toToolError(
      apiError(409, 'SLOT_UNAVAILABLE', 'Este horário acabou de ser ocupado.'),
    );
    expect(error.message).toContain('Este horário acabou de ser ocupado.');
    expect(error.message).toContain('prepare_booking');
  });

  it('código desconhecido usa a mensagem da API (já em português)', () => {
    expect(toToolError(apiError(422, 'NOVO_CODIGO', 'Mensagem nova.')).message).toBe(
      'Mensagem nova.',
    );
  });

  it('VALIDATION_ERROR devolve só os nomes dos campos', () => {
    const error = toToolError(
      apiError(400, 'VALIDATION_ERROR', 'Dados inválidos.', [
        { field: 'peopleCount', message: 'Too big: 99', code: 'too_big' },
      ]),
    );
    expect(error.data).toEqual({ fields: ['peopleCount'] });
    expect(JSON.stringify(error)).not.toContain('99');
  });

  it('PROFILE_INCOMPLETE (decisão 119) manda completar o cadastro no app e diz o que falta', () => {
    const error = toToolError(
      apiError(422, 'PROFILE_INCOMPLETE', 'Complete seu cadastro.', { missing: ['phone', 'x'] }),
    );
    expect(error.code).toBe('PROFILE_INCOMPLETE');
    expect(error.message).toContain('completar o cadastro no app do Space Sports');
    expect(error.message).toContain('Nada foi reservado');
    expect(error.data).toEqual({ missing: ['phone'] });
  });

  it('ToolError passa direto', () => {
    const original = new ToolError('X', 'y');
    expect(toToolError(original)).toBe(original);
  });
});

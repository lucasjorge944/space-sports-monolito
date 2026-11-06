import { ApiError } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { fieldErrorsFrom } from './api-errors';

describe('fieldErrorsFrom', () => {
  it('mapeia os erros por campo do VALIDATION_ERROR', () => {
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
      details: [
        { field: 'address.street', message: 'Obrigatório', code: 'too_small' },
        { field: 'address.street', message: 'Outro', code: 'custom' },
        { field: 'phone', message: 'Use o formato +5531999998888.', code: 'invalid_format' },
      ],
    });
    expect(fieldErrorsFrom(error)).toEqual({
      'address.street': 'Obrigatório',
      phone: 'Use o formato +5531999998888.',
    });
  });

  it('ignora outros erros', () => {
    expect(fieldErrorsFrom(new Error('x'))).toEqual({});
    expect(
      fieldErrorsFrom(new ApiError({ status: 409, code: 'SLUG_TAKEN', message: 'x' })),
    ).toEqual({});
  });
});

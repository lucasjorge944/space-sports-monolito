import { describe, expect, it } from 'vitest';
import { CONFIRMATION_TTL_MS, ConfirmationCodes, idempotencyKeyFor } from './confirmation.js';
import { ToolError } from './tool-error.js';

const SECRET = 'um-segredo-de-teste-com-mais-de-32-caracteres';
const NOW = new Date('2026-11-12T13:00:00Z');
const params = { bookingId: 'b1', reason: null, peopleCount: 4 };

function codes(now = NOW, secret = SECRET) {
  return new ConfirmationCodes(secret, () => now);
}

function rejection(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return (error as ToolError).code;
  }
  throw new Error('esperava recusa');
}

describe('ConfirmationCodes', () => {
  it('aceita o código para a mesma ação, usuário e parâmetros, e devolve os valores esperados', () => {
    const { code, expiresAt } = codes().issue('cancel_booking', 'u1', params, { priceCents: 100 });
    expect(expiresAt.getTime()).toBe(NOW.getTime() + CONFIRMATION_TTL_MS);
    expect(codes().verify(code, 'cancel_booking', 'u1', params)).toEqual({ priceCents: 100 });
  });

  it('a ordem dos parâmetros e ausente × nulo não mudam a conferência', () => {
    const { code } = codes().issue('cancel_booking', 'u1', params);
    expect(() =>
      codes().verify(code, 'cancel_booking', 'u1', {
        peopleCount: 4,
        bookingId: 'b1',
        reason: null,
      }),
    ).not.toThrow();
  });

  it('recusa ausente, malformado, de outro segredo, adulterado, vencido, de outro usuário, ação ou parâmetro', () => {
    const { code } = codes().issue('create_booking', 'u1', params);
    const [v, payload, sig] = code.split('.');
    expect(rejection(() => codes().verify(undefined, 'create_booking', 'u1', params))).toBe(
      'CONFIRMATION_REQUIRED',
    );
    expect(rejection(() => codes().verify('abc', 'create_booking', 'u1', params))).toBe(
      'CONFIRMATION_INVALID',
    );
    expect(
      rejection(() => codes(NOW, `${SECRET}-outro`).verify(code, 'create_booking', 'u1', params)),
    ).toBe('CONFIRMATION_INVALID');
    expect(
      rejection(() =>
        codes().verify(`${v}.${payload}.${sig?.slice(0, -2)}`, 'create_booking', 'u1', params),
      ),
    ).toBe('CONFIRMATION_INVALID');
    expect(
      rejection(() =>
        codes(new Date(NOW.getTime() + CONFIRMATION_TTL_MS)).verify(
          code,
          'create_booking',
          'u1',
          params,
        ),
      ),
    ).toBe('CONFIRMATION_EXPIRED');
    expect(rejection(() => codes().verify(code, 'create_booking', 'u2', params))).toBe(
      'CONFIRMATION_INVALID',
    );
    expect(rejection(() => codes().verify(code, 'cancel_booking', 'u1', params))).toBe(
      'CONFIRMATION_INVALID',
    );
    expect(
      rejection(() => codes().verify(code, 'create_booking', 'u1', { ...params, peopleCount: 5 })),
    ).toBe('CONFIRMATION_MISMATCH');
    expect(
      rejection(() => codes().verify(code, 'create_booking', 'u1', { ...params, extra: 1 })),
    ).toBe('CONFIRMATION_MISMATCH');
  });

  it.each(['=', '==', '!!', '~', ' ', '.'])(
    'recusa a assinatura com sufixo "%s" (o texto é comparado, não o base64url decodificado)',
    (suffix) => {
      const { code } = codes().issue('create_booking', 'u1', params);
      expect(
        rejection(() => codes().verify(`${code}${suffix}`, 'create_booking', 'u1', params)),
      ).toBe('CONFIRMATION_INVALID');
    },
  );

  it('a Idempotency-Key vem só do corpo assinado: variações na assinatura não geram outra chave', () => {
    const { code } = codes().issue('create_booking', 'u1', params);
    expect(idempotencyKeyFor(`${code}=`)).toBe(idempotencyKeyFor(code));
    expect(idempotencyKeyFor(`${code}~`)).toBe(idempotencyKeyFor(code));
  });

  it('a Idempotency-Key é estável por código e aceita pela API (8 a 200 caracteres)', () => {
    const { code } = codes().issue('create_booking', 'u1', params);
    const key = idempotencyKeyFor(code);
    expect(key).toBe(idempotencyKeyFor(code));
    expect(key).toMatch(/^[A-Za-z0-9_.:-]{8,200}$/);
    const other = codes(new Date(NOW.getTime() + 1)).issue('create_booking', 'u1', params).code;
    expect(idempotencyKeyFor(other)).not.toBe(key);
  });
});

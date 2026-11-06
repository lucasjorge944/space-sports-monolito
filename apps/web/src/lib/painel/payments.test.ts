import { describe, expect, it } from 'vitest';
import { bookingDue } from './payments';

describe('payments', () => {
  it('calcula o que falta da reserva e nunca fica negativo', () => {
    expect(bookingDue({ priceCents: 10000, paidCents: 2000 })).toBe(8000);
    expect(bookingDue({ priceCents: 10000, paidCents: 12000 })).toBe(0);
  });

  it('desconta o abatimento do estorno online (decisão 93)', () => {
    // Pix de R$ 120,00 com estorno de R$ 40,00 como abatimento: nada em aberto.
    expect(bookingDue({ priceCents: 12000, paidCents: 8000, discountCents: 4000 })).toBe(0);
    // "Cobrar de novo": sem abatimento, os R$ 40,00 voltam a ficar em aberto.
    expect(bookingDue({ priceCents: 12000, paidCents: 8000, discountCents: 0 })).toBe(4000);
  });
});

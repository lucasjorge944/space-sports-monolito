import { describe, expect, it } from 'vitest';
import { calculateBookingPriceCents, splitBookingPrice } from './pricing';

describe('calculateBookingPriceCents (RN-BOOK-01)', () => {
  it.each([
    [60, 10_000],
    [90, 15_000],
    [120, 20_000],
    [180, 30_000],
  ])('R$ 100/h por %i min = %i centavos', (durationMin, expected) => {
    expect(calculateBookingPriceCents(10_000, durationMin)).toBe(expected);
  });

  it('arredonda ao centavo', () => {
    // 9999 × 50 / 60 = 8332,5 → 8333
    expect(calculateBookingPriceCents(9_999, 50)).toBe(8_333);
  });

  it('rejeita duração inválida e preço fracionado', () => {
    expect(() => calculateBookingPriceCents(10_000, 0)).toThrow(RangeError);
    expect(() => calculateBookingPriceCents(10_000, 1.5)).toThrow(RangeError);
    expect(() => calculateBookingPriceCents(100.5, 60)).toThrow(RangeError);
  });
});

describe('splitBookingPrice (RN-BOOK-09)', () => {
  it('divide igualmente quando é exato', () => {
    expect(splitBookingPrice(20_000, 4).map((s) => s.amountCents)).toEqual([
      5_000, 5_000, 5_000, 5_000,
    ]);
  });

  it('a diferença de arredondamento fica com o organizador', () => {
    const shares = splitBookingPrice(10_000, 3);
    expect(shares).toEqual([
      { isOrganizer: true, amountCents: 3_334 },
      { isOrganizer: false, amountCents: 3_333 },
      { isOrganizer: false, amountCents: 3_333 },
    ]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(10_000);
  });

  it('uma pessoa paga tudo', () => {
    expect(splitBookingPrice(15_000, 1)).toEqual([{ isOrganizer: true, amountCents: 15_000 }]);
  });
});

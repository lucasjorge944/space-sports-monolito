import { canCancelNow } from './cancel';

describe('canCancelNow', () => {
  const until = '2026-11-02T12:00:00.000Z';
  it('permite até o prazo, inclusive', () => {
    expect(canCancelNow(until, new Date('2026-11-02T11:59:59Z'))).toBe(true);
    expect(canCancelNow(until, new Date(until))).toBe(true);
  });
  it('bloqueia depois do prazo', () => {
    expect(canCancelNow(until, new Date('2026-11-02T12:00:01Z'))).toBe(false);
  });
});

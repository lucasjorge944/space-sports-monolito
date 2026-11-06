import { describe, expect, it, vi } from 'vitest';
import { InProcessDomainEvents } from './domain-events.js';

describe('InProcessDomainEvents', () => {
  it('entrega o evento só aos assinantes do tipo', async () => {
    const events = new InProcessDomainEvents();
    const confirmed = vi.fn(async () => {});
    const cancelled = vi.fn(async () => {});
    events.subscribe('booking.confirmed', confirmed);
    events.subscribe('booking.cancelled', cancelled);

    await events.publish({ type: 'booking.confirmed', bookingId: 'b1' });

    expect(confirmed).toHaveBeenCalledWith({ type: 'booking.confirmed', bookingId: 'b1' });
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('um assinante com erro não impede os demais nem derruba a publicação', async () => {
    const events = new InProcessDomainEvents();
    const after = vi.fn(async () => {});
    events.subscribe('booking.confirmed', async () => {
      throw new Error('falhou');
    });
    events.subscribe('booking.confirmed', after);

    await expect(
      events.publish({ type: 'booking.confirmed', bookingId: 'b1' }),
    ).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledOnce();
  });

  it('sem assinantes, publicar é um no-op', async () => {
    await expect(
      new InProcessDomainEvents().publish({ type: 'recurring.approved', recurringBookingId: 'r1' }),
    ).resolves.toBeUndefined();
  });
});

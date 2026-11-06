import type { DeletionRequestPendingItem } from '@space-sports/api-client';
import { describe, expect, it } from 'vitest';
import { pendingLines, pendingParts } from './deletion';

const empty: DeletionRequestPendingItem = {
  spaceId: 's1',
  spaceName: 'Arena A',
  upcomingBookings: 0,
  upcomingRecurringOccurrences: 0,
  openRecurringBookings: 0,
  openSubscriptions: 0,
  upcomingClassAttendances: 0,
  openCharges: 0,
  openChargesCents: 0,
  bookingsDueCents: 0,
};

describe('pendingParts', () => {
  it('não lista o que está zerado', () => {
    expect(pendingParts(empty)).toEqual([]);
  });

  it('descreve cada pendência no singular e no plural, com os valores em reais', () => {
    expect(
      pendingParts({
        ...empty,
        upcomingBookings: 1,
        openRecurringBookings: 2,
        upcomingRecurringOccurrences: 8,
        openSubscriptions: 1,
        upcomingClassAttendances: 3,
        openCharges: 2,
        openChargesCents: 31000,
        bookingsDueCents: 5000,
      }),
    ).toEqual([
      '1 reserva futura',
      '2 mensalistas',
      '8 ocorrências futuras',
      '1 assinatura de aula',
      '3 presenças futuras em aula',
      expect.stringMatching(/^2 mensalidades em aberto \(R\$\s310,00\)$/),
      expect.stringMatching(/^R\$\s50,00 a receber de reservas$/),
    ]);
  });
});

describe('pendingLines', () => {
  it('traz uma linha por espaço com pendência e ignora os demais', () => {
    const lines = pendingLines([
      { ...empty, upcomingBookings: 2 },
      { ...empty, spaceId: 's2', spaceName: 'Arena B' },
    ]);
    expect(lines).toEqual([{ spaceId: 's1', spaceName: 'Arena A', text: '2 reservas futuras' }]);
  });

  it('aceita a lista nula (pedido já resolvido)', () => {
    expect(pendingLines(null)).toEqual([]);
  });
});

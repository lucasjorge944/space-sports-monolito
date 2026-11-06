import type { AvailabilityResponseDto } from '@space-sports/api-client';
import { clampPeople, defaultPeople, durationOptions, timeOptions } from './slots';

const slot = (h: number, available: boolean) => ({
  startsAt: `2026-11-02T${String(h).padStart(2, '0')}:00:00.000Z`,
  endsAt: `2026-11-02T${String(h + 1).padStart(2, '0')}:00:00.000Z`,
  available,
});

const availability: AvailabilityResponseDto = {
  date: '2026-11-02',
  timeZone: 'America/Sao_Paulo',
  durationMin: 60,
  pricePerHourCents: 10000,
  priceCents: 10000,
  courts: [
    {
      id: 'a',
      name: 'Quadra A',
      covered: true,
      maxPlayers: 4,
      slots: [slot(12, true), slot(13, false)],
    },
    {
      id: 'b',
      name: 'Quadra B',
      covered: false,
      maxPlayers: 8,
      slots: [slot(12, true), slot(13, true)],
    },
  ],
};

describe('timeOptions', () => {
  it('une os horários das quadras e lista as quadras livres em cada um', () => {
    const options = timeOptions(availability);
    expect(options.map((o) => o.courts.map((c) => c.id))).toEqual([['a', 'b'], ['b']]);
  });

  it('ignora horários ocupados e ordena por início', () => {
    const options = timeOptions({
      ...availability,
      courts: [
        { ...availability.courts[0], slots: [slot(14, true), slot(12, false), slot(13, true)] },
      ] as never,
    });
    expect(options.map((o) => o.startsAt.slice(11, 13))).toEqual(['13', '14']);
  });

  it('sem quadra livre não há horários', () => {
    expect(timeOptions({ ...availability, courts: [] })).toEqual([]);
  });
});

describe('opções de reserva', () => {
  it('lista durações de 30 em 30 min', () => {
    expect(durationOptions(60, 180)).toEqual([60, 90, 120, 150, 180]);
  });
  it('limita pessoas à capacidade', () => {
    expect(defaultPeople(1)).toBe(1);
    expect(defaultPeople(8)).toBe(2);
    expect(clampPeople(8, 4)).toBe(4);
    expect(clampPeople(0, 4)).toBe(1);
  });
});

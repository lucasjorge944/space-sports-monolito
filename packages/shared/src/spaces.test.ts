import { describe, expect, it } from 'vitest';
import {
  courtCapacity,
  createCourtSchema,
  instagramSchema,
  replaceOpeningHoursSchema,
  SPACE_SETTINGS_DEFAULTS,
  spaceSearchQuerySchema,
  spaceSettingsSchema,
  updateCourtSchema,
  updateSpaceSchema,
  updateSpaceSettingsSchema,
} from './spaces';

const valid = {
  ...SPACE_SETTINGS_DEFAULTS,
  pricePerHourCents: 12_000,
};

describe('spaceSettingsSchema (RF-SPACE-04, docs/02 seção 2.1)', () => {
  it('aceita os padrões do doc', () => {
    expect(spaceSettingsSchema.parse(valid)).toEqual(valid);
    expect(SPACE_SETTINGS_DEFAULTS).toMatchObject({
      bookingMinDurationMin: 60,
      bookingMaxDurationMin: 180,
      bookingMinAdvanceMin: 60,
      bookingWindowDays: 30,
      cancellationDeadlineMin: 60,
      attendanceMode: 'AUTOMATIC',
      attendanceOpenBeforeMin: 1440,
      attendanceCloseBeforeMin: 60,
      attendanceCancelDeadlineMin: 120,
      pastDueBlockEnabled: true,
      pastDueBlockDays: 7,
      acceptedPaymentMethods: ['PIX', 'CARD', 'CASH'],
    });
  });

  it('valida o limite de atraso das aulas (RN-CLASS-06)', () => {
    expect(spaceSettingsSchema.safeParse({ ...valid, pastDueBlockDays: 0 }).success).toBe(false);
    expect(spaceSettingsSchema.safeParse({ ...valid, pastDueBlockEnabled: false }).success).toBe(
      true,
    );
  });

  it('exige durações em múltiplos de 30 min', () => {
    for (const bookingMinDurationMin of [45, 0, 61]) {
      expect(spaceSettingsSchema.safeParse({ ...valid, bookingMinDurationMin }).success).toBe(
        false,
      );
    }
    expect(spaceSettingsSchema.safeParse({ ...valid, bookingMinDurationMin: 30 }).success).toBe(
      true,
    );
    expect(spaceSettingsSchema.safeParse({ ...valid, bookingMaxDurationMin: 90 }).success).toBe(
      true,
    );
  });

  it('exige mínimo ≤ máximo', () => {
    const result = spaceSettingsSchema.safeParse({
      ...valid,
      bookingMinDurationMin: 120,
      bookingMaxDurationMin: 90,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['bookingMaxDurationMin']);
    expect(
      spaceSettingsSchema.safeParse({
        ...valid,
        bookingMinDurationMin: 90,
        bookingMaxDurationMin: 90,
      }).success,
    ).toBe(true);
  });

  it('a lista de presença fecha depois de abrir', () => {
    expect(
      spaceSettingsSchema.safeParse({
        ...valid,
        attendanceOpenBeforeMin: 60,
        attendanceCloseBeforeMin: 60,
      }).success,
    ).toBe(false);
  });

  it('dinheiro em centavos inteiros; formas de pagamento sem repetição', () => {
    expect(spaceSettingsSchema.safeParse({ ...valid, pricePerHourCents: 100.5 }).success).toBe(
      false,
    );
    expect(spaceSettingsSchema.safeParse({ ...valid, pricePerHourCents: -1 }).success).toBe(false);
    expect(
      spaceSettingsSchema.safeParse({ ...valid, acceptedPaymentMethods: ['PIX', 'PIX'] }).success,
    ).toBe(false);
    expect(spaceSettingsSchema.safeParse({ ...valid, acceptedPaymentMethods: [] }).success).toBe(
      false,
    );
  });

  it('o PATCH é parcial, rejeita campos desconhecidos e não aceita preço nulo', () => {
    expect(updateSpaceSettingsSchema.parse({ bookingWindowDays: 15 })).toEqual({
      bookingWindowDays: 15,
    });
    expect(updateSpaceSettingsSchema.safeParse({ foo: 1 }).success).toBe(false);
    expect(updateSpaceSettingsSchema.safeParse({ pricePerHourCents: null }).success).toBe(false);
  });
});

describe('replaceOpeningHoursSchema', () => {
  const parse = (openingHours: unknown) => replaceOpeningHoursSchema.safeParse({ openingHours });

  it('aceita intervalos separados no mesmo dia e o que passa da meia-noite', () => {
    expect(
      parse([
        { weekday: 1, opensAt: '06:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '14:00', closesAt: '23:00' },
        { weekday: 5, opensAt: '18:00', closesAt: '02:00' },
        { weekday: 6, opensAt: '08:00', closesAt: '20:00' },
      ]).success,
    ).toBe(true);
  });

  it('rejeita sobreposição, inclusive vinda da madrugada do dia anterior', () => {
    expect(
      parse([
        { weekday: 1, opensAt: '06:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '11:00', closesAt: '14:00' },
      ]).success,
    ).toBe(false);
    expect(
      parse([
        { weekday: 5, opensAt: '18:00', closesAt: '02:00' },
        { weekday: 6, opensAt: '01:00', closesAt: '10:00' },
      ]).success,
    ).toBe(false);
    // Sábado que vira domingo de madrugada.
    expect(
      parse([
        { weekday: 6, opensAt: '20:00', closesAt: '03:00' },
        { weekday: 0, opensAt: '02:00', closesAt: '10:00' },
      ]).success,
    ).toBe(false);
  });

  it('rejeita horário inválido', () => {
    expect(parse([{ weekday: 7, opensAt: '06:00', closesAt: '12:00' }]).success).toBe(false);
    expect(parse([{ weekday: 1, opensAt: '24:00', closesAt: '12:00' }]).success).toBe(false);
  });
});

describe('dados do espaço e quadras', () => {
  it('normaliza CEP e Instagram', () => {
    expect(
      updateSpaceSchema.parse({
        address: { street: 'Rua A', number: '10', neighborhood: 'Centro', postalCode: '30130-010' },
        instagram: '@arena.7',
      }),
    ).toMatchObject({ address: { postalCode: '30130010' }, instagram: 'arena.7' });
    expect(instagramSchema.safeParse('com espaço').success).toBe(false);
  });

  it('quadra: só os esportes (decisão 51), pelo menos um, sem repetir', () => {
    const sportId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(createCourtSchema.parse({ name: 'Quadra 1', sportIds: [sportId] })).toEqual({
      name: 'Quadra 1',
      covered: false,
      status: 'ACTIVE',
      sportIds: [sportId],
    });
    expect(
      createCourtSchema.safeParse({ name: 'Q', sports: [{ sportId, maxPlayers: 8 }] }).success,
    ).toBe(false);
    expect(updateCourtSchema.safeParse({ sports: [{ sportId, maxPlayers: 8 }] }).success).toBe(
      false,
    );
    expect(createCourtSchema.safeParse({ name: 'Q', sportIds: [] }).success).toBe(false);
    expect(createCourtSchema.safeParse({ name: 'Q', sportIds: [sportId, sportId] }).success).toBe(
      false,
    );
  });

  it('capacidade: o padrão do esporte, até 20 (decisões 18 e 51)', () => {
    expect(courtCapacity(8)).toBe(8);
    expect(courtCapacity(null)).toBe(20);
    expect(courtCapacity(30)).toBe(20);
  });
});

describe('spaceSearchQuerySchema', () => {
  it('converte a query string', () => {
    expect(
      spaceSearchQuerySchema.parse({
        lat: '-19.9',
        lng: '-43.9',
        amenities: 'wi-fi, banheiro',
        limit: '5',
      }),
    ).toEqual({
      lat: -19.9,
      lng: -43.9,
      amenities: ['wi-fi', 'banheiro'],
      sort: 'distance',
      limit: 5,
    });
  });

  it('nota mínima e ordem (decisão 109)', () => {
    expect(spaceSearchQuerySchema.parse({ minRating: '4', sort: 'rating' })).toMatchObject({
      minRating: 4,
      sort: 'rating',
    });
    for (const minRating of ['0', '6', '4.5', 'abc', '']) {
      expect(spaceSearchQuerySchema.safeParse({ minRating }).success, minRating).toBe(false);
    }
    expect(spaceSearchQuerySchema.safeParse({ sort: 'price' }).success).toBe(false);
  });

  it('exige lat e lng juntos e o raio só com eles', () => {
    expect(spaceSearchQuerySchema.safeParse({ lat: '-19.9' }).success).toBe(false);
    expect(spaceSearchQuerySchema.safeParse({ radiusKm: '5' }).success).toBe(false);
    expect(spaceSearchQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});

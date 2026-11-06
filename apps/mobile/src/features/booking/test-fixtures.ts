import type {
  AvailabilityResponseDto,
  PlayerBookingDetailDto,
  PublicSpace,
} from '@space-sports/api-client';

/** 02/11/2026, das 10:00 às 11:00 em São Paulo, a R$ 100/h. */
export function booking(extra: Partial<PlayerBookingDetailDto> = {}): PlayerBookingDetailDto {
  return {
    id: 'b1',
    space: { id: 's1', name: 'Arena 7', slug: 'arena-7', timeZone: 'America/Sao_Paulo' },
    court: { id: 'c1', name: 'Quadra A', covered: false },
    sport: { id: 'sp1', name: 'Futevôlei', slug: 'futevolei' },
    organizer: { userId: 'u1', name: 'Bruno', phone: null },
    startsAt: '2026-11-02T13:00:00.000Z',
    endsAt: '2026-11-02T14:00:00.000Z',
    durationMin: 60,
    peopleCount: 2,
    pricePerHourCents: 10_000,
    priceCents: 10_000,
    status: 'CONFIRMED',
    intendedPaymentMethod: null,
    source: 'APP',
    cancellableUntil: '2026-11-02T12:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    createdAt: '2026-10-29T12:00:00.000Z',
    serverTime: '2026-10-29T12:00:00.000Z',
    paidCents: 0,
    paymentStatus: 'PENDING',
    participants: [],
    myShare: { participantId: null, shareCents: 10_000 },
    canEditPeople: true,
    peopleEditBlock: null,
    canEditSchedule: true,
    scheduleEditBlock: null,
    ...extra,
  } as PlayerBookingDetailDto;
}

export function space(extra: Partial<PublicSpace> = {}): PublicSpace {
  return {
    id: 's1',
    slug: 'arena-7',
    name: 'Arena 7',
    whatsapp: null,
    courts: [
      {
        id: 'c1',
        name: 'Quadra A',
        covered: false,
        sports: [{ sportId: 'sp1', slug: 'futevolei', name: 'Futevôlei', maxPlayers: 4 }],
      },
    ],
    rental: {
      pricePerHourCents: 20_000,
      minDurationMin: 60,
      maxDurationMin: 120,
      minAdvanceMin: 60,
      windowDays: 7,
      cancellationDeadlineMin: 60,
    },
    ...extra,
  } as PublicSpace;
}

/** Grade de uma quadra com os horários dados (ISO), todos livres. */
export function availability(
  starts: string[],
  durationMin = 60,
  extra: Partial<AvailabilityResponseDto> = {},
): AvailabilityResponseDto {
  return {
    date: '2026-11-02',
    timeZone: 'America/Sao_Paulo',
    durationMin,
    pricePerHourCents: 10_000,
    priceCents: (10_000 * durationMin) / 60,
    courts: [
      {
        id: 'c1',
        name: 'Quadra A',
        covered: false,
        maxPlayers: 4,
        slots: starts.map((startsAt) => ({
          startsAt,
          endsAt: new Date(new Date(startsAt).getTime() + durationMin * 60_000).toISOString(),
          available: true,
        })),
      },
    ],
    ...extra,
  } as AvailabilityResponseDto;
}

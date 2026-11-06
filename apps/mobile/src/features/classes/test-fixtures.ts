import type {
  MyClassSessionDetail,
  PublicSpaceClasses,
  SubscriptionDetail,
} from '@space-sports/api-client';

export const SPACE = {
  id: 's1',
  name: 'Arena 7',
  slug: 'arena-7',
  timeZone: 'America/Sao_Paulo',
};

const SPORT = { id: 'sp1', name: 'Futevôlei', slug: 'futevolei' };

export function publicGroup(
  id: string,
  extra: Partial<PublicSpaceClasses['classGroups'][number]> = {},
): PublicSpaceClasses['classGroups'][number] {
  return {
    id,
    name: `Turma ${id}`,
    sport: SPORT,
    level: 'BEGINNER',
    court: { id: 'c1', name: 'Quadra A' },
    weekday: 6,
    startTime: '07:00',
    durationMin: 60,
    capacity: 10,
    enrolledCount: 4,
    availableSpots: 6,
    teachers: [{ name: 'Ana', avatarUrl: null }],
    ...extra,
  };
}

export function publicPlan(
  id: string,
  extra: Partial<PublicSpaceClasses['plans'][number]> = {},
): PublicSpaceClasses['plans'][number] {
  return {
    id,
    name: `Plano ${id}`,
    sport: SPORT,
    weeklyFrequency: 2,
    priceCents: 29_900,
    billingDay: 10,
    ...extra,
  };
}

export function publicClasses(
  plans: PublicSpaceClasses['plans'],
  classGroups: PublicSpaceClasses['classGroups'],
): PublicSpaceClasses {
  return { space: SPACE, plans, classGroups };
}

export function subscription(extra: Partial<SubscriptionDetail> = {}): SubscriptionDetail {
  return {
    id: 'sub1',
    space: SPACE,
    plan: { id: 'p1', name: 'Plano 2x', sport: SPORT, weeklyFrequency: 2, billingDay: 10 },
    student: { userId: 'u1', name: 'Bruno', avatarUrl: null },
    status: 'ACTIVE',
    priceCents: 29_900,
    intendedPaymentMethod: 'PIX',
    startsOn: '2026-10-01',
    currentPeriodStart: '2026-10-01',
    currentPeriodEnd: '2026-10-31',
    cancelAtPeriodEnd: false,
    endsOn: null,
    accessUntil: null,
    accessUntilIfCancelled: '2026-10-31',
    rejected: false,
    statusReason: null,
    approvedAt: '2026-10-01T12:00:00.000Z',
    cancelledAt: null,
    createdAt: '2026-09-28T12:00:00.000Z',
    enrollments: [
      {
        id: 'e1',
        status: 'ACTIVE',
        startedOn: '2026-10-01',
        endedOn: null,
        classGroup: {
          id: 'g1',
          name: 'Futevôlei iniciante',
          weekday: 6,
          startTime: '07:00',
          durationMin: 60,
          court: { id: 'c1', name: 'Quadra A' },
          teachers: [{ name: 'Ana', avatarUrl: null }],
          active: true,
        },
      },
    ],
    nextCharge: {
      chargeId: 'ch2',
      dueDate: '2026-11-10',
      amountCents: 29_900,
      status: 'PENDING',
    },
    overdueCents: 0,
    charges: [
      {
        id: 'ch2',
        subscriptionId: 'sub1',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        dueDate: '2026-11-10',
        amountCents: 29_900,
        paidCents: 0,
        discountCents: 0,
        dueCents: 29_900,
        openOnlineCharge: null,
        status: 'PENDING',
        waivedAt: null,
        waiveNotice: null,
        payments: [],
        createdAt: '2026-10-28T12:00:00.000Z',
      },
      {
        id: 'ch1',
        subscriptionId: 'sub1',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        dueDate: '2026-10-10',
        amountCents: 29_900,
        paidCents: 29_900,
        discountCents: 0,
        dueCents: 0,
        openOnlineCharge: null,
        status: 'PAID',
        waivedAt: null,
        waiveNotice: null,
        payments: [
          {
            id: 'pay1',
            amountCents: 29_900,
            method: 'PIX',
            channel: 'ON_SITE',
            onlineChargeId: null,
            paidAt: '2026-10-09T15:00:00.000Z',
          },
        ],
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    ],
    ...extra,
  };
}

export function classSession(extra: Partial<MyClassSessionDetail> = {}): MyClassSessionDetail {
  return {
    id: 'ses1',
    classGroup: { id: 'g1', name: 'Futevôlei iniciante' },
    sport: SPORT,
    level: 'BEGINNER',
    court: { id: 'c1', name: 'Quadra A' },
    teachers: [{ name: 'Ana', avatarUrl: null }],
    startsAt: '2026-11-07T10:00:00.000Z',
    endsAt: '2026-11-07T11:00:00.000Z',
    capacity: 10,
    status: 'OPEN',
    confirmedCount: 2,
    waitlistCount: 0,
    cancelReason: null,
    space: SPACE,
    myAttendance: null,
    canConfirm: true,
    canWithdraw: false,
    blockedReason: null,
    cancellableUntil: '2026-11-07T08:00:00.000Z',
    confirmed: [
      { userId: 'u2', name: 'Carla', avatarUrl: null },
      { userId: 'u3', name: 'Diego', avatarUrl: null },
    ],
    ...extra,
  } as MyClassSessionDetail;
}

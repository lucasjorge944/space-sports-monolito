import {
  auditLogPageSchema,
  bookingAnalyticsSchema,
  chargebackListSchema,
  classAnalyticsSchema,
  classAttendancesResponseSchema,
  classGroupDetailSchema,
  classGroupFrequencySchema,
  classGroupsResponseSchema,
  classSessionConflictsResponseSchema,
  classSessionDetailSchema,
  classSessionsResponseSchema,
  courtBlockSchema,
  courtListSchema,
  courtSchema,
  customerAnalyticsSchema,
  delinquentsResponseSchema,
  financeSummarySchema,
  ledgerEntryPageSchema,
  managedSpaceSchema,
  manageReviewPageSchema,
  manageReviewSummarySchema,
  monthlyFeeReportSchema,
  occupancyAnalyticsSchema,
  onlineChargePageSchema,
  onlineChargeSchema,
  planSchema,
  plansResponseSchema,
  platformAnalyticsSchema,
  platformRevenueSchema,
  receivablesTodaySchema,
  revenueAnalyticsSchema,
  spaceBookingDetailSchema,
  spaceBookingPageSchema,
  spaceSubscriptionChargePageSchema,
  spacesAnalyticsSchema,
  staffSpacesResponseSchema,
  statementSchema,
  superMetricsSchema,
  superReviewReportPageSchema,
  superReviewSummarySchema,
  superSpaceListSchema,
  superSpaceSchema,
  superUserListSchema,
  superUserSchema,
  teamSchema,
  walletSummarySchema,
} from '@space-sports/shared';
import { z } from 'zod';

// Visão do MCP nas rotas de gestão e do Super (decisão 122, RN-MCP-07; docs/14-mcp.md 8.2): para
// cada rota, a LISTA DE CAMPOS PERMITIDOS da resposta ao token do MCP, montada com `.pick()` dos
// schemas de `packages/shared` (o contrato da rota). Os objetos do Zod descartam o que não está
// listado, então campo novo na API nunca sai pelo MCP sem entrar aqui; e cada objeto aninhado tem a
// sua própria lista (liberar um objeto inteiro sem lista é erro no carregamento). Nome sim;
// telefone, e-mail, documento, endereço (rua, número, CEP, coordenadas), nascimento, foto, tokens,
// links de convite, dados de cartão e dados bancários nunca, nem para o Super. Textos livres de
// terceiros sem utilidade para a análise (observações, motivos, detalhes de denúncia) também saem.
// As visões com valores (`finance`) só valem com `manage:finance:read` e papel de Dono ou Admin no
// espaço (decisão 53): nas outras, os campos de valor saem nulos (ou vazios), como para o Professor.

/** Lista de campos permitidos: `true` libera o campo (só valor simples); um objeto, os dele. */
type Mask = { readonly [key: string]: true | Mask };

/** Campo simples: texto, número, booleano, enum, data (ou lista disso). Objeto precisa de lista. */
function isStructured(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return isStructured(schema.unwrap() as z.ZodType);
  }
  if (schema instanceof z.ZodDefault) return isStructured(schema.removeDefault() as z.ZodType);
  if (schema instanceof z.ZodArray) return isStructured(schema.element as z.ZodType);
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodType[]).some((option) => isStructured(option));
  }
  return (
    schema instanceof z.ZodObject ||
    schema instanceof z.ZodRecord ||
    schema instanceof z.ZodMap ||
    schema instanceof z.ZodUnknown ||
    schema instanceof z.ZodAny
  );
}

/**
 * `.pick()` em profundidade: aplica a lista ao objeto, aos objetos aninhados e aos itens das
 * listas, mantendo os validadores do schema de origem. Chave fora do schema ou objeto liberado sem
 * lista própria quebram já no carregamento do módulo.
 */
function allow(schema: z.ZodType, mask: Mask, path = '$'): z.ZodType {
  if (schema instanceof z.ZodNullable) {
    return allow(schema.unwrap() as z.ZodType, mask, path).nullable();
  }
  if (schema instanceof z.ZodOptional) {
    return allow(schema.unwrap() as z.ZodType, mask, path).optional();
  }
  if (schema instanceof z.ZodArray) return z.array(allow(schema.element as z.ZodType, mask, path));
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`Visão do MCP: ${path} não é um objeto.`);
  }
  const shape = schema.shape as Record<string, z.ZodType>;
  const nested: Record<string, z.ZodType> = {};
  for (const [key, rule] of Object.entries(mask)) {
    const field = shape[key];
    if (!field) throw new Error(`Visão do MCP: ${path}.${key} não existe no schema.`);
    if (rule === true) {
      if (isStructured(field)) {
        throw new Error(`Visão do MCP: ${path}.${key} é um objeto; liste os campos dele.`);
      }
    } else {
      nested[key] = allow(field, rule, `${path}.${key}`);
    }
  }
  const keys = Object.fromEntries(Object.keys(mask).map((key) => [key, true as const]));
  const picked = schema.pick(keys as Parameters<typeof schema.pick>[0]);
  return Object.keys(nested).length ? picked.extend(nested) : picked;
}

/** `allow` que devolve o objeto (para `.extend` dos campos escondidos). */
const allowObject = (schema: z.ZodType, mask: Mask) => allow(schema, mask) as z.ZodObject;

/** Campo de valor escondido sem acesso a valores: sempre nulo. */
const hiddenValue = z.unknown().transform(() => null);
/** Lista de valores escondida sem acesso a valores: sempre vazia. */
const hiddenList = z.unknown().transform(() => [] as never[]);
const hide = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, hiddenValue])) as Record<string, z.ZodType>;

const ref = { id: true, name: true } as const;
const sportRef = { id: true, name: true, slug: true } as const;
const spaceRef = { id: true, name: true, slug: true, timeZone: true } as const;
/** Pessoa pelo nome (sem foto nem contato). */
const person = { userId: true, name: true } as const;
const city = { id: true, name: true, state: true } as const;
const openingHour = { weekday: true, opensAt: true, closesAt: true } as const;
const amenity = { id: true, slug: true, name: true } as const;
const period = { from: true, to: true } as const;

// ---------------------------------------------------------------------------------------------
// Gestão (recurso do jogador, `manage:read` / `manage:finance:read`)
// ---------------------------------------------------------------------------------------------

/** GET /v1/me/staff-spaces: espaços com vínculo, papéis e a agenda do dia (sem valores nem fotos). */
const staffSpaces = allow(staffSpacesResponseSchema, {
  items: {
    space: { id: true, name: true, slug: true, status: true, timeZone: true },
    roles: true,
    today: {
      date: true,
      bookings: {
        id: true,
        court: ref,
        sportName: true,
        startsAt: true,
        endsAt: true,
        status: true,
        source: true,
        peopleCount: true,
        customerName: true,
      },
      classSessions: {
        id: true,
        classGroup: ref,
        sportName: true,
        court: ref,
        teachers: { name: true },
        startsAt: true,
        endsAt: true,
        status: true,
        capacity: true,
        confirmedCount: true,
        waitlistCount: true,
        attendees: { userId: true, name: true, status: true, waitlistPosition: true },
      },
    },
  },
});

/** GET /manage/spaces/:spaceId: o espaço, sem endereço completo, contato, fotos nem localização. */
const managedSpace = allow(managedSpaceSchema, {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  address: { neighborhood: true, city },
  amenities: amenity,
  openingHours: openingHour,
});

const courtMask = {
  id: true,
  name: true,
  covered: true,
  status: true,
  sports: { sportId: true, slug: true, name: true, maxPlayers: true },
} as const;

const bookingCore = {
  id: true,
  space: spaceRef,
  court: ref,
  sport: sportRef,
  /** Organizador só pelo nome (o telefone do balcão nunca sai). */
  organizer: { userId: true, name: true },
  startsAt: true,
  endsAt: true,
  durationMin: true,
  peopleCount: true,
  status: true,
  source: true,
  cancellableUntil: true,
  cancelledAt: true,
  createdAt: true,
} as const;
const bookingMoney = {
  pricePerHourCents: true,
  priceCents: true,
  paidCents: true,
  discountCents: true,
  paymentStatus: true,
  intendedPaymentMethod: true,
  paymentDueAt: true,
} as const;
const bookingMoneyKeys = Object.keys(bookingMoney);

const spaceBookingPage = (money: boolean) => {
  const page = allowObject(spaceBookingPageSchema, {
    items: money ? { ...bookingCore, ...bookingMoney } : bookingCore,
    nextCursor: true,
  });
  if (money) return page;
  const item = (page.shape.items as z.ZodArray<z.ZodObject>).element;
  return page.extend({ items: z.array(item.extend(hide(bookingMoneyKeys))) });
};

/** Detalhe: participantes pelo nome, sem convite (token e link), sem cobranças online nem notas. */
const spaceBookingDetail = (money: boolean) => {
  const participants = {
    id: true,
    userId: true,
    name: true,
    isOrganizer: true,
    status: true,
  } as const;
  if (money) {
    return allow(spaceBookingDetailSchema, {
      ...bookingCore,
      ...bookingMoney,
      participants: { ...participants, shareCents: true },
      payments: {
        id: true,
        payableType: true,
        amountCents: true,
        method: true,
        channel: true,
        paidAt: true,
        reversedAt: true,
      },
    });
  }
  const detail = allowObject(spaceBookingDetailSchema, { ...bookingCore, participants });
  const participant = (detail.shape.participants as z.ZodArray<z.ZodObject>).element;
  return detail.extend({
    ...hide(bookingMoneyKeys),
    participants: z.array(participant.extend(hide(['shareCents']))),
    payments: hiddenList,
  });
};

/** GET court-blocks (lista de bloqueios), sem quem criou. */
const courtBlocks = z.array(
  allow(courtBlockSchema, {
    id: true,
    courtId: true,
    startsAt: true,
    endsAt: true,
    reason: true,
    createdAt: true,
  }),
);

const receivedFigures = { receivedCents: true, paymentsCount: true } as const;

const teacher = { memberId: true, userId: true, name: true } as const;

const classGroupCore = {
  id: true,
  name: true,
  sport: sportRef,
  level: true,
  teachers: teacher,
  court: ref,
  weekday: true,
  startTime: true,
  durationMin: true,
  capacity: true,
  active: true,
  enrolledCount: true,
  availableSpots: true,
  createdAt: true,
} as const;

const classConflict = {
  id: true,
  classGroup: ref,
  court: ref,
  startsAt: true,
  endsAt: true,
  conflictsWith: true,
  createdAt: true,
} as const;

const classSessionCore = {
  id: true,
  classGroup: ref,
  sport: sportRef,
  level: true,
  court: ref,
  teachers: teacher,
  startsAt: true,
  endsAt: true,
  capacity: true,
  status: true,
  confirmedCount: true,
  waitlistCount: true,
  cancelReason: true,
} as const;

const attendanceTotals = {
  present: true,
  absent: true,
  unmarked: true,
  attendanceRate: true,
} as const;

const planMask = {
  id: true,
  name: true,
  sport: sportRef,
  weeklyFrequency: true,
  /** Preço de tabela do plano (público na página do espaço), não um recebimento. */
  priceCents: true,
  billingDay: true,
  active: true,
  createdAt: true,
} as const;

const tagCount = { tag: true, count: true } as const;
const reviewHighlights = { positive: tagCount, negative: tagCount } as const;
const reviewDistribution = { rating: true, count: true } as const;

/** Cobrança online sem cartão, ids do gateway, ambiente de teste nem textos livres. */
const onlineChargeMask = {
  id: true,
  payableType: true,
  payableId: true,
  payer: person,
  method: true,
  status: true,
  amountCents: true,
  serviceAmountCents: true,
  platformFeeCents: true,
  spaceNetCents: true,
  feePayer: true,
  refundedCents: true,
  refundableCents: true,
  expiresAt: true,
  paidAt: true,
  availableAt: true,
  createdAt: true,
  refunds: {
    id: true,
    kind: true,
    status: true,
    amountCents: true,
    reasonCode: true,
    createdAt: true,
    dispute: { status: true, respondBy: true, respondedAt: true, resolvedAt: true },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Super (recurso do Super, `super:read`)
// ---------------------------------------------------------------------------------------------

/** Donos só pelo nome (sem e-mail). */
const owner = { id: true, name: true } as const;

const revenueFigures = {
  chargesCount: true,
  volumeCents: true,
  grossFeeCents: true,
  gatewayCostCents: true,
  feeRefundedCents: true,
  feeRechargedCents: true,
  netRevenueCents: true,
} as const;

const superUserCore = {
  id: true,
  name: true,
  status: true,
  platformRole: true,
  createdAt: true,
  deletedAt: true,
  spacesCount: true,
} as const;

// ---------------------------------------------------------------------------------------------
// Camada de métricas (MCP2.2; docs/14-mcp.md 8.4): período, agrupamento, colunas, chave e rótulo de
// cada linha e os números, campo a campo. Os rótulos são nomes (quadra, esporte, turma, professor,
// cliente, espaço), nunca contato; o cliente sem conta sai com a chave `guest-N`.
// ---------------------------------------------------------------------------------------------

/** Visão de uma métrica: os mesmos campos numéricos nas linhas e nos totais. */
const analyticsView = (schema: z.ZodType, values: Mask, extra: Mask = {}) =>
  allow(schema, {
    period,
    groupBy: true,
    timezone: true,
    columns: { key: true, label: true, unit: true },
    rows: { key: true, label: true, ...values },
    totals: values,
    ...extra,
  });

const analytics = {
  /** GET …/analytics/bookings (`manage:read`; sem valores). */
  bookingAnalytics: analyticsView(bookingAnalyticsSchema, {
    bookings: true,
    hours: true,
    noShows: true,
    cancelled: true,
    cancellationRate: true,
  }),
  /** GET …/analytics/occupancy (`manage:read`). */
  occupancyAnalytics: analyticsView(occupancyAnalyticsSchema, {
    openHours: true,
    blockedHours: true,
    availableHours: true,
    bookedHours: true,
    classHours: true,
    occupancyRate: true,
    utilizationRate: true,
  }),
  /** GET …/analytics/classes (`manage:read`; o Professor só com as turmas dele). */
  classAnalytics: analyticsView(classAnalyticsSchema, {
    sessionsDone: true,
    sessionsCancelled: true,
    present: true,
    absent: true,
    unmarked: true,
    attendanceRate: true,
    activeStudents: true,
  }),
  /** GET …/analytics/customers (`manage:read`; Dono e Admin): nome e contagens. */
  customerAnalytics: analyticsView(customerAnalyticsSchema, {
    customers: true,
    newCustomers: true,
    returningCustomers: true,
    recurringCustomers: true,
    bookings: true,
    hours: true,
  }),
  /** GET …/analytics/revenue (só `manage:finance:read`, Dono e Admin). */
  revenueAnalytics: analyticsView(revenueAnalyticsSchema, {
    receivedCents: true,
    paymentsCount: true,
    reversedCents: true,
    receivableCents: true,
  }),
  /** GET /v1/super/analytics/platform (`super:read`). */
  platformAnalytics: analyticsView(platformAnalyticsSchema, {
    bookings: true,
    bookedHours: true,
    newUsers: true,
    newSpaces: true,
    activeSpaces: true,
    onlinePayments: true,
    onlineVolumeCents: true,
    platformRevenueCents: true,
  }),
  /** GET /v1/super/analytics/spaces (`super:read`). */
  spacesAnalytics: analyticsView(
    spacesAnalyticsSchema,
    {
      bookings: true,
      previousBookings: true,
      bookingsDelta: true,
      presences: true,
      previousPresences: true,
      presencesDelta: true,
      receivedCents: true,
      previousReceivedCents: true,
      receivedDeltaCents: true,
      activeRecurring: true,
      activeStudents: true,
    },
    { previousPeriod: period, spacesCount: true },
  ),
};

/** Visões por rota (`@OAuthView(base, finance?)`). */
export const mcpViews = {
  ...analytics,
  staffSpaces,
  managedSpace,
  court: allow(courtSchema, courtMask),
  courtList: allow(courtListSchema, { items: courtMask }),
  spaceBookingPage: spaceBookingPage(false),
  spaceBookingPageWithMoney: spaceBookingPage(true),
  spaceBookingDetail: spaceBookingDetail(false),
  spaceBookingDetailWithMoney: spaceBookingDetail(true),
  courtBlocks,
  /** GET receivables/today (só `manage:finance:read`). */
  receivablesToday: allow(receivablesTodaySchema, {
    date: true,
    timeZone: true,
    totalDueCents: true,
    items: { booking: { ...bookingCore, ...bookingMoney }, dueCents: true },
  }),
  /** GET statement (só `manage:finance:read`): sem observações nem quem registrou. */
  statement: allow(statementSchema, {
    period,
    timeZone: true,
    totals: { ...receivedFigures, reversedCents: true },
    byMethod: { ...receivedFigures, method: true },
    byChannel: { ...receivedFigures, channel: true },
    items: {
      id: true,
      payableType: true,
      amountCents: true,
      method: true,
      channel: true,
      paidAt: true,
      reversedAt: true,
      service: true,
      payerName: true,
      bookingId: true,
      bookingStartsAt: true,
      subscriptionId: true,
      planName: true,
      chargePeriodStart: true,
      courtName: true,
    },
    nextCursor: true,
  }),
  classGroups: allow(classGroupsResponseSchema, { items: classGroupCore }),
  classGroupDetail: allow(classGroupDetailSchema, { ...classGroupCore, conflicts: classConflict }),
  classSessions: allow(classSessionsResponseSchema, {
    from: true,
    to: true,
    timeZone: true,
    items: classSessionCore,
  }),
  classSessionDetail: allow(classSessionDetailSchema, {
    ...classSessionCore,
    openedAt: true,
    closedAt: true,
    cancelledAt: true,
    attendances: {
      userId: true,
      name: true,
      status: true,
      waitlistPosition: true,
      addedByStaff: true,
    },
    enrolledStudents: { userId: true, name: true, subscriptionStatus: true },
  }),
  classConflicts: allow(classSessionConflictsResponseSchema, { items: classConflict }),
  classAttendances: allow(classAttendancesResponseSchema, {
    from: true,
    to: true,
    items: {
      id: true,
      student: person,
      session: { id: true, classGroup: ref, startsAt: true, endsAt: true, status: true },
      status: true,
      waitlistPosition: true,
      addedByStaff: true,
      updatedAt: true,
    },
    summary: attendanceTotals,
  }),
  classGroupFrequency: allow(classGroupFrequencySchema, {
    classGroup: ref,
    from: true,
    to: true,
    sessionsDone: true,
    sessionsCancelled: true,
    totals: attendanceTotals,
    students: {
      userId: true,
      name: true,
      enrolled: true,
      present: true,
      absent: true,
      unmarked: true,
      attendanceRate: true,
    },
  }),
  plans: allow(plansResponseSchema, { items: planMask }),
  plan: allow(planSchema, planMask),
  /** GET subscription-charges (só `manage:finance:read`): sem avisos e motivos de dispensa. */
  subscriptionCharges: allow(spaceSubscriptionChargePageSchema, {
    items: {
      id: true,
      subscriptionId: true,
      periodStart: true,
      periodEnd: true,
      dueDate: true,
      amountCents: true,
      paidCents: true,
      discountCents: true,
      dueCents: true,
      status: true,
      waivedAt: true,
      payments: { id: true, amountCents: true, method: true, channel: true, paidAt: true },
      createdAt: true,
      student: person,
      plan: ref,
      subscriptionStatus: true,
    },
    nextCursor: true,
    totalDueCents: true,
  }),
  delinquents: allow(delinquentsResponseSchema, {
    date: true,
    totalOverdueCents: true,
    items: {
      subscriptionId: true,
      subscriptionStatus: true,
      student: person,
      plan: ref,
      overdueCount: true,
      overdueCents: true,
      oldestDueDate: true,
      daysOverdue: true,
    },
  }),
  /**
   * Avaliações: autor pelo nome; o comentário oculto ou com denúncia de dado pessoal já sai nulo
   * do service para o token do MCP.
   */
  manageReviews: allow(manageReviewPageSchema, {
    items: {
      id: true,
      author: { name: true, kind: true },
      rating: true,
      tags: true,
      comment: true,
      commentHidden: true,
      reply: { body: true, repliedAt: true, updatedAt: true },
      createdAt: true,
      updatedAt: true,
      reportedBySpace: true,
    },
    nextCursor: true,
  }),
  manageReviewSummary: allow(manageReviewSummarySchema, {
    count: true,
    average: true,
    publicSummaryVisible: true,
    unansweredCount: true,
    distribution: reviewDistribution,
    highlights: reviewHighlights,
    trend: {
      granularity: true,
      count: true,
      average: true,
      points: { date: true, count: true, average: true, cumulativeAverage: true },
    },
  }),
  /** GET team: membros pelo nome e papéis; sem e-mail, foto nem convites. */
  team: allow(teamSchema, { members: { userId: true, name: true, roles: true, joinedAt: true } }),
  onlineChargePage: allow(onlineChargePageSchema, { items: onlineChargeMask, nextCursor: true }),
  onlineCharge: allow(onlineChargeSchema, onlineChargeMask),
  /** Carteira sem a conta de recebimento (dados bancários) nem o ambiente de teste do gateway. */
  walletSummary: allow(walletSummarySchema, {
    merchantAccountStatus: true,
    payoutsPaused: true,
    openDisputes: { count: true, nextRespondBy: true },
    failedPayouts: { count: true, lastAmountCents: true, lastAt: true },
    timeZone: true,
    availableCents: true,
    pendingCents: true,
    balanceCents: true,
    paidOutCents: true,
    upcoming: { date: true, amountCents: true },
  }),
  walletEntries: allow(ledgerEntryPageSchema, {
    items: {
      id: true,
      kind: true,
      amountCents: true,
      availableAt: true,
      available: true,
      chargeId: true,
      refundId: true,
      payoutId: true,
      method: true,
      payableType: true,
      payableId: true,
      payerName: true,
      createdAt: true,
    },
    nextCursor: true,
    total: true,
  }),
  /** Chargebacks sem a resposta da contestação (texto e anexos) nem o cartão. */
  chargebacks: allow(chargebackListSchema, {
    items: {
      id: true,
      chargeId: true,
      kind: true,
      status: true,
      amountCents: true,
      reasonCode: true,
      createdAt: true,
      dispute: { status: true, respondBy: true, respondedAt: true, resolvedAt: true },
      itemStartsAt: true,
      itemPeriodStart: true,
      charge: {
        id: true,
        payableType: true,
        payableId: true,
        payer: person,
        method: true,
        status: true,
        amountCents: true,
        paidAt: true,
      },
    },
  }),
  superSpaceList: allow(superSpaceListSchema, {
    items: {
      id: true,
      name: true,
      slug: true,
      status: true,
      city,
      neighborhood: true,
      sports: { slug: true, name: true },
      courtsCount: true,
      owners: owner,
      showcaseVisible: true,
      onboarding: { doneCount: true, total: true },
      createdAt: true,
    },
    page: true,
    pageSize: true,
    total: true,
  }),
  superSpace: allow(superSpaceSchema, {
    id: true,
    name: true,
    slug: true,
    description: true,
    status: true,
    address: { neighborhood: true, city },
    amenities: amenity,
    openingHours: openingHour,
    showcase: { visible: true, missing: true },
    createdAt: true,
    courtsCount: true,
    owners: owner,
    checklist: {
      items: { key: true, done: true, missing: true },
      doneCount: true,
      total: true,
      completed: true,
    },
    rating: { count: true, average: true },
  }),
  superMetrics: allow(superMetricsSchema, {
    items: {
      spaceId: true,
      name: true,
      slug: true,
      status: true,
      bookings: true,
      activeRecurring: true,
      activeStudents: true,
      attendances: true,
      tournaments: true,
      lastAccessAt: true,
    },
    page: true,
    pageSize: true,
    total: true,
    period,
  }),
  financeSummary: allow(financeSummarySchema, {
    period,
    totals: { ...receivedFigures, reversedCents: true },
    bySpace: { ...receivedFigures, spaceId: true, spaceName: true },
    byService: { ...receivedFigures, service: true },
    byMethod: { ...receivedFigures, method: true },
    byChannel: { ...receivedFigures, channel: true },
  }),
  platformRevenue: allow(platformRevenueSchema, {
    period,
    totals: revenueFigures,
    bySpace: { ...revenueFigures, spaceId: true, spaceName: true },
    byMethod: { ...revenueFigures, method: true },
    byMonth: { ...revenueFigures, month: true },
  }),
  /** Relatório mensal sem o documento e a razão social do espaço (dados da nota fiscal). */
  monthlyFeeReport: allow(monthlyFeeReportSchema, {
    month: true,
    items: { ...revenueFigures, spaceId: true, spaceName: true, invoiceBaseCents: true },
    totals: revenueFigures,
  }),
  /**
   * Denúncias de avaliação sem os textos livres de quem denunciou ou resolveu; o comentário da
   * avaliação oculta ou com denúncia de dado pessoal já sai nulo do service para o token do MCP.
   */
  superReviewReports: allow(superReviewReportPageSchema, {
    items: {
      id: true,
      reviewId: true,
      reason: true,
      status: true,
      reporter: { userId: true, name: true, spaceId: true },
      createdAt: true,
      resolvedAt: true,
      resolvedByName: true,
      review: {
        id: true,
        space: { id: true, slug: true, name: true },
        author: { userId: true, name: true, blocked: true },
        rating: true,
        tags: true,
        comment: true,
        authorKind: true,
        counted: true,
        hidden: { at: true, byName: true },
        openReports: true,
        createdAt: true,
      },
    },
    nextCursor: true,
  }),
  superReviewSummary: allow(superReviewSummarySchema, {
    count: true,
    average: true,
    publicSummaryVisible: true,
    uncountedCount: true,
    distribution: reviewDistribution,
    highlights: reviewHighlights,
  }),
  /** Auditoria sem o `diff` (pode trazer e-mail, telefone e outros dados alterados). */
  auditLogPage: allow(auditLogPageSchema, {
    items: {
      id: true,
      actorId: true,
      actorName: true,
      actingAsSuper: true,
      spaceId: true,
      spaceName: true,
      action: true,
      entity: true,
      entityId: true,
      createdAt: true,
    },
    nextCursor: true,
  }),
  /** Usuários sem e-mail nem telefone (decisão 122: nem para o Super). */
  superUserList: allow(superUserListSchema, {
    items: superUserCore,
    page: true,
    pageSize: true,
    total: true,
  }),
  superUser: allow(superUserSchema, {
    ...superUserCore,
    memberships: {
      spaceId: true,
      spaceName: true,
      spaceSlug: true,
      spaceStatus: true,
      role: true,
      status: true,
    },
    activeSessions: true,
    pendingDeletionRequestId: true,
  }),
};

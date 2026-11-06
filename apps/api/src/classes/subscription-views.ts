import {
  CANCELLATION_WAIVE_REASON,
  cancellationAccessUntil,
  chargePeriod,
  DEFAULT_TIME_ZONE,
  type Enrollment,
  monthStart,
  type NextCharge,
  type PaymentMethod,
  projectedDueDate,
  type SpaceSubscriptionCharge,
  type StaffSubscriptionCharge,
  type Subscription,
  type SubscriptionCharge,
  utcToZoned,
} from '@space-sports/shared';
import { and, asc, desc, eq, gte, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '../bookings/db-utils.js';
import {
  cities,
  classGroups,
  courts,
  enrollments,
  paymentRecords,
  plans,
  spaces,
  sports,
  subscriptionCharges,
  subscriptions,
  users,
} from '../db/schema/index.js';
import { loadOpenCharges } from '../payments/online-queries.js';
import { groupTeachers, teacherRef } from './class-teachers.js';
import { BILLED_STATUSES, chargePaidSql } from './subscription-billing.js';

// Leituras de assinaturas e mensalidades (RF-CLASS-06, RF-CLASS-11). Quem chama monta o filtro
// (aluno da sessão ou espaço da rota); aqui só a forma da resposta.

const student = alias(users, 'student');

const ENROLLMENT_ORDER = { PENDING: 0, ACTIVE: 1, ENDED: 2 } as const;

export async function subscriptionRows(
  db: DbOrTx,
  where: SQL | undefined,
  options: { order?: SQL[]; limit?: number; now?: Date } = {},
): Promise<Subscription[]> {
  const rows = await db
    .select({
      sub: subscriptions,
      plan: plans,
      sportName: sports.name,
      sportSlug: sports.slug,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
      timeZone: cities.timezone,
      studentName: student.name,
      studentAvatarUrl: student.avatarUrl,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(sports, eq(sports.id, plans.sportId))
    .innerJoin(spaces, eq(spaces.id, subscriptions.spaceId))
    .innerJoin(cities, eq(cities.id, spaces.cityId))
    .innerJoin(student, eq(student.id, subscriptions.userId))
    .where(where)
    .orderBy(...(options.order ?? [desc(subscriptions.createdAt), desc(subscriptions.id)]))
    .limit(options.limit ?? 500);
  if (!rows.length) return [];

  const now = options.now ?? new Date();
  const ids = rows.map((row) => row.sub.id);
  const [enrollmentList, charges] = await Promise.all([
    enrollmentRows(db, inArray(enrollments.subscriptionId, ids)),
    db
      .select({
        id: subscriptionCharges.id,
        subscriptionId: subscriptionCharges.subscriptionId,
        periodStart: subscriptionCharges.periodStart,
        periodEnd: subscriptionCharges.periodEnd,
        dueDate: subscriptionCharges.dueDate,
        amountCents: subscriptionCharges.amountCents,
        discountCents: subscriptionCharges.discountCents,
        status: subscriptionCharges.status,
        paidCents: chargePaidSql,
      })
      .from(subscriptionCharges)
      .where(
        and(
          inArray(subscriptionCharges.subscriptionId, ids),
          or(
            inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
            // Os ciclos já gerados a partir de um mês atrás bastam para prever o próximo.
            gte(subscriptionCharges.periodStart, monthStart(now.toISOString().slice(0, 10), -1)),
          ),
        ),
      )
      .orderBy(asc(subscriptionCharges.dueDate)),
  ]);

  return rows.map((row) => {
    const { sub, plan } = row;
    const timeZone = row.timeZone || DEFAULT_TIME_ZONE;
    const today = utcToZoned(now, timeZone).date;
    const own = charges.filter((charge) => charge.subscriptionId === sub.id);
    const open = own.filter((charge) => charge.status === 'PENDING' || charge.status === 'OVERDUE');
    const overdueCents = open
      .filter((charge) => charge.dueDate < today)
      .reduce(
        (sum, charge) =>
          sum + Math.max(charge.amountCents - charge.discountCents - charge.paidCents, 0),
        0,
      );

    let nextCharge: NextCharge | null = null;
    const [firstOpen] = open;
    if (firstOpen) {
      nextCharge = {
        chargeId: firstOpen.id,
        dueDate: firstOpen.dueDate,
        amountCents: Math.max(
          firstOpen.amountCents - firstOpen.discountCents - firstOpen.paidCents,
          0,
        ),
        status: firstOpen.dueDate < today ? 'OVERDUE' : 'PENDING',
      };
    } else if (sub.startsOn && sub.status !== 'CANCELLED' && sub.priceCents > 0) {
      const dueDate = projectedDueDate(
        { ...sub, startsOn: sub.startsOn },
        plan.billingDay,
        today,
        new Set(own.map((charge) => charge.periodStart)),
      );
      if (dueDate) {
        nextCharge = { chargeId: null, dueDate, amountCents: sub.priceCents, status: 'PROJECTED' };
      }
    }

    // O ciclo em curso é o mês de hoje (até o fim do serviço, se o cancelamento foi pedido).
    const current =
      sub.startsOn && sub.status !== 'CANCELLED' ? chargePeriod(today, plan.billingDay) : null;
    const cancellable =
      (BILLED_STATUSES as readonly string[]).includes(sub.status) && !sub.cancelAtPeriodEnd;
    return {
      id: sub.id,
      space: { id: sub.spaceId, name: row.spaceName, slug: row.spaceSlug, timeZone },
      plan: {
        id: plan.id,
        name: plan.name,
        sport: { id: plan.sportId, name: row.sportName, slug: row.sportSlug },
        weeklyFrequency: plan.weeklyFrequency,
        billingDay: plan.billingDay,
      },
      student: { userId: sub.userId, name: row.studentName, avatarUrl: row.studentAvatarUrl },
      status: sub.status,
      priceCents: sub.priceCents,
      intendedPaymentMethod: (sub.intendedPaymentMethod as PaymentMethod | null) ?? null,
      startsOn: sub.startsOn,
      currentPeriodStart: current
        ? sub.startsOn && sub.startsOn > current.periodStart
          ? sub.startsOn
          : current.periodStart
        : sub.currentPeriodStart,
      currentPeriodEnd: current
        ? sub.endsOn && sub.endsOn < current.periodEnd
          ? sub.endsOn
          : current.periodEnd
        : sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      endsOn: sub.endsOn,
      accessUntil: sub.endsOn,
      accessUntilIfCancelled: cancellable ? cancellationAccessUntil(own, today) : null,
      rejected: sub.rejectedAt !== null,
      statusReason: sub.statusReason,
      approvedAt: sub.approvedAt?.toISOString() ?? null,
      cancelledAt: sub.cancelledAt?.toISOString() ?? null,
      createdAt: sub.createdAt.toISOString(),
      enrollments: enrollmentList
        .filter((enrollment) => enrollment.subscriptionId === sub.id)
        .map(({ subscriptionId: _subscriptionId, ...enrollment }) => enrollment),
      nextCharge,
      overdueCents,
    };
  });
}

async function enrollmentRows(
  db: DbOrTx,
  where: SQL | undefined,
): Promise<(Enrollment & { subscriptionId: string })[]> {
  const rows = await db
    .select({
      enrollment: enrollments,
      group: classGroups,
      courtName: courts.name,
    })
    .from(enrollments)
    .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
    .innerJoin(courts, eq(courts.id, classGroups.courtId))
    .where(where)
    .orderBy(
      asc(classGroups.weekday),
      asc(classGroups.startTime),
      desc(enrollments.startedOn),
      asc(enrollments.id),
    );
  const teachers = await groupTeachers(db, [...new Set(rows.map((row) => row.group.id))]);
  return rows
    .map(({ enrollment, group, ...row }) => ({
      id: enrollment.id,
      subscriptionId: enrollment.subscriptionId,
      status: enrollment.status,
      startedOn: enrollment.startedOn,
      endedOn: enrollment.endedOn,
      classGroup: {
        id: group.id,
        name: group.name,
        weekday: group.weekday,
        startTime: group.startTime.slice(0, 5),
        durationMin: group.durationMin,
        court: { id: group.courtId, name: row.courtName },
        teachers: (teachers.get(group.id) ?? []).map(teacherRef),
        active: group.active,
      },
    }))
    .sort((a, b) => ENROLLMENT_ORDER[a.status] - ENROLLMENT_ORDER[b.status]);
}

const chargeColumns = {
  charge: subscriptionCharges,
  paidCents: chargePaidSql,
};

type ChargeSelect = { charge: typeof subscriptionCharges.$inferSelect; paidCents: number };

async function withPayments<T extends ChargeSelect>(
  db: DbOrTx,
  rows: T[],
): Promise<
  (T & {
    payments: SubscriptionCharge['payments'];
    openOnlineCharge: SubscriptionCharge['openOnlineCharge'];
  })[]
> {
  const ids = rows.map((row) => row.charge.id);
  const open = await loadOpenCharges(db, 'SUBSCRIPTION_CHARGE', ids);
  const payments = ids.length
    ? await db
        .select({
          id: paymentRecords.id,
          payableId: paymentRecords.payableId,
          amountCents: paymentRecords.amountCents,
          method: paymentRecords.method,
          channel: paymentRecords.channel,
          onlineChargeId: paymentRecords.onlineChargeId,
          paidAt: paymentRecords.paidAt,
        })
        .from(paymentRecords)
        .where(
          and(
            eq(paymentRecords.payableType, 'SUBSCRIPTION_CHARGE'),
            inArray(paymentRecords.payableId, ids),
            isNull(paymentRecords.reversedAt),
          ),
        )
        .orderBy(asc(paymentRecords.paidAt), asc(paymentRecords.id))
    : [];
  return rows.map((row) => ({
    ...row,
    openOnlineCharge: open.get(row.charge.id) ?? null,
    payments: payments
      .filter((payment) => payment.payableId === row.charge.id)
      .map((payment) => ({
        id: payment.id,
        amountCents: payment.amountCents,
        method: payment.method as PaymentMethod,
        channel: payment.channel,
        onlineChargeId: payment.onlineChargeId,
        paidAt: payment.paidAt.toISOString(),
      })),
  }));
}

function toCharge(
  row: ChargeSelect & {
    payments: SubscriptionCharge['payments'];
    openOnlineCharge: SubscriptionCharge['openOnlineCharge'];
  },
) {
  const { charge } = row;
  const open = charge.status === 'PENDING' || charge.status === 'OVERDUE';
  return {
    id: charge.id,
    subscriptionId: charge.subscriptionId,
    periodStart: charge.periodStart,
    periodEnd: charge.periodEnd,
    dueDate: charge.dueDate,
    amountCents: charge.amountCents,
    paidCents: row.paidCents,
    discountCents: charge.discountCents,
    dueCents: open ? Math.max(charge.amountCents - charge.discountCents - row.paidCents, 0) : 0,
    openOnlineCharge: row.openOnlineCharge,
    status: charge.status,
    waivedAt: charge.waivedAt?.toISOString() ?? null,
    waiveNotice: charge.waiveReason === CANCELLATION_WAIVE_REASON ? charge.waiveReason : null,
    payments: row.payments,
    createdAt: charge.createdAt.toISOString(),
  } satisfies SubscriptionCharge;
}

function toStaffCharge(
  row: ChargeSelect & {
    payments: SubscriptionCharge['payments'];
    openOnlineCharge: SubscriptionCharge['openOnlineCharge'];
  },
): StaffSubscriptionCharge {
  return { ...toCharge(row), waiveReason: row.charge.waiveReason };
}

async function loadCharges(db: DbOrTx, subscriptionId: string) {
  const rows = await db
    .select(chargeColumns)
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.subscriptionId, subscriptionId))
    .orderBy(desc(subscriptionCharges.periodStart));
  return withPayments(db, rows);
}

/** Mensalidades de uma assinatura para o aluno, mais recentes primeiro. */
export async function chargeRows(
  db: DbOrTx,
  subscriptionId: string,
): Promise<SubscriptionCharge[]> {
  return (await loadCharges(db, subscriptionId)).map(toCharge);
}

/** As mesmas mensalidades para a gestão, com o motivo da dispensa. */
export async function staffChargeRows(
  db: DbOrTx,
  subscriptionId: string,
): Promise<StaffSubscriptionCharge[]> {
  return (await loadCharges(db, subscriptionId)).map(toStaffCharge);
}

/** Mensalidades do espaço com aluno e plano (lista da gestão). */
export async function spaceChargeRows(
  db: DbOrTx,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
): Promise<SpaceSubscriptionCharge[]> {
  const rows = await db
    .select({
      ...chargeColumns,
      subscriptionStatus: subscriptions.status,
      userId: subscriptions.userId,
      studentName: student.name,
      studentAvatarUrl: student.avatarUrl,
      planId: plans.id,
      planName: plans.name,
    })
    .from(subscriptionCharges)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionCharges.subscriptionId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(student, eq(student.id, subscriptions.userId))
    .where(where)
    .orderBy(...order)
    .limit(limit);
  return (await withPayments(db, rows)).map((row) => ({
    ...toStaffCharge(row),
    student: { userId: row.userId, name: row.studentName, avatarUrl: row.studentAvatarUrl },
    plan: { id: row.planId, name: row.planName },
    subscriptionStatus: row.subscriptionStatus,
  }));
}

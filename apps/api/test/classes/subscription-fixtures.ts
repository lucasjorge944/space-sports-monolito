import { zonedToUtc } from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, vi } from 'vitest';
import type { Database } from '../../src/db/client.js';
import {
  classGroups,
  classGroupTeachers,
  notifications,
  plans,
  sports,
  subscriptionCharges,
  subscriptions,
} from '../../src/db/schema/index.js';
import { first } from '../db/helpers.js';
import { TIME_ZONE } from '../recurring/fixtures.js';

/** 12:10 da data local (fuso dos espaços de teste). */
export const at = (date: string, minuteOfDay = 12 * 60 + 10) =>
  zonedToUtc(date, minuteOfDay, TIME_ZONE);

/**
 * Congela o relógio (só `Date`) às 12:10 de uma data fixa: os ciclos de mensalidade são por mês
 * e dia de vencimento, então os testes precisam de um "hoje" conhecido. `travel` avança.
 */
export function useFixedClock(date: string) {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: at(date) });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

export const travel = (date: string) => vi.setSystemTime(at(date));

type PlanInsert = typeof plans.$inferInsert;
type GroupInsert = typeof classGroups.$inferInsert & { teacherMemberId: string };
type SubscriptionInsert = typeof subscriptions.$inferInsert;

export const insertPlan = async (db: Database, values: PlanInsert) =>
  first(await db.insert(plans).values(values).returning());

/** Turma direto no banco (sem sessões: a assinatura não depende delas). */
export const insertGroup = async (db: Database, { teacherMemberId, ...values }: GroupInsert) =>
  db.transaction(async (tx) => {
    const group = first(await tx.insert(classGroups).values(values).returning());
    await tx
      .insert(classGroupTeachers)
      .values({ classGroupId: group.id, spaceId: group.spaceId, teacherMemberId });
    return group;
  });

/** Assinatura direto no banco, para os testes do job. */
export const insertSubscription = async (db: Database, values: SubscriptionInsert) =>
  first(await db.insert(subscriptions).values(values).returning());

export async function otherSport(db: Database) {
  const [existing] = await db.select().from(sports).where(eq(sports.slug, 'beach-tennis'));
  return (
    existing ??
    first(
      await db.insert(sports).values({ slug: 'beach-tennis', name: 'Beach tennis' }).returning(),
    )
  );
}

export const chargesOf = (db: Database, subscriptionId: string) =>
  db
    .select()
    .from(subscriptionCharges)
    .where(eq(subscriptionCharges.subscriptionId, subscriptionId))
    .orderBy(subscriptionCharges.periodStart);

export const subscriptionRow = async (db: Database, id: string) =>
  first(await db.select().from(subscriptions).where(eq(subscriptions.id, id)));

export const notificationsOf = (db: Database, userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

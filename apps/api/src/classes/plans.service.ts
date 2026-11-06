import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePlanInput,
  DEFAULT_TIME_ZONE,
  OPEN_SUBSCRIPTION_STATUSES,
  type Plan,
  type PlansQuery,
  type PublicSpaceClasses,
  type UpdatePlanInput,
} from '@space-sports/shared';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { audit, type DbOrTx, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { cities, classGroups, plans, spaces, sports, subscriptions } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { spaceNotFound } from '../spaces/spaces.errors.js';
import { classGroupRows } from './class-groups.service.js';
import { teacherRef } from './class-teachers.js';
import {
  planHasSubscriptions,
  planNotFound,
  planSportLocked,
  sportNotFound,
} from './classes.errors.js';

/**
 * Planos de aula (RF-CLASS-03): Nx/semana ou ilimitado (decisão 12), valor mensal e vencimento
 * em dia fixo do mês, sem pró-rata (decisão 25). Desativar tira o plano da página pública e
 * impede novas assinaturas (tarefa 2.2); as existentes seguem.
 */
@Injectable()
export class PlansService {
  constructor(@Inject(DB) private readonly db: Database) {}

  list(spaceId: string, query: PlansQuery): Promise<Plan[]> {
    const filters: (SQL | undefined)[] = [eq(plans.spaceId, spaceId)];
    if (query.active !== undefined) filters.push(eq(plans.active, query.active));
    if (query.sportId) filters.push(eq(plans.sportId, query.sportId));
    return planRows(this.db, and(...filters));
  }

  async get(spaceId: string, id: string): Promise<Plan> {
    const [plan] = await planRows(this.db, and(eq(plans.spaceId, spaceId), eq(plans.id, id)));
    if (!plan) throw planNotFound();
    return plan;
  }

  async create(spaceId: string, actorId: string, input: CreatePlanInput): Promise<Plan> {
    const id = await this.db.transaction(async (tx) => {
      await assertSport(tx, input.sportId);
      const [plan] = await tx
        .insert(plans)
        .values({ spaceId, ...input })
        .returning({ id: plans.id });
      if (!plan) throw new Error('Insert de plano sem retorno.');
      await audit(tx, {
        actorId,
        spaceId,
        action: 'plan.create',
        entity: 'plan',
        entityId: plan.id,
        diff: { ...input },
      });
      return plan.id;
    });
    return this.get(spaceId, id);
  }

  /** O preço novo vale para as próximas assinaturas: as existentes guardam o snapshot. */
  async update(
    spaceId: string,
    actorId: string,
    id: string,
    patch: UpdatePlanInput,
  ): Promise<Plan> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(plans)
        .where(and(eq(plans.spaceId, spaceId), eq(plans.id, id)))
        .for('update');
      if (!current) throw planNotFound();
      if (patch.sportId !== undefined) await assertSport(tx, patch.sportId);
      const changed = (Object.keys(patch) as (keyof UpdatePlanInput)[]).filter(
        (key) => patch[key] !== current[key],
      );
      if (!changed.length) return;
      if (changed.includes('sportId')) {
        const ongoing = await ongoingSubscriptionCount(tx, id);
        if (ongoing > 0) throw planSportLocked(ongoing);
      }
      await tx.update(plans).set(patch).where(eq(plans.id, id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'plan.update',
        entity: 'plan',
        entityId: id,
        diff: {
          before: Object.fromEntries(changed.map((key) => [key, current[key]])),
          after: Object.fromEntries(changed.map((key) => [key, patch[key]])),
        },
      });
    });
    return this.get(spaceId, id);
  }

  /** Só exclui plano sem nenhuma assinatura; com assinaturas, desative (409 PLAN_HAS_SUBSCRIPTIONS). */
  async remove(spaceId: string, actorId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ id: plans.id, name: plans.name })
        .from(plans)
        .where(and(eq(plans.spaceId, spaceId), eq(plans.id, id)))
        .for('update');
      if (!plan) throw planNotFound();
      const [subscription] = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.planId, id))
        .limit(1);
      if (subscription) throw planHasSubscriptions();
      await tx.delete(plans).where(eq(plans.id, id));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'plan.delete',
        entity: 'plan',
        entityId: id,
        diff: { name: plan.name },
      });
    });
  }

  /**
   * Aba Aulas da página do espaço (RF-CLASS-04): planos e turmas ativos, com as vagas (matrículas
   * ativas × capacidade). Só espaços ACTIVE.
   */
  async publicClasses(slug: string): Promise<PublicSpaceClasses> {
    const [space] = await this.db
      .select({
        id: spaces.id,
        name: spaces.name,
        slug: spaces.slug,
        timeZone: cities.timezone,
      })
      .from(spaces)
      .innerJoin(cities, eq(cities.id, spaces.cityId))
      .where(and(eq(spaces.slug, slug), eq(spaces.status, 'ACTIVE')));
    if (!space) throw spaceNotFound();

    const [planList, groups] = await Promise.all([
      planRows(this.db, and(eq(plans.spaceId, space.id), eq(plans.active, true))),
      classGroupRows(this.db, and(eq(classGroups.spaceId, space.id), eq(classGroups.active, true))),
    ]);
    return {
      space: {
        id: space.id,
        name: space.name,
        slug: space.slug,
        timeZone: space.timeZone || DEFAULT_TIME_ZONE,
      },
      plans: planList.map(({ active: _active, createdAt: _createdAt, ...plan }) => plan),
      classGroups: groups.map(({ active: _active, createdAt: _createdAt, teachers, ...group }) => ({
        ...group,
        teachers: teachers.map(teacherRef),
      })),
    };
  }
}

async function assertSport(db: DbOrTx, sportId: string): Promise<void> {
  const [sport] = await db.select({ id: sports.id }).from(sports).where(eq(sports.id, sportId));
  if (!sport) throw sportNotFound();
}

/** Assinaturas que ainda não terminaram (pendentes de aprovação, ativas ou em atraso). */
async function ongoingSubscriptionCount(tx: Tx, planId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.planId, planId),
        inArray(subscriptions.status, [...OPEN_SUBSCRIPTION_STATUSES]),
      ),
    );
  return row?.count ?? 0;
}

async function planRows(db: DbOrTx, where: SQL | undefined): Promise<Plan[]> {
  const rows = await db
    .select({ plan: plans, sportName: sports.name, sportSlug: sports.slug })
    .from(plans)
    .innerJoin(sports, eq(sports.id, plans.sportId))
    .where(where)
    .orderBy(asc(sports.name), asc(plans.weeklyFrequency), asc(plans.name), asc(plans.id));
  return rows.map(({ plan, sportName, sportSlug }) => ({
    id: plan.id,
    name: plan.name,
    sport: { id: plan.sportId, name: sportName, slug: sportSlug },
    weeklyFrequency: plan.weeklyFrequency,
    priceCents: plan.priceCents,
    billingDay: plan.billingDay,
    active: plan.active,
    createdAt: plan.createdAt.toISOString(),
  }));
}

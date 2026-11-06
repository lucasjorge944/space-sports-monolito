import {
  type AttendanceBlockReason,
  type AttendanceMode,
  addDays,
  DEFAULT_TIME_ZONE,
  SPACE_SETTINGS_DEFAULTS,
  type SubscriptionStatus,
  utcToZoned,
} from '@space-sports/shared';
import { and, eq, inArray, min, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../bookings/db-utils.js';
import {
  cities,
  enrollments,
  spaceSettings,
  spaces,
  subscriptionCharges,
  subscriptions,
} from '../db/schema/index.js';

/** Configurações da lista de presença do espaço (seção 2.1 de docs/02), já com os padrões. */
export interface AttendanceSettings {
  /** Fuso do espaço (`cities.timezone`): define o "hoje" e a data local da aula. */
  timeZone: string;
  mode: AttendanceMode;
  openBeforeMin: number;
  closeBeforeMin: number;
  cancelDeadlineMin: number;
  pastDueBlockEnabled: boolean;
  pastDueBlockDays: number;
}

export async function attendanceSettings(
  db: DbOrTx,
  spaceIds: string[],
): Promise<Map<string, AttendanceSettings>> {
  const rows = spaceIds.length
    ? await db
        .select({ spaceId: spaces.id, timeZone: cities.timezone, settings: spaceSettings })
        .from(spaces)
        .innerJoin(cities, eq(cities.id, spaces.cityId))
        .leftJoin(spaceSettings, eq(spaceSettings.spaceId, spaces.id))
        .where(inArray(spaces.id, spaceIds))
    : [];
  const bySpace = new Map(rows.map((row) => [row.spaceId, row]));
  const d = SPACE_SETTINGS_DEFAULTS;
  return new Map(
    spaceIds.map((spaceId) => {
      const row = bySpace.get(spaceId);
      const s = row?.settings;
      return [
        spaceId,
        {
          timeZone: row?.timeZone || DEFAULT_TIME_ZONE,
          mode: s?.attendanceMode ?? d.attendanceMode,
          openBeforeMin: s?.attendanceOpenBeforeMin ?? d.attendanceOpenBeforeMin,
          closeBeforeMin: s?.attendanceCloseBeforeMin ?? d.attendanceCloseBeforeMin,
          cancelDeadlineMin: s?.attendanceCancelDeadlineMin ?? d.attendanceCancelDeadlineMin,
          pastDueBlockEnabled: s?.pastDueBlockEnabled ?? d.pastDueBlockEnabled,
          pastDueBlockDays: s?.pastDueBlockDays ?? d.pastDueBlockDays,
        },
      ];
    }),
  );
}

export async function attendanceSettingsOf(
  db: DbOrTx,
  spaceId: string,
): Promise<AttendanceSettings> {
  const settings = (await attendanceSettings(db, [spaceId])).get(spaceId);
  if (!settings) throw new Error('Configurações de presença não carregadas.');
  return settings;
}

/**
 * Assinaturas que dão acesso às turmas: a pendente de aprovação e a cancelada não contam; a
 * inadimplente conta, mas bloqueia a confirmação (RN-CLASS-06).
 */
const ENROLLED_SUBSCRIPTION: SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE'];

/** Matrícula ativa do aluno numa turma, com o que importa da assinatura. */
export interface EnrollmentState {
  userId: string;
  classGroupId: string;
  subscriptionId: string;
  subscriptionStatus: SubscriptionStatus;
  /** RN-CLASS-08: último dia de acesso, com o cancelamento pedido. */
  endsOn: string | null;
  /** Vencimento mais antigo de mensalidade não paga (PENDING/OVERDUE); nulo se em dia. */
  oldestUnpaidDue: string | null;
}

/**
 * Matrículas `ACTIVE` (fonte de quem pode confirmar, RN-CLASS-01/03) de assinaturas em vigor,
 * filtradas por aluno e/ou turmas.
 */
export async function enrollmentStates(
  db: DbOrTx,
  filter: { userId?: string; classGroupIds?: string[] },
): Promise<EnrollmentState[]> {
  if (filter.classGroupIds && !filter.classGroupIds.length) return [];
  const where: (SQL | undefined)[] = [
    eq(enrollments.status, 'ACTIVE'),
    inArray(subscriptions.status, ENROLLED_SUBSCRIPTION),
    filter.userId ? eq(subscriptions.userId, filter.userId) : undefined,
    filter.classGroupIds ? inArray(enrollments.classGroupId, filter.classGroupIds) : undefined,
  ];
  const rows = await db
    .select({
      userId: subscriptions.userId,
      classGroupId: enrollments.classGroupId,
      subscriptionId: subscriptions.id,
      subscriptionStatus: subscriptions.status,
      endsOn: subscriptions.endsOn,
    })
    .from(enrollments)
    .innerJoin(subscriptions, eq(subscriptions.id, enrollments.subscriptionId))
    .where(and(...where));
  if (!rows.length) return [];
  const unpaid = await db
    .select({
      subscriptionId: subscriptionCharges.subscriptionId,
      oldest: min(subscriptionCharges.dueDate),
    })
    .from(subscriptionCharges)
    .where(
      and(
        inArray(subscriptionCharges.subscriptionId, [
          ...new Set(rows.map((r) => r.subscriptionId)),
        ]),
        inArray(subscriptionCharges.status, ['PENDING', 'OVERDUE']),
      ),
    )
    .groupBy(subscriptionCharges.subscriptionId);
  const oldest = new Map(unpaid.map((row) => [row.subscriptionId, row.oldest]));
  return rows.map((row) => ({ ...row, oldestUnpaidDue: oldest.get(row.subscriptionId) ?? null }));
}

/**
 * Por que o aluno não pode confirmar na sessão que começa em `startsAt`, olhando as matrículas
 * dele na turma da sessão; nulo = pode. Com mais de uma assinatura na turma, basta uma liberada.
 * A data da aula e o "hoje" (`now`) são datas locais no fuso do espaço (`settings.timeZone`).
 * - RN-CLASS-08: aula depois do último dia de acesso (`ends_on`), mesmo antes do job encerrar;
 * - RN-CLASS-06 (se o espaço não desligou): assinatura `PAST_DUE`, ou mensalidade não paga
 *   vencida há mais de `past_due_block_days` (não depende do job da 2.2 já ter rodado).
 */
export function enrollmentBlock(
  states: EnrollmentState[],
  startsAt: Date,
  now: Date,
  settings: AttendanceSettings,
): Exclude<AttendanceBlockReason, 'LIST_NOT_OPEN' | 'SCHEDULE_OVERLAP'> | null {
  if (!states.length) return 'NOT_ENROLLED';
  const sessionDate = utcToZoned(startsAt, settings.timeZone).date;
  const today = utcToZoned(now, settings.timeZone).date;
  const reasons = states.map((state) => {
    if (state.endsOn !== null && sessionDate > state.endsOn) {
      return 'SUBSCRIPTION_ACCESS_ENDED' as const;
    }
    if (settings.pastDueBlockEnabled) {
      const overdue =
        state.oldestUnpaidDue !== null &&
        addDays(state.oldestUnpaidDue, settings.pastDueBlockDays) < today;
      if (state.subscriptionStatus === 'PAST_DUE' || overdue) {
        return 'SUBSCRIPTION_PAST_DUE' as const;
      }
    }
    return null;
  });
  return reasons.includes(null) ? null : (reasons[0] ?? null);
}

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sports } from './catalog.js';
import { id, timestamps, tstz, tstzrange } from './columns.js';
import {
  attendanceStatus,
  chargeStatus,
  classConflictKind,
  classSessionStatus,
  enrollmentStatus,
  paymentMethod,
  sportLevel,
  subscriptionStatus,
} from './enums.js';
import { spaceMembers, users } from './identity.js';
import { courts, spaces } from './spaces.js';

/**
 * Turma fixa (RF-CLASS-02): horário semanal na quadra, com capacidade de matrículas (RN-CLASS-02)
 * e os professores padrão (`class_group_teachers`). As sessões de cada semana são geradas pelo job
 * (`class_sessions`).
 */
export const classGroups = pgTable(
  'class_groups',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    sportId: uuid()
      .notNull()
      .references(() => sports.id),
    /** FK composta (court_id, space_id) → courts: a quadra é deste espaço. */
    courtId: uuid().notNull(),
    name: text().notNull(),
    /** Nulo = todos os níveis. */
    level: sportLevel(),
    /** 0 = domingo … 6 = sábado. */
    weekday: smallint().notNull(),
    /** Horário local do espaço (America/Sao_Paulo). */
    startTime: time().notNull(),
    durationMin: integer().notNull(),
    /** Máximo de matrículas ativas (RN-CLASS-02); as sessões copiam o valor. */
    capacity: integer().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'class_groups_court_space_fk',
      columns: [t.courtId, t.spaceId],
      foreignColumns: [courts.id, courts.spaceId],
    }),
    // Alvo das FKs compostas das sessões e dos professores: são do mesmo espaço da turma.
    unique('class_groups_id_space_id_unique').on(t.id, t.spaceId),
    index('class_groups_space_id_active_idx').on(t.spaceId, t.active),
    index('class_groups_court_id_weekday_idx').on(t.courtId, t.weekday),
    index('class_groups_sport_id_idx').on(t.sportId),
    check('class_groups_weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('class_groups_duration_valid', sql`${t.durationMin} > 0 AND ${t.durationMin} % 30 = 0`),
    check('class_groups_start_time_aligned', sql`EXTRACT(MINUTE FROM ${t.startTime}) IN (0, 30)`),
    check('class_groups_capacity_positive', sql`${t.capacity} > 0`),
  ],
);

/**
 * Professores padrão da turma (decisão 47): ao menos um, garantido por um gatilho adiado ao
 * commit (migração `0021_class_teachers`; o Drizzle não modela gatilhos). As sessões geradas
 * copiam a lista.
 */
export const classGroupTeachers = pgTable(
  'class_group_teachers',
  {
    classGroupId: uuid().notNull(),
    spaceId: uuid().notNull(),
    teacherMemberId: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.classGroupId, t.teacherMemberId] }),
    foreignKey({
      name: 'class_group_teachers_class_group_space_fk',
      columns: [t.classGroupId, t.spaceId],
      foreignColumns: [classGroups.id, classGroups.spaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'class_group_teachers_member_space_fk',
      columns: [t.teacherMemberId, t.spaceId],
      foreignColumns: [spaceMembers.id, spaceMembers.spaceId],
    }),
    index('class_group_teachers_teacher_member_id_idx').on(t.teacherMemberId),
  ],
);

/**
 * Sessão (a aula de uma semana). Ocupa a quadra em `court_occupations` (kind = CLASS,
 * ref_id = class_sessions.id). Professores, quadra e capacidade são copiados da turma na geração;
 * a gestão pode ajustar a capacidade e os professores da sessão.
 */
export const classSessions = pgTable(
  'class_sessions',
  {
    id: id(),
    classGroupId: uuid().notNull(),
    spaceId: uuid().notNull(),
    courtId: uuid().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    /** Máximo de confirmados (RN-CLASS-03); os excedentes vão para a espera. */
    capacity: integer().notNull(),
    status: classSessionStatus().notNull().default('SCHEDULED'),
    openedAt: tstz(),
    openedBy: uuid().references(() => users.id),
    closedAt: tstz(),
    closedBy: uuid().references(() => users.id),
    cancelledAt: tstz(),
    cancelledBy: uuid().references(() => users.id),
    cancelReason: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'class_sessions_class_group_space_fk',
      columns: [t.classGroupId, t.spaceId],
      foreignColumns: [classGroups.id, classGroups.spaceId],
    }),
    foreignKey({
      name: 'class_sessions_court_space_fk',
      columns: [t.courtId, t.spaceId],
      foreignColumns: [courts.id, courts.spaceId],
    }),
    // Uma sessão por turma e horário: a geração repetida não duplica.
    unique('class_sessions_class_group_starts_at_unique').on(t.classGroupId, t.startsAt),
    // Alvo das FKs compostas dos professores: são do mesmo espaço da sessão.
    unique('class_sessions_id_space_id_unique').on(t.id, t.spaceId),
    index('class_sessions_space_id_starts_at_idx').on(t.spaceId, t.startsAt),
    index('class_sessions_court_id_idx').on(t.courtId),
    // O job da lista de presença (tarefa 2.3) só varre as sessões ainda em andamento.
    index('class_sessions_pending_idx')
      .on(t.startsAt)
      .where(sql`${t.status} IN ('SCHEDULED', 'OPEN', 'CLOSED')`),
    // O job de pedidos de avaliação (RN-REVIEW-02) varre as que terminaram nas últimas 24 h.
    index('class_sessions_ends_at_idx').on(t.endsAt).where(sql`${t.status} <> 'CANCELLED'`),
    index('class_sessions_opened_by_idx').on(t.openedBy),
    index('class_sessions_closed_by_idx').on(t.closedBy),
    index('class_sessions_cancelled_by_idx').on(t.cancelledBy),
    check('class_sessions_period_valid', sql`${t.endsAt} > ${t.startsAt}`),
    check('class_sessions_capacity_positive', sql`${t.capacity} > 0`),
  ],
);

/**
 * Professores da aula (decisão 47): a turma define o padrão e a aula pode ter os próprios. Ao
 * menos um, como em `class_group_teachers`. A lista das aulas encerradas é histórico.
 */
export const classSessionTeachers = pgTable(
  'class_session_teachers',
  {
    classSessionId: uuid().notNull(),
    spaceId: uuid().notNull(),
    teacherMemberId: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.classSessionId, t.teacherMemberId] }),
    foreignKey({
      name: 'class_session_teachers_class_session_space_fk',
      columns: [t.classSessionId, t.spaceId],
      foreignColumns: [classSessions.id, classSessions.spaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'class_session_teachers_member_space_fk',
      columns: [t.teacherMemberId, t.spaceId],
      foreignColumns: [spaceMembers.id, spaceMembers.spaceId],
    }),
    index('class_session_teachers_teacher_member_id_idx').on(t.teacherMemberId),
  ],
);

/**
 * Agenda do professor entre espaços (decisão 47): uma linha por usuário e aula, mantida na mesma
 * transação das listas. O vínculo TEACHER é por espaço, então a agenda é por `users.id`. A
 * constraint `teacher_occupations_no_overlap` (EXCLUDE USING gist, criada à mão na migração
 * `0021_class_teachers`) impede duas ocupações ativas sobrepostas do mesmo usuário em espaços
 * diferentes; no mesmo espaço pode. Aula cancelada fica inativa.
 */
export const teacherOccupations = pgTable(
  'teacher_occupations',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    spaceId: uuid().notNull(),
    classSessionId: uuid().notNull(),
    /** Sempre `[início, fim)`, o mesmo da aula. */
    period: tstzrange().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'teacher_occupations_class_session_space_fk',
      columns: [t.classSessionId, t.spaceId],
      foreignColumns: [classSessions.id, classSessions.spaceId],
    }).onDelete('cascade'),
    unique('teacher_occupations_class_session_user_unique').on(t.classSessionId, t.userId),
    index('teacher_occupations_user_id_idx').on(t.userId),
    check(
      'teacher_occupations_period_valid',
      sql`NOT isempty(${t.period}) AND NOT lower_inf(${t.period}) AND NOT upper_inf(${t.period}) AND lower_inc(${t.period}) AND NOT upper_inc(${t.period})`,
    ),
  ],
);

/**
 * Sessão que não coube na agenda (bloqueio, torneio, reserva, outra aula no horário ou, com
 * `TEACHER`, nenhum professor da turma livre): o job registra aqui, sinalizando a gestão, em vez
 * de falhar. Fica aberta (`resolved_at` nulo) até a sessão ser gerada, a turma mudar de horário
 * ou ser desativada.
 */
export const classSessionConflicts = pgTable(
  'class_session_conflicts',
  {
    id: id(),
    classGroupId: uuid()
      .notNull()
      .references(() => classGroups.id, { onDelete: 'cascade' }),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    conflictsWith: classConflictKind().notNull(),
    resolvedAt: tstz(),
    ...timestamps,
  },
  (t) => [
    unique('class_session_conflicts_group_starts_at_unique').on(t.classGroupId, t.startsAt),
    index('class_session_conflicts_open_idx')
      .on(t.classGroupId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check('class_session_conflicts_period_valid', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Presença do aluno na sessão (RN-CLASS-03..05). Uma linha por aluno e sessão. */
export const attendances = pgTable(
  'attendances',
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: attendanceStatus().notNull(),
    /** Posição na lista de espera (1 = próximo); só em WAITLIST. */
    waitlistPosition: integer(),
    /** Incluído pela gestão (RF-CLASS-09). */
    addedByStaff: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('attendances_session_user_unique').on(t.sessionId, t.userId),
    index('attendances_user_id_idx').on(t.userId),
    index('attendances_session_id_status_idx').on(t.sessionId, t.status),
    check(
      'attendances_waitlist_position_consistent',
      sql`(${t.status} = 'WAITLIST') = (${t.waitlistPosition} IS NOT NULL)`,
    ),
    check('attendances_waitlist_position_positive', sql`${t.waitlistPosition} > 0`),
  ],
);

/**
 * Plano de aulas (RF-CLASS-03). `weekly_frequency` N = N turmas fixas (RN-CLASS-01); nulo =
 * ilimitado nas turmas matriculadas (decisão 12). Vence no `billing_day` de cada mês, sem
 * pró-rata (decisão 25).
 */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    sportId: uuid()
      .notNull()
      .references(() => sports.id),
    name: text().notNull(),
    weeklyFrequency: smallint(),
    priceCents: integer().notNull(),
    /** Dia fixo do mês (1 a 28, para existir em todos os meses). */
    billingDay: smallint().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Alvo da FK composta das assinaturas: a assinatura é do mesmo espaço do plano.
    unique('plans_id_space_id_unique').on(t.id, t.spaceId),
    index('plans_space_id_active_idx').on(t.spaceId, t.active),
    index('plans_sport_id_idx').on(t.sportId),
    check('plans_weekly_frequency_range', sql`${t.weeklyFrequency} BETWEEN 1 AND 7`),
    check('plans_price_cents_non_negative', sql`${t.priceCents} >= 0`),
    check('plans_billing_day_range', sql`${t.billingDay} BETWEEN 1 AND 28`),
  ],
);

/**
 * Assinatura do aluno em um plano (RF-CLASS-04..06). Datas do ciclo nulas enquanto aguarda
 * aprovação. O ciclo é o mês do calendário, com vencimento no `billing_day` do plano (decisão 25).
 * Recusa = `CANCELLED` com `rejected_at`; cancelamento pedido = `cancel_at_period_end` + `ends_on`
 * (último dia do último mês pago ou dispensado, RN-CLASS-08). Sem mês coberto, o cancelamento é
 * imediato: `CANCELLED` com `ends_on` = dia do cancelamento e `cancel_at_period_end` falso.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    planId: uuid().notNull(),
    spaceId: uuid().notNull(),
    status: subscriptionStatus().notNull().default('PENDING_APPROVAL'),
    /** Snapshot do preço do plano. */
    priceCents: integer().notNull(),
    startsOn: date({ mode: 'string' }),
    currentPeriodStart: date({ mode: 'string' }),
    currentPeriodEnd: date({ mode: 'string' }),
    intendedPaymentMethod: paymentMethod(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    /** Último dia de serviço depois do cancelamento (RN-CLASS-08); nulo sem cancelamento. */
    endsOn: date({ mode: 'string' }),
    cancelRequestedAt: tstz(),
    approvedAt: tstz(),
    approvedBy: uuid().references(() => users.id),
    rejectedAt: tstz(),
    cancelledAt: tstz(),
    cancelledBy: uuid().references(() => users.id),
    /** Motivo da recusa ou do cancelamento. */
    statusReason: text(),
    /**
     * Último dia (no fuso do espaço) em que o job de mensalidades processou a assinatura: o job
     * roda de hora em hora e cada assinatura passa uma vez por dia, depois da meia-noite local.
     */
    billingProcessedOn: date({ mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'subscriptions_plan_space_fk',
      columns: [t.planId, t.spaceId],
      foreignColumns: [plans.id, plans.spaceId],
    }),
    // Uma assinatura em aberto por aluno e plano.
    uniqueIndex('subscriptions_open_user_plan_unique')
      .on(t.userId, t.planId)
      .where(sql`${t.status} IN ('PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE')`),
    index('subscriptions_space_id_status_idx').on(t.spaceId, t.status),
    index('subscriptions_plan_id_idx').on(t.planId),
    index('subscriptions_user_id_idx').on(t.userId),
    index('subscriptions_approved_by_idx').on(t.approvedBy),
    index('subscriptions_cancelled_by_idx').on(t.cancelledBy),
    check(
      'subscriptions_cancel_has_end',
      sql`NOT ${t.cancelAtPeriodEnd} OR ${t.endsOn} IS NOT NULL`,
    ),
    check('subscriptions_price_cents_non_negative', sql`${t.priceCents} >= 0`),
    check(
      'subscriptions_period_valid',
      sql`${t.currentPeriodEnd} IS NULL OR ${t.currentPeriodStart} IS NULL OR ${t.currentPeriodEnd} >= ${t.currentPeriodStart}`,
    ),
  ],
);

/**
 * Matrícula: vínculo da assinatura com a turma fixa (RN-CLASS-01/02). `PENDING` guarda a turma
 * escolhida no pedido e não ocupa vaga; a aprovação a torna `ACTIVE`.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id),
    classGroupId: uuid()
      .notNull()
      .references(() => classGroups.id),
    status: enrollmentStatus().notNull().default('ACTIVE'),
    startedOn: date({ mode: 'string' }).notNull(),
    endedOn: date({ mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    // Uma matrícula ativa por assinatura e turma.
    uniqueIndex('enrollments_active_subscription_group_unique')
      .on(t.subscriptionId, t.classGroupId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('enrollments_class_group_id_status_idx').on(t.classGroupId, t.status),
    index('enrollments_subscription_id_idx').on(t.subscriptionId),
    check('enrollments_dates_valid', sql`${t.endedOn} IS NULL OR ${t.endedOn} >= ${t.startedOn}`),
  ],
);

/** Mensalidade da assinatura (RF-CLASS-11): uma por ciclo, sem pró-rata (decisão 25). */
export const subscriptionCharges = pgTable(
  'subscription_charges',
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id),
    periodStart: date({ mode: 'string' }).notNull(),
    periodEnd: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    amountCents: integer().notNull(),
    /** Abatimento do estorno manual do pagamento online (decisão 93); sai do saldo em aberto. */
    discountCents: integer().notNull().default(0),
    status: chargeStatus().notNull().default('PENDING'),
    /** Lembrete de vencimento enviado (job; nulo = ainda não). */
    dueReminderSentAt: tstz(),
    /** Aviso de mensalidade vencida enviado (job; nulo = ainda não). */
    overdueNotifiedAt: tstz(),
    /** Dispensa (`WAIVED`) pelo Dono/Admin ou pelo cancelamento (RN-CLASS-08). */
    waivedAt: tstz(),
    waivedBy: uuid().references(() => users.id),
    waiveReason: text(),
    ...timestamps,
  },
  (t) => [
    unique('subscription_charges_subscription_period_unique').on(t.subscriptionId, t.periodStart),
    index('subscription_charges_status_due_date_idx').on(t.status, t.dueDate),
    check('subscription_charges_amount_cents_non_negative', sql`${t.amountCents} >= 0`),
    check(
      'subscription_charges_discount_valid',
      sql`${t.discountCents} BETWEEN 0 AND ${t.amountCents}`,
    ),
    check('subscription_charges_period_valid', sql`${t.periodEnd} >= ${t.periodStart}`),
    index('subscription_charges_waived_by_idx').on(t.waivedBy),
    check(
      'subscription_charges_waive_consistent',
      sql`(${t.status} = 'WAIVED') = (${t.waivedAt} IS NOT NULL)`,
    ),
  ],
);

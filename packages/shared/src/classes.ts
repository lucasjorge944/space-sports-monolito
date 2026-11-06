import { z } from 'zod';
import { localDateSchema, oneOrMany } from './booking';
import { centsSchema } from './money';
import { sportLevelSchema } from './profile';
import { OCCUPATION_KINDS, startTimeSchema } from './recurring';
import { utcToZoned } from './time';

// Aulas: professores, turmas fixas, sessões e planos (RF-CLASS-01..03; RN-CLASS-01/02/04;
// decisões 24 a 26). Assinaturas, matrículas e mensalidades: tarefa 2.2; presença: 2.3.

export const CLASS_SESSION_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED', 'DONE', 'CANCELLED'] as const;
export const classSessionStatusSchema = z.enum(CLASS_SESSION_STATUSES);
export type ClassSessionStatus = z.infer<typeof classSessionStatusSchema>;

export const ATTENDANCE_STATUSES = [
  'CONFIRMED',
  'WAITLIST',
  'CANCELLED',
  'PRESENT',
  'ABSENT',
] as const;
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const SUBSCRIPTION_STATUSES = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** `PENDING`: turma escolhida no pedido, enquanto a assinatura aguarda aprovação (tarefa 2.2). */
export const ENROLLMENT_STATUSES = ['PENDING', 'ACTIVE', 'ENDED'] as const;
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

/** Antecedência da geração das sessões das turmas fixas: 4 semanas. */
export const CLASS_SESSION_GENERATION_DAYS = 28;
/** Teto de alunos por turma/sessão (sanidade de entrada). */
export const MAX_CLASS_CAPACITY = 100;
/** Teto de professores por turma/sessão (sanidade de entrada). */
export const MAX_CLASS_TEACHERS = 10;
/** Duração máxima de uma aula. */
export const MAX_CLASS_DURATION_MIN = 6 * 60;
/** Intervalo máximo de datas na listagem de sessões. */
export const MAX_CLASS_SESSIONS_RANGE_DAYS = 62;

const isoString = z.iso.datetime();
const name = z.string().trim().min(1).max(80);
const capacity = z.number().int().min(1).max(MAX_CLASS_CAPACITY);
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/** `memberId` dos Professores do espaço (GET …/teachers): ao menos um, sem repetir (decisão 47). */
const teacherMemberIds = z
  .array(z.uuid())
  .min(1)
  .max(MAX_CLASS_TEACHERS)
  .refine((ids) => new Set(ids).size === ids.length, 'Professor repetido na lista.');

/** Duração da aula em múltiplos de 30 min. */
export const classDurationMinSchema = z
  .number()
  .int()
  .min(30)
  .max(MAX_CLASS_DURATION_MIN)
  .multipleOf(30, 'A duração deve ser múltipla de 30 minutos.');

// ---------------------------------------------------------------------------------------------
// Requisições

const classGroupFields = {
  name,
  sportId: z.uuid(),
  /** Nulo = todos os níveis. */
  level: sportLevelSchema.nullable().default(null),
  /** Professores padrão das aulas; cada aula pode ter os próprios. */
  teacherMemberIds,
  courtId: z.uuid(),
  /** 0 = domingo … 6 = sábado. */
  weekday: z.number().int().min(0).max(6),
  /** Horário local do espaço (`HH:MM`, hora cheia ou meia hora). */
  startTime: startTimeSchema,
  durationMin: classDurationMinSchema,
  /** Máximo de matrículas ativas (RN-CLASS-02); as sessões herdam o valor. */
  capacity,
  active: z.boolean().default(true),
};

/** POST /v1/manage/spaces/:spaceId/class-groups */
export const createClassGroupSchema = z.object(classGroupFields).strict();
export type CreateClassGroupInput = z.infer<typeof createClassGroupSchema>;

/** PATCH /v1/manage/spaces/:spaceId/class-groups/:classGroupId: só os campos enviados mudam. */
export const updateClassGroupSchema = z
  .object({
    name,
    sportId: z.uuid(),
    level: sportLevelSchema.nullable(),
    teacherMemberIds,
    courtId: z.uuid(),
    weekday: classGroupFields.weekday,
    startTime: startTimeSchema,
    durationMin: classDurationMinSchema,
    capacity,
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo.');
export type UpdateClassGroupInput = z.infer<typeof updateClassGroupSchema>;

/** GET /v1/manage/spaces/:spaceId/class-groups */
export const classGroupsQuerySchema = z.object({
  active: queryBoolean,
  sportId: z.uuid().optional(),
  courtId: z.uuid().optional(),
  teacherMemberId: z.uuid().optional(),
});
export type ClassGroupsQuery = z.infer<typeof classGroupsQuerySchema>;

/** GET /v1/manage/spaces/:spaceId/class-sessions: por data local do espaço, `from` a `to` inclusive. */
export const classSessionsQuerySchema = z
  .object({
    /** Padrão: hoje. */
    from: localDateSchema.optional(),
    /** Padrão: `from` + 27 dias. Até 62 dias depois de `from`. */
    to: localDateSchema.optional(),
    classGroupId: z.uuid().optional(),
    teacherMemberId: z.uuid().optional(),
    status: oneOrMany(classSessionStatusSchema),
  })
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: '`to` não pode ser anterior a `from`.',
    path: ['to'],
  });
export type ClassSessionsQuery = z.infer<typeof classSessionsQuerySchema>;

/**
 * PATCH /v1/manage/spaces/:spaceId/class-sessions/:sessionId: ajuste da capacidade ou troca da
 * lista de professores só desta aula (RF-CLASS-09). `teacherMemberIds` substitui a lista inteira.
 */
export const updateClassSessionSchema = z
  .object({ capacity, teacherMemberIds })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo.');
export type UpdateClassSessionInput = z.infer<typeof updateClassSessionSchema>;

const planFields = {
  name,
  sportId: z.uuid(),
  /** 1, 2, 3… turmas por semana (RN-CLASS-01); nulo = ilimitado nas turmas matriculadas. */
  weeklyFrequency: z.number().int().min(1).max(7).nullable(),
  /** Valor mensal. */
  priceCents: centsSchema,
  /** Dia fixo de vencimento no mês (1 a 28), sem pró-rata (decisão 25). */
  billingDay: z.number().int().min(1).max(28),
  active: z.boolean().default(true),
};

/** POST /v1/manage/spaces/:spaceId/plans */
export const createPlanSchema = z.object(planFields).strict();
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/** PATCH /v1/manage/spaces/:spaceId/plans/:planId */
export const updatePlanSchema = z
  .object({
    ...planFields,
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo.');
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

/** GET /v1/manage/spaces/:spaceId/plans */
export const plansQuerySchema = z.object({
  active: queryBoolean,
  sportId: z.uuid().optional(),
});
export type PlansQuery = z.infer<typeof plansQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Respostas (datas em ISO 8601 UTC; horários das turmas no fuso do espaço)

const sportRef = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });
const courtRef = z.object({ id: z.uuid(), name: z.string() });

/** Professor do espaço (vínculo `TEACHER` ativo em `space_members`, decisão 26). */
export const teacherSchema = z.object({
  /** Id do vínculo (`space_members.id`): é o que vai em `teacherMemberIds` e nos filtros. */
  memberId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type Teacher = z.infer<typeof teacherSchema>;

/**
 * Professor sem os ids do vínculo e do usuário: app do jogador, matrículas, visão de equipe e
 * página pública.
 */
export const teacherRefSchema = teacherSchema.pick({ name: true, avatarUrl: true });
export type TeacherRef = z.infer<typeof teacherRefSchema>;

/** GET /v1/manage/spaces/:spaceId/teachers */
export const teachersResponseSchema = z.object({
  items: z.array(teacherSchema.extend({ activeClassGroupCount: z.number().int().min(0) })),
});
export type TeachersResponse = z.infer<typeof teachersResponseSchema>;

export const classGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sport: sportRef,
  level: sportLevelSchema.nullable(),
  teachers: z.array(teacherSchema),
  court: courtRef,
  weekday: z.number().int(),
  startTime: startTimeSchema,
  durationMin: z.number().int(),
  capacity: z.number().int(),
  active: z.boolean(),
  /** Matrículas ativas (RN-CLASS-02). */
  enrolledCount: z.number().int().min(0),
  /** `capacity − enrolledCount`, nunca negativo. */
  availableSpots: z.number().int().min(0),
  createdAt: isoString,
});
export type ClassGroup = z.infer<typeof classGroupSchema>;

/** O que impediu gerar a sessão: a agenda da quadra ou, com `TEACHER`, os professores. */
export const CLASS_CONFLICT_KINDS = [...OCCUPATION_KINDS, 'TEACHER'] as const;
export const classConflictKindSchema = z.enum(CLASS_CONFLICT_KINDS);
export type ClassConflictKind = z.infer<typeof classConflictKindSchema>;

/** Sessão que não coube na agenda, sinalizada para a gestão pelo job. */
export const classSessionConflictSchema = z.object({
  id: z.uuid(),
  classGroup: z.object({ id: z.uuid(), name: z.string() }),
  court: courtRef,
  startsAt: isoString,
  endsAt: isoString,
  /**
   * O que ocupa o horário: bloqueio, torneio, reserva ou outra aula; `TEACHER` = todos os
   * professores da turma têm aula em outro espaço no horário (decisão 47).
   */
  conflictsWith: classConflictKindSchema,
  createdAt: isoString,
});
export type ClassSessionConflict = z.infer<typeof classSessionConflictSchema>;

export const classGroupDetailSchema = classGroupSchema.extend({
  /** Sessões em aberto que conflitam com a agenda. */
  conflicts: z.array(classSessionConflictSchema),
});
export type ClassGroupDetail = z.infer<typeof classGroupDetailSchema>;

export const classGroupsResponseSchema = z.object({ items: z.array(classGroupSchema) });
export type ClassGroupsResponse = z.infer<typeof classGroupsResponseSchema>;

export const classSessionConflictsResponseSchema = z.object({
  items: z.array(classSessionConflictSchema),
});
export type ClassSessionConflictsResponse = z.infer<typeof classSessionConflictsResponseSchema>;

export const classSessionSchema = z.object({
  id: z.uuid(),
  classGroup: z.object({ id: z.uuid(), name: z.string() }),
  sport: sportRef,
  level: sportLevelSchema.nullable(),
  court: courtRef,
  teachers: z.array(teacherSchema),
  startsAt: isoString,
  endsAt: isoString,
  /** Máximo de vagas ocupadas: confirmados + presenças marcadas (RN-CLASS-03). */
  capacity: z.number().int(),
  status: classSessionStatusSchema,
  /** Vagas ocupadas: confirmados e presenças marcadas (`PRESENT`/`ABSENT`). */
  confirmedCount: z.number().int().min(0),
  waitlistCount: z.number().int().min(0),
  cancelReason: z.string().nullable(),
});
export type ClassSession = z.infer<typeof classSessionSchema>;

export const classSessionsResponseSchema = z.object({
  /** Período consultado (datas locais do espaço). */
  from: localDateSchema,
  to: localDateSchema,
  timeZone: z.string(),
  items: z.array(classSessionSchema),
});
export type ClassSessionsResponse = z.infer<typeof classSessionsResponseSchema>;

export const planSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sport: sportRef,
  /** Nulo = ilimitado nas turmas matriculadas. */
  weeklyFrequency: z.number().int().nullable(),
  priceCents: z.number().int(),
  billingDay: z.number().int(),
  active: z.boolean(),
  createdAt: isoString,
});
export type Plan = z.infer<typeof planSchema>;

export const plansResponseSchema = z.object({ items: z.array(planSchema) });
export type PlansResponse = z.infer<typeof plansResponseSchema>;

/** Plano na página pública (só ativos). */
export const publicPlanSchema = planSchema.omit({ active: true, createdAt: true });
export type PublicPlan = z.infer<typeof publicPlanSchema>;

/** Turma na página pública (só ativas), com vagas (RF-CLASS-04). */
export const publicClassGroupSchema = classGroupSchema
  .omit({ active: true, createdAt: true, teachers: true })
  .extend({ teachers: z.array(teacherRefSchema) });
export type PublicClassGroup = z.infer<typeof publicClassGroupSchema>;

/** GET /v1/spaces/:slug/classes: aba Aulas da página do espaço (só espaços ACTIVE). */
export const publicSpaceClassesSchema = z.object({
  space: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timeZone: z.string() }),
  plans: z.array(publicPlanSchema),
  classGroups: z.array(publicClassGroupSchema),
});
export type PublicSpaceClasses = z.infer<typeof publicSpaceClassesSchema>;

// ---------------------------------------------------------------------------------------------
// Regras puras

const WEEK_MIN = 7 * 24 * 60;

/** Horário semanal (dia da semana + início local + duração). */
export interface WeeklySlot {
  weekday: number;
  /** `HH:MM` ou `HH:MM:SS`. */
  startTime: string;
  durationMin: number;
}

function weekMinute(slot: WeeklySlot): number {
  const [hour, minute] = slot.startTime.split(':').map(Number);
  return slot.weekday * 24 * 60 + (hour ?? 0) * 60 + (minute ?? 0);
}

/**
 * Dois horários semanais se sobrepõem? Considera a aula que passa da meia-noite (e a de sábado
 * que entra no domingo). Intervalos `[início, fim)`: horários adjacentes não conflitam.
 */
export function weeklySlotsOverlap(a: WeeklySlot, b: WeeklySlot): boolean {
  return weekMinutesOverlap(weekMinute(a), a.durationMin, weekMinute(b), b.durationMin);
}

function weekMinutesOverlap(startA: number, durationA: number, startB: number, durationB: number) {
  // Compara `b` deslocado uma semana para trás, igual e para frente.
  return [-WEEK_MIN, 0, WEEK_MIN].some(
    (shift) => startA < startB + shift + durationB && startB + shift < startA + durationA,
  );
}

/** Deslocamento (minutos) da hora local do fuso em relação ao UTC no instante `at`. */
function zoneOffsetMin(timeZone: string, at: Date): number {
  const local = utcToZoned(at, timeZone);
  const utc = at.getUTCDay() * 24 * 60 + at.getUTCHours() * 60 + at.getUTCMinutes();
  const diff = local.weekday * 24 * 60 + local.minuteOfDay - utc;
  // Na virada da semana a diferença dá a volta: traz para (−meia semana, +meia semana].
  return ((((diff + WEEK_MIN / 2) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN) - WEEK_MIN / 2;
}

/** Horário semanal no fuso do espaço dele (`timeZone`). */
export interface ZonedWeeklySlot extends WeeklySlot {
  timeZone: string;
}

/**
 * Como `weeklySlotsOverlap`, mas cada horário no fuso do próprio espaço (decisão 37: o aluno não
 * tem duas aulas no mesmo horário, em qualquer espaço). Os dois vão para UTC pelo deslocamento
 * do fuso em `at` (por padrão, o instante atual), e esse deslocamento vale para todas as semanas:
 * o Brasil não tem horário de verão hoje. Se um dos fusos voltar a ter, duas turmas podem passar
 * a coincidir (ou deixar de) só em parte do ano, e a checagem precisa olhar cada data.
 */
export function zonedWeeklySlotsOverlap(
  a: ZonedWeeklySlot,
  b: ZonedWeeklySlot,
  at: Date = new Date(),
): boolean {
  if (a.timeZone === b.timeZone) return weeklySlotsOverlap(a, b);
  const toUtc = (slot: ZonedWeeklySlot) =>
    (((weekMinute(slot) - zoneOffsetMin(slot.timeZone, at)) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
  return weekMinutesOverlap(toUtc(a), a.durationMin, toUtc(b), b.durationMin);
}

/** Vagas da turma: capacidade menos matrículas ativas, nunca negativo (RN-CLASS-02). */
export function availableSpots(capacity: number, enrolledCount: number): number {
  return Math.max(0, capacity - enrolledCount);
}

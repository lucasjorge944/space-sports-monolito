import { z } from 'zod';
import { localDateSchema, oneOrMany } from './booking';
import {
  attendanceStatusSchema,
  classSessionSchema,
  MAX_CLASS_CAPACITY,
  subscriptionStatusSchema,
  teacherRefSchema,
} from './classes';

// Lista de presença das sessões (RF-CLASS-07..10; RN-CLASS-03..06; decisão 24: sem reposição,
// o aluno só confirma nas sessões das turmas em que está matriculado).

/** Padrão da listagem do aluno: hoje e os próximos 6 dias. */
export const MY_CLASS_SESSIONS_DEFAULT_DAYS = 7;
/** Intervalo máximo de datas na listagem do aluno. */
export const MAX_MY_CLASS_SESSIONS_RANGE_DAYS = 31;
/** Intervalo máximo do histórico de presença e da frequência. */
export const MAX_ATTENDANCE_HISTORY_RANGE_DAYS = 366;
/** Padrão do histórico de presença e da frequência: os últimos 30 dias. */
export const ATTENDANCE_HISTORY_DEFAULT_DAYS = 30;

/**
 * Por que o aluno não pode confirmar agora (o app mostra o motivo):
 * - `LIST_NOT_OPEN`: a lista não está aberta (ou a aula já começou);
 * - `NOT_ENROLLED`: não tem matrícula ativa na turma (RN-CLASS-01/03);
 * - `SUBSCRIPTION_ACCESS_ENDED`: a aula é depois do último dia de acesso do plano (RN-CLASS-08);
 * - `SUBSCRIPTION_PAST_DUE`: mensalidade em atraso com a regra ligada (RN-CLASS-06);
 * - `SCHEDULE_OVERLAP`: o aluno já está confirmado ou na espera de outra aula no mesmo horário
 *   (RN-CLASS-01, decisão 37).
 */
export const ATTENDANCE_BLOCK_REASONS = [
  'LIST_NOT_OPEN',
  'NOT_ENROLLED',
  'SUBSCRIPTION_ACCESS_ENDED',
  'SUBSCRIPTION_PAST_DUE',
  'SCHEDULE_OVERLAP',
] as const;
export const attendanceBlockReasonSchema = z.enum(ATTENDANCE_BLOCK_REASONS);
export type AttendanceBlockReason = z.infer<typeof attendanceBlockReasonSchema>;

/** Presença real marcada pela gestão depois do início da aula. */
export const PRESENCE_STATUSES = ['PRESENT', 'ABSENT'] as const;
export const presenceStatusSchema = z.enum(PRESENCE_STATUSES);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

const isoString = z.iso.datetime();
const userRef = z.object({ userId: z.uuid(), name: z.string(), avatarUrl: z.string().nullable() });

const dateRangeFields = { from: localDateSchema.optional(), to: localDateSchema.optional() };
const toAfterFrom = (v: { from?: string; to?: string }) => !v.from || !v.to || v.to >= v.from;
const toAfterFromError = { message: '`to` não pode ser anterior a `from`.', path: ['to'] };

// ---------------------------------------------------------------------------------------------
// Requisições

/** GET /v1/me/class-sessions: datas locais do espaço, `from` a `to` inclusive. */
export const myClassSessionsQuerySchema = z
  .object(dateRangeFields)
  .refine(toAfterFrom, toAfterFromError);
export type MyClassSessionsQuery = z.infer<typeof myClassSessionsQuerySchema>;

/** POST /v1/manage/spaces/:spaceId/class-sessions/:sessionId/cancel */
export const cancelClassSessionSchema = z
  .object({
    /** Motivo mostrado aos alunos (feriado, chuva…). */
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type CancelClassSessionInput = z.infer<typeof cancelClassSessionSchema>;

/** POST /v1/manage/spaces/:spaceId/class-sessions/:sessionId/attendances */
export const addAttendeeSchema = z.object({ userId: z.uuid() }).strict();
export type AddAttendeeInput = z.infer<typeof addAttendeeSchema>;

/** PUT /v1/manage/spaces/:spaceId/class-sessions/:sessionId/presence */
export const markPresenceSchema = z
  .object({
    items: z
      .array(z.object({ userId: z.uuid(), status: presenceStatusSchema }).strict())
      .min(1)
      .max(MAX_CLASS_CAPACITY * 2)
      .refine((items) => new Set(items.map((item) => item.userId)).size === items.length, {
        message: 'Aluno repetido.',
      }),
  })
  .strict();
export type MarkPresenceInput = z.infer<typeof markPresenceSchema>;

/**
 * GET /v1/manage/spaces/:spaceId/class-attendances: histórico de presença por aluno e/ou turma
 * (exige `userId` ou `classGroupId`). Datas locais, padrão os últimos 30 dias.
 */
export const classAttendancesQuerySchema = z
  .object({
    ...dateRangeFields,
    userId: z.uuid().optional(),
    classGroupId: z.uuid().optional(),
    status: oneOrMany(attendanceStatusSchema),
  })
  .refine(toAfterFrom, toAfterFromError);
export type ClassAttendancesQuery = z.infer<typeof classAttendancesQuerySchema>;

/** GET /v1/manage/spaces/:spaceId/class-groups/:classGroupId/frequency */
export const classGroupFrequencyQuerySchema = z
  .object(dateRangeFields)
  .refine(toAfterFrom, toAfterFromError);
export type ClassGroupFrequencyQuery = z.infer<typeof classGroupFrequencyQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Respostas

/** Aluno na lista da sessão (gestão e visão de equipe). */
export const attendeeSchema = userRef.extend({
  status: attendanceStatusSchema,
  /** Posição na espera (1 = próximo); só em `WAITLIST`. */
  waitlistPosition: z.number().int().positive().nullable(),
  /** Incluído pela gestão (RF-CLASS-09). */
  addedByStaff: z.boolean(),
});
export type Attendee = z.infer<typeof attendeeSchema>;

/** Detalhe da sessão na gestão: a lista e os matriculados da turma. */
export const classSessionDetailSchema = classSessionSchema.extend({
  openedAt: isoString.nullable(),
  closedAt: isoString.nullable(),
  cancelledAt: isoString.nullable(),
  /** Confirmados, espera e presenças (sem as desistências), confirmados primeiro. */
  attendances: z.array(attendeeSchema),
  /** Alunos com matrícula ativa na turma (base para adicionar e marcar presença). */
  enrolledStudents: z.array(userRef.extend({ subscriptionStatus: subscriptionStatusSchema })),
});
export type ClassSessionDetail = z.infer<typeof classSessionDetailSchema>;

/** Sessão na visão do aluno (RF-CLASS-07). */
export const myClassSessionSchema = classSessionSchema.omit({ teachers: true }).extend({
  teachers: z.array(teacherRefSchema),
  space: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timeZone: z.string() }),
  /** Situação do aluno na sessão; nulo = ainda não confirmou (ou desistiu). */
  myAttendance: z
    .object({
      status: attendanceStatusSchema,
      waitlistPosition: z.number().int().positive().nullable(),
    })
    .nullable(),
  /** Pode confirmar agora (lista aberta, matriculado, sem bloqueio e ainda não confirmado). */
  canConfirm: z.boolean(),
  /** Pode desistir agora (confirmado antes do prazo, ou na espera). */
  canWithdraw: z.boolean(),
  /** Motivo de não poder confirmar; nulo quando pode ou já está na lista. */
  blockedReason: attendanceBlockReasonSchema.nullable(),
  /** Prazo para desistir sendo confirmado (`startsAt − attendance_cancel_deadline_min`). */
  cancellableUntil: isoString,
});
export type MyClassSession = z.infer<typeof myClassSessionSchema>;

export const myClassSessionsResponseSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  items: z.array(myClassSessionSchema),
});
export type MyClassSessionsResponse = z.infer<typeof myClassSessionsResponseSchema>;

/** Detalhe da sessão para o aluno: quem confirmou (a espera aparece só em número). */
export const myClassSessionDetailSchema = myClassSessionSchema.extend({
  confirmed: z.array(userRef),
});
export type MyClassSessionDetail = z.infer<typeof myClassSessionDetailSchema>;

/** Linha do histórico de presença. */
export const classAttendanceRecordSchema = z.object({
  id: z.uuid(),
  student: userRef,
  session: z.object({
    id: z.uuid(),
    classGroup: z.object({ id: z.uuid(), name: z.string() }),
    startsAt: isoString,
    endsAt: isoString,
    status: classSessionSchema.shape.status,
  }),
  status: attendanceStatusSchema,
  waitlistPosition: z.number().int().positive().nullable(),
  addedByStaff: z.boolean(),
  updatedAt: isoString,
});
export type ClassAttendanceRecord = z.infer<typeof classAttendanceRecordSchema>;

/** Contagem por situação (base dos relatórios). */
export const attendanceCountsSchema = z.object({
  present: z.number().int().min(0),
  absent: z.number().int().min(0),
  /** Confirmado em aula já dada, sem presença marcada. */
  unmarked: z.number().int().min(0),
  /** `present / (present + absent)`, de 0 a 1; nulo sem presença marcada. */
  attendanceRate: z.number().min(0).max(1).nullable(),
});
export type AttendanceCounts = z.infer<typeof attendanceCountsSchema>;

export const classAttendancesResponseSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  /** Mais recentes primeiro. */
  items: z.array(classAttendanceRecordSchema),
  /** Só das aulas dadas (`DONE`) do período. */
  summary: attendanceCountsSchema,
});
export type ClassAttendancesResponse = z.infer<typeof classAttendancesResponseSchema>;

/** Frequência da turma no período (aulas dadas = `DONE`). */
export const classGroupFrequencySchema = z.object({
  classGroup: z.object({ id: z.uuid(), name: z.string() }),
  from: localDateSchema,
  to: localDateSchema,
  sessionsDone: z.number().int().min(0),
  sessionsCancelled: z.number().int().min(0),
  totals: attendanceCountsSchema,
  /** Alunos matriculados hoje e quem teve presença no período. */
  students: z.array(userRef.extend({ enrolled: z.boolean(), ...attendanceCountsSchema.shape })),
});
export type ClassGroupFrequency = z.infer<typeof classGroupFrequencySchema>;

/** Aula de hoje na visão de equipe do app (somente leitura, sem valores). */
export const staffTodayClassSessionSchema = z.object({
  id: z.uuid(),
  classGroup: z.object({ id: z.uuid(), name: z.string() }),
  sportName: z.string(),
  court: z.object({ id: z.uuid(), name: z.string() }),
  teachers: z.array(teacherRefSchema),
  startsAt: isoString,
  endsAt: isoString,
  status: classSessionSchema.shape.status,
  capacity: z.number().int(),
  /** Vagas ocupadas: confirmados e presenças marcadas (`PRESENT`/`ABSENT`). */
  confirmedCount: z.number().int().min(0),
  waitlistCount: z.number().int().min(0),
  attendees: z.array(attendeeSchema.omit({ addedByStaff: true })),
});
export type StaffTodayClassSession = z.infer<typeof staffTodayClassSessionSchema>;

// ---------------------------------------------------------------------------------------------
// Regras puras

/** `present / (present + absent)`; nulo sem presença marcada. */
export function attendanceRate(present: number, absent: number): number | null {
  const marked = present + absent;
  return marked === 0 ? null : Math.round((present / marked) * 10_000) / 10_000;
}

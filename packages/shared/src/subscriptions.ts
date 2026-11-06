import { z } from 'zod';
import { localDateSchema, oneOrMany, pageFields, playerPaymentSchema } from './booking';
import { enrollmentStatusSchema, subscriptionStatusSchema, teacherRefSchema } from './classes';
import { centsSchema } from './money';
import { openOnlineChargeSchema } from './online-payments';
import { startTimeSchema } from './recurring';
import { paymentMethodSchema } from './spaces';
import { addDays } from './time';

// Assinaturas, matrículas e mensalidades das aulas (RF-CLASS-04..06, RF-CLASS-11;
// RN-CLASS-01/02/06/07/08; decisões 12, 24, 25 e 45). Tarefa 2.2.

/** Assinatura em aberto: no máximo uma por aluno e plano. */
export const OPEN_SUBSCRIPTION_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE'] as const;

export const CHARGE_STATUSES = ['PENDING', 'PAID', 'OVERDUE', 'WAIVED'] as const;
export const chargeStatusSchema = z.enum(CHARGE_STATUSES);
export type ChargeStatus = z.infer<typeof chargeStatusSchema>;

/**
 * A mensalidade do mês é gerada a partir do dia 1 ou, se o vencimento cai nos primeiros dias,
 * alguns dias antes dele (para o lembrete de vencimento sair a tempo).
 */
export const CHARGE_GENERATION_LEAD_DAYS = 5;
/** Lembrete de "mensalidade próxima do vencimento": até 3 dias antes. */
export const CHARGE_DUE_SOON_DAYS = 3;
/** Texto fixo da mensalidade dispensada pelo cancelamento imediato (RN-CLASS-08). */
export const CANCELLATION_WAIVE_REASON = 'Dispensada pelo cancelamento do plano';
/** Máximo de turmas escolhidas numa assinatura (sanidade de entrada). */
export const MAX_SUBSCRIPTION_CLASS_GROUPS = 14;

const isoString = z.iso.datetime();
const reason = z.string().trim().min(1).max(500).optional();
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
const classGroupIds = z
  .array(z.uuid())
  .min(1)
  .max(MAX_SUBSCRIPTION_CLASS_GROUPS)
  .refine((ids) => new Set(ids).size === ids.length, 'Turmas repetidas.');

// ---------------------------------------------------------------------------------------------
// Requisições

/** POST /v1/me/subscriptions: o aluno contrata o plano escolhendo as turmas fixas (RF-CLASS-04). */
export const requestSubscriptionSchema = z
  .object({
    planId: z.uuid(),
    /** Plano Nx/semana: exatamente N turmas do esporte do plano; ilimitado: uma ou mais. */
    classGroupIds,
    /** Forma de pagamento pretendida (informativa, RF-PAY-02). */
    intendedPaymentMethod: paymentMethodSchema.optional(),
  })
  .strict();
export type RequestSubscriptionInput = z.infer<typeof requestSubscriptionSchema>;

/** PATCH /v1/me/subscriptions/:subscriptionId: forma de pagamento preferida (RF-CLASS-06). */
export const updateMySubscriptionSchema = z
  .object({ intendedPaymentMethod: paymentMethodSchema.nullable() })
  .strict();
export type UpdateMySubscriptionInput = z.infer<typeof updateMySubscriptionSchema>;

/** Recusa, cancelamento e dispensa de mensalidade: motivo opcional. */
export const subscriptionReasonSchema = z.object({ reason }).strict();
export type SubscriptionReasonInput = z.infer<typeof subscriptionReasonSchema>;

/** Aprovação; `classGroupIds` substitui as turmas pedidas (mesmas regras do pedido). */
export const approveSubscriptionSchema = z
  .object({ classGroupIds: classGroupIds.optional() })
  .strict();
export type ApproveSubscriptionInput = z.infer<typeof approveSubscriptionSchema>;

/** Troca de turma (RF-CLASS-05/06): encerra a matrícula de uma turma e abre na outra. */
export const swapClassGroupSchema = z
  .object({ fromClassGroupId: z.uuid(), toClassGroupId: z.uuid() })
  .strict()
  .refine((v) => v.fromClassGroupId !== v.toClassGroupId, {
    message: 'Escolha uma turma diferente.',
    path: ['toClassGroupId'],
  });
export type SwapClassGroupInput = z.infer<typeof swapClassGroupSchema>;

/** POST …/subscriptions/:subscriptionId/enrollments: matricula em mais uma turma (gestão). */
export const addEnrollmentSchema = z.object({ classGroupId: z.uuid() }).strict();
export type AddEnrollmentInput = z.infer<typeof addEnrollmentSchema>;

/** GET /v1/me/subscriptions */
export const mySubscriptionsQuerySchema = z.object({
  status: oneOrMany(subscriptionStatusSchema),
});
export type MySubscriptionsQuery = z.infer<typeof mySubscriptionsQuerySchema>;

/** GET /v1/manage/spaces/:spaceId/subscriptions (mais recentes primeiro). */
export const subscriptionsQuerySchema = z.object({
  status: oneOrMany(subscriptionStatusSchema),
  planId: z.uuid().optional(),
  classGroupId: z.uuid().optional(),
  userId: z.uuid().optional(),
  ...pageFields,
});
export type SubscriptionsQuery = z.infer<typeof subscriptionsQuerySchema>;

/** GET /v1/manage/spaces/:spaceId/subscription-charges (por vencimento). */
export const subscriptionChargesQuerySchema = z
  .object({
    status: oneOrMany(chargeStatusSchema),
    /** `true`: só as em aberto já vencidas (inadimplência), mesmo antes do job marcar. */
    overdue: queryBoolean,
    subscriptionId: z.uuid().optional(),
    userId: z.uuid().optional(),
    /** Vencimento a partir de (data local). */
    dueFrom: localDateSchema.optional(),
    /** Vencimento até (inclusive). */
    dueTo: localDateSchema.optional(),
    ...pageFields,
  })
  .refine((v) => !v.dueFrom || !v.dueTo || v.dueTo >= v.dueFrom, {
    message: '`dueTo` não pode ser anterior a `dueFrom`.',
    path: ['dueTo'],
  });
export type SubscriptionChargesQuery = z.infer<typeof subscriptionChargesQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Respostas (datas locais do espaço em `YYYY-MM-DD`; instantes em ISO 8601 UTC)

const sportRef = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });
const personRef = z.object({
  userId: z.uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export const subscriptionClassGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  weekday: z.number().int(),
  startTime: startTimeSchema,
  durationMin: z.number().int(),
  court: z.object({ id: z.uuid(), name: z.string() }),
  teachers: z.array(teacherRefSchema),
  active: z.boolean(),
});

/** Matrícula: `PENDING` enquanto a assinatura aguarda aprovação. */
export const enrollmentSchema = z.object({
  id: z.uuid(),
  status: enrollmentStatusSchema,
  startedOn: localDateSchema,
  endedOn: localDateSchema.nullable(),
  classGroup: subscriptionClassGroupSchema,
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

/** Próxima mensalidade: a em aberto mais antiga ou, sem nenhuma, a prevista. */
export const nextChargeSchema = z.object({
  /** Nulo quando ainda é só previsão (a mensalidade não foi gerada). */
  chargeId: z.uuid().nullable(),
  dueDate: localDateSchema,
  /** Valor em aberto (a prevista: o preço da assinatura). */
  amountCents: centsSchema,
  status: z.enum(['PROJECTED', 'PENDING', 'OVERDUE']),
});
export type NextCharge = z.infer<typeof nextChargeSchema>;

export const subscriptionSchema = z.object({
  id: z.uuid(),
  space: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), timeZone: z.string() }),
  plan: z.object({
    id: z.uuid(),
    name: z.string(),
    sport: sportRef,
    /** Nulo = ilimitado nas turmas matriculadas. */
    weeklyFrequency: z.number().int().nullable(),
    /** Dia fixo de vencimento (decisão 25). */
    billingDay: z.number().int(),
  }),
  student: personRef,
  status: subscriptionStatusSchema,
  /** Preço contratado (snapshot do plano no pedido). */
  priceCents: centsSchema,
  intendedPaymentMethod: paymentMethodSchema.nullable(),
  /** Data da aprovação; nula enquanto aguarda. */
  startsOn: localDateSchema.nullable(),
  /** Ciclo (mês) em curso. */
  currentPeriodStart: localDateSchema.nullable(),
  currentPeriodEnd: localDateSchema.nullable(),
  /** Cancelamento pedido: a assinatura segue em curso até `endsOn` (RN-CLASS-08). */
  cancelAtPeriodEnd: z.boolean(),
  /** Último dia de serviço; nulo sem cancelamento. */
  endsOn: localDateSchema.nullable(),
  /**
   * Último dia de acesso às aulas (decisão 45), para o app mostrar "Seu plano fica ativo até
   * dd/mm/aaaa". Nulo enquanto a assinatura não tem fim marcado, mesmo com o mês em aberto.
   */
  accessUntil: localDateSchema.nullable(),
  /**
   * Prévia para explicar antes de confirmar: até quando o acesso iria se o cancelamento fosse
   * pedido agora. Nulo = terminaria no ato (ou a assinatura não está em curso, ou já foi cancelada).
   */
  accessUntilIfCancelled: localDateSchema.nullable(),
  /** Pedido recusado pela gestão (status `CANCELLED`). */
  rejected: z.boolean(),
  /** Motivo da recusa ou do cancelamento. */
  statusReason: z.string().nullable(),
  approvedAt: isoString.nullable(),
  cancelledAt: isoString.nullable(),
  createdAt: isoString,
  /** Pendentes e ativas primeiro; as encerradas por último. */
  enrollments: z.array(enrollmentSchema),
  nextCharge: nextChargeSchema.nullable(),
  /** Soma em aberto das mensalidades vencidas. */
  overdueCents: centsSchema,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscriptionChargeSchema = z.object({
  id: z.uuid(),
  subscriptionId: z.uuid(),
  /** Mês cobrado (sem pró-rata). */
  periodStart: localDateSchema,
  periodEnd: localDateSchema,
  dueDate: localDateSchema,
  amountCents: centsSchema,
  /** Pagamentos registrados e não estornados. */
  paidCents: centsSchema,
  /** Abatimento do estorno manual do pagamento online (decisão 93). */
  discountCents: centsSchema,
  /** `amountCents − discountCents − paidCents` (0 se paga ou dispensada). */
  dueCents: centsSchema,
  /** Cobrança online aberta (Pix pendente), se houver (RF-ONPAY-05). */
  openOnlineCharge: openOnlineChargeSchema.nullable(),
  status: chargeStatusSchema,
  waivedAt: isoString.nullable(),
  /** Texto fixo se a dispensa veio do cancelamento (RN-CLASS-08); nas demais, nulo. */
  waiveNotice: z.string().nullable(),
  /** Pagamentos não estornados (o detalhe com estornos fica no extrato da gestão). */
  payments: z.array(playerPaymentSchema),
  createdAt: isoString,
});
export type SubscriptionCharge = z.infer<typeof subscriptionChargeSchema>;

export const subscriptionChargesResponseSchema = z.object({
  items: z.array(subscriptionChargeSchema),
});
export type SubscriptionChargesResponse = z.infer<typeof subscriptionChargesResponseSchema>;

export const subscriptionDetailSchema = subscriptionSchema.extend({
  /** Mensalidades, mais recentes primeiro. */
  charges: z.array(subscriptionChargeSchema),
});
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;

/** Mensalidade na gestão: com o motivo da dispensa, que o aluno não vê. */
export const staffSubscriptionChargeSchema = subscriptionChargeSchema.extend({
  /** Motivo informado na dispensa ou o texto fixo do cancelamento. */
  waiveReason: z.string().nullable(),
});
export type StaffSubscriptionCharge = z.infer<typeof staffSubscriptionChargeSchema>;

export const staffSubscriptionDetailSchema = subscriptionSchema.extend({
  /** Mensalidades, mais recentes primeiro. */
  charges: z.array(staffSubscriptionChargeSchema),
});
export type StaffSubscriptionDetail = z.infer<typeof staffSubscriptionDetailSchema>;

export const subscriptionsResponseSchema = z.object({ items: z.array(subscriptionSchema) });
export type SubscriptionsResponse = z.infer<typeof subscriptionsResponseSchema>;

export const subscriptionPageSchema = z.object({
  items: z.array(subscriptionSchema),
  nextCursor: z.string().nullable(),
});
export type SubscriptionPage = z.infer<typeof subscriptionPageSchema>;

/** Mensalidade na lista da gestão: com o aluno e o plano. */
export const spaceSubscriptionChargeSchema = staffSubscriptionChargeSchema.extend({
  student: personRef,
  plan: z.object({ id: z.uuid(), name: z.string() }),
  subscriptionStatus: subscriptionStatusSchema,
});
export type SpaceSubscriptionCharge = z.infer<typeof spaceSubscriptionChargeSchema>;

export const spaceSubscriptionChargePageSchema = z.object({
  items: z.array(spaceSubscriptionChargeSchema),
  nextCursor: z.string().nullable(),
  /** Soma em aberto (`dueCents`) de todas as páginas com os filtros aplicados. */
  totalDueCents: centsSchema,
});
export type SpaceSubscriptionChargePage = z.infer<typeof spaceSubscriptionChargePageSchema>;

/** Inadimplente: assinatura com mensalidade vencida e em aberto (RF-CLASS-11). */
export const delinquentSchema = z.object({
  subscriptionId: z.uuid(),
  subscriptionStatus: subscriptionStatusSchema,
  student: personRef,
  plan: z.object({ id: z.uuid(), name: z.string() }),
  overdueCount: z.number().int().min(1),
  overdueCents: centsSchema,
  /** Vencimento mais antigo em aberto. */
  oldestDueDate: localDateSchema,
  /** Dias desde o vencimento mais antigo. */
  daysOverdue: z.number().int().min(1),
});
export type Delinquent = z.infer<typeof delinquentSchema>;

export const delinquentsResponseSchema = z.object({
  /** Data local de referência (hoje no fuso do espaço). */
  date: localDateSchema,
  totalOverdueCents: centsSchema,
  items: z.array(delinquentSchema),
});
export type DelinquentsResponse = z.infer<typeof delinquentsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Regras puras

/** Dias de `from` até `to` (datas `YYYY-MM-DD`); negativo se `to` é anterior. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Primeiro dia do mês de `date` deslocado `months` meses. */
export function monthStart(date: string, months = 0): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export interface ChargePeriod {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

/**
 * Ciclo da mensalidade (decisão 25): o mês do calendário que contém `date`, com vencimento no
 * `billingDay` (1 a 28, existe em todos os meses). Sem pró-rata: o valor é sempre o cheio.
 */
export function chargePeriod(date: string, billingDay: number): ChargePeriod {
  const periodStart = monthStart(date);
  return {
    periodStart,
    periodEnd: addDays(monthStart(date, 1), -1),
    dueDate: `${periodStart.slice(0, 8)}${String(billingDay).padStart(2, '0')}`,
  };
}

/** A partir de quando a mensalidade do ciclo pode ser gerada. */
export function chargeGenerationStart(period: ChargePeriod): string {
  const lead = addDays(period.dueDate, -CHARGE_GENERATION_LEAD_DAYS);
  // biome-ignore lint/complexity/useMathMinMax: compara datas `YYYY-MM-DD` (strings), não números.
  return lead < period.periodStart ? lead : period.periodStart;
}

/** O que importa da assinatura para decidir se um ciclo é cobrado. */
export interface BillableSubscription {
  /** Data da aprovação. */
  startsOn: string;
  /** Último dia de serviço (cancelamento pedido), se houver. */
  endsOn: string | null;
}

/**
 * O ciclo é cobrado? Sem pró-rata (decisão 25): quem foi aprovado até o vencimento paga o mês
 * cheio; aprovado depois do vencimento começa a pagar no mês seguinte. O cancelamento (RN-CLASS-08)
 * não gera mensalidade de ciclo que começa depois do fim.
 */
export function isPeriodBillable(sub: BillableSubscription, period: ChargePeriod): boolean {
  if (sub.startsOn > period.dueDate) return false;
  return !sub.endsOn || period.periodStart <= sub.endsOn;
}

/**
 * Ciclos que o job deve garantir hoje: o do mês corrente e, quando a geração antecipada já
 * começou, o do mês seguinte. Só os cobráveis.
 *
 * Só olha esses dois meses: se o job ficar parado um mês inteiro, a mensalidade daquele mês não
 * é recuperada (precisa ser lançada à mão).
 */
export function chargePeriodsToGenerate(
  sub: BillableSubscription,
  billingDay: number,
  today: string,
): ChargePeriod[] {
  return [chargePeriod(today, billingDay), chargePeriod(monthStart(today, 1), billingDay)].filter(
    (period) =>
      chargeGenerationStart(period) <= today &&
      today <= period.periodEnd &&
      isPeriodBillable(sub, period),
  );
}

/**
 * Próximo vencimento previsto a partir de hoje (inclusive) que ainda não tem mensalidade gerada,
 * ou nulo se não haverá (assinatura terminando). Considera até um ano à frente.
 */
export function projectedDueDate(
  sub: BillableSubscription,
  billingDay: number,
  today: string,
  generatedPeriodStarts: ReadonlySet<string>,
): string | null {
  for (let n = 0; n <= 12; n++) {
    const period = chargePeriod(monthStart(today, n), billingDay);
    if (sub.endsOn && period.periodStart > sub.endsOn) return null;
    if (period.dueDate < today || generatedPeriodStarts.has(period.periodStart)) continue;
    if (isPeriodBillable(sub, period)) return period.dueDate;
  }
  return null;
}

/**
 * Status da mensalidade pelo que foi pago: quitada → `PAID`; em aberto depois do vencimento →
 * `OVERDUE`. `WAIVED` (dispensada) nunca é recalculada.
 */
export function subscriptionChargeStatus(
  charge: { amountCents: number; dueDate: string },
  paidCents: number,
  today: string,
): 'PENDING' | 'PAID' | 'OVERDUE' {
  if (paidCents >= charge.amountCents) return 'PAID';
  return charge.dueDate < today ? 'OVERDUE' : 'PENDING';
}

/**
 * RN-CLASS-06: atrasada há mais de `days` dias (com a regra ligada) → a assinatura fica
 * `PAST_DUE` e o aluno não confirma presença até regularizar.
 */
export function isPastDue(
  oldestOpenDueDate: string | null,
  today: string,
  rule: { enabled: boolean; days: number },
): boolean {
  return (
    rule.enabled && oldestOpenDueDate !== null && daysBetween(oldestOpenDueDate, today) > rule.days
  );
}

/**
 * RN-CLASS-08 (decisão 45): até quando vai o acesso de quem cancela hoje: o fim do último mês com
 * mensalidade `PAID` ou `WAIVED`, se esse mês é o corrente ou um futuro. Nulo = termina no ato.
 */
export function cancellationAccessUntil(
  charges: readonly { periodEnd: string; status: ChargeStatus }[],
  today: string,
): string | null {
  const covered = charges
    .filter((charge) => charge.status === 'PAID' || charge.status === 'WAIVED')
    .map((charge) => charge.periodEnd)
    .sort();
  const last = covered.at(-1);
  return last && last >= today ? last : null;
}

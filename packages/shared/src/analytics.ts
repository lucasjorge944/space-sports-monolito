import { z } from 'zod';
import {
  type BookingSource,
  type BookingStatus,
  localDateSchema,
  oneOrMany,
  PERIOD_MAX_DATE,
  PERIOD_MIN_DATE,
  periodDateSchema,
} from './booking';
import type { PaymentChannel } from './online-payments';
import type { PaymentMethod } from './spaces';
import { addDays } from './time';

// Camada de métricas (decisão 124; RF-MCP-08; RN-MCP-09; docs/14-mcp.md seção 8.4). Endpoints
// parametrizados (período, agrupamento e filtros simples), sem SQL livre, com respostas prontas
// para tabela e gráfico: `{ period, groupBy, timezone, columns, rows, totals }`. As definições
// exatas de cada métrica estão na seção 8.4 de docs/14-mcp.md.

/**
 * Unidade de cada coluna: contagem, horas (decimal, ex.: 1.5), razão de 0 a 1 e dinheiro em
 * centavos. Variações (`*Delta`) usam a unidade da métrica e podem ser negativas.
 */
export const ANALYTICS_UNITS = ['COUNT', 'HOURS', 'RATIO', 'BRL_CENTS'] as const;
export const analyticsUnitSchema = z.enum(ANALYTICS_UNITS);
export type AnalyticsUnit = z.infer<typeof analyticsUnitSchema>;

/** Período máximo de uma consulta (datas locais, inclusive). */
export const ANALYTICS_MAX_RANGE_DAYS = 366;
/**
 * Datas aceitas em `from` e `to` (inclusive; BUG-MCP2-2): as de todo filtro de período
 * (`periodDateSchema`); fora disso, 400 `VALIDATION_ERROR`.
 */
export const ANALYTICS_MIN_DATE = PERIOD_MIN_DATE;
export const ANALYTICS_MAX_DATE = PERIOD_MAX_DATE;
/** Período padrão: os últimos 30 dias, até hoje (inclusive). */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 86_400_000;

/** Dias de `from` a `to`, inclusive (datas `YYYY-MM-DD`). */
export function analyticsDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export type AnalyticsPeriodProblem = 'PERIOD_INVERTED' | 'PERIOD_TOO_LONG';

/**
 * Período pedido com os padrões: `to` = hoje (fuso do espaço) e `from` = `to` − 29 dias. Devolve
 * o problema quando `to` fica antes de `from` ou o período passa de 366 dias.
 */
export function resolveAnalyticsPeriod(
  query: { from?: string | undefined; to?: string | undefined },
  today: string,
): { from: string; to: string } | { problem: AnalyticsPeriodProblem } {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  if (to < from) return { problem: 'PERIOD_INVERTED' };
  if (analyticsDays(from, to) > ANALYTICS_MAX_RANGE_DAYS) return { problem: 'PERIOD_TOO_LONG' };
  return { from, to };
}

/** Período anterior de mesma duração, imediatamente antes de `from` (comparação entre espaços). */
export function previousAnalyticsPeriod(period: { from: string; to: string }) {
  const days = analyticsDays(period.from, period.to);
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

// ---------------------------------------------------------------------------------------------
// Rótulos (pt-BR) das linhas

export const WEEKDAY_LABELS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'Não compareceu',
};

export const BOOKING_SOURCE_LABELS: Record<BookingSource, string> = {
  APP: 'App',
  DESK: 'Balcão',
  RECURRING: 'Mensalista',
};

/** Canal da criação da reserva (RN-MCP-03). */
export const BOOKING_CHANNELS = ['DIRECT', 'MCP'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];
export const BOOKING_CHANNEL_LABELS: Record<BookingChannel, string> = {
  DIRECT: 'App, site e painel',
  MCP: 'Assistente de IA',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
  OTHER: 'Outra',
};

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  ON_SITE: 'No espaço',
  ONLINE: 'Online pelo app',
};

/**
 * Origem do recebimento: reserva avulsa (e as partes antigas da conta dividida), mensalidade do
 * mensalista (só pagamentos antigos, decisão 27) e mensalidade de aula. Mesma divisão do extrato
 * (`STATEMENT_SERVICE_PAYABLE_TYPES`). Não há aula avulsa paga no modelo de dados.
 */
export const REVENUE_ORIGINS = ['RENTAL', 'RECURRING', 'CLASS'] as const;
export type RevenueOrigin = (typeof REVENUE_ORIGINS)[number];
export const REVENUE_ORIGIN_LABELS: Record<RevenueOrigin, string> = {
  RENTAL: 'Reservas',
  RECURRING: 'Mensalistas (pagamentos antigos)',
  CLASS: 'Mensalidades de aula',
};

// ---------------------------------------------------------------------------------------------
// Blocos do contrato

const count = z.number().int().min(0);
const hours = z.number().min(0);
const ratio = z.number().min(0).max(1).nullable();
const cents = z.number().int();
const delta = z.number();

export const analyticsColumnSchema = z.object({
  /** Campo das linhas e dos totais. */
  key: z.string(),
  label: z.string(),
  unit: analyticsUnitSchema,
});
export type AnalyticsColumn = z.infer<typeof analyticsColumnSchema>;

export const analyticsPeriodSchema = z.object({ from: localDateSchema, to: localDateSchema });
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;

/**
 * Resposta das métricas: `rows` traz uma linha por grupo (`key` estável, `label` legível) com os
 * campos de `columns`; `totals` traz os mesmos campos para o período e os filtros inteiros (não
 * é sempre a soma das linhas: contagens distintas, razões e linhas que se sobrepõem).
 */
function analyticsResponse<
  G extends readonly [string, ...string[]],
  V extends Record<string, z.ZodType>,
>(groupBy: G, values: V) {
  return z.object({
    period: analyticsPeriodSchema,
    groupBy: z.enum(groupBy),
    /** Fuso das datas locais e dos agrupamentos (America/Sao_Paulo). */
    timezone: z.string(),
    columns: z.array(analyticsColumnSchema),
    rows: z.array(z.object({ key: z.string(), label: z.string(), ...values })),
    totals: z.object(values),
  });
}

const periodFields = {
  /** Data local (YYYY-MM-DD), inclusive, de 2000-01-01 a 2100-12-31. Padrão: `to` − 29 dias. */
  from: periodDateSchema.optional(),
  /** Data local (YYYY-MM-DD), inclusive, de 2000-01-01 a 2100-12-31. Padrão: hoje. */
  to: periodDateSchema.optional(),
};
const toAfterFrom = (v: { from?: string | undefined; to?: string | undefined }) =>
  !v.from || !v.to || v.to >= v.from;
const toAfterFromError = { message: '`to` não pode ser anterior a `from`.', path: ['to'] };

const columns = <K extends string>(
  list: readonly { key: K; label: string; unit: AnalyticsUnit }[],
) => list;

// ---------------------------------------------------------------------------------------------
// Reservas: GET /v1/manage/spaces/:spaceId/analytics/bookings

export const BOOKING_ANALYTICS_GROUP_BY = [
  'day',
  'week',
  'month',
  'weekday',
  'hour',
  'court',
  'sport',
  'source',
  'channel',
  'status',
] as const;
export type BookingAnalyticsGroupBy = (typeof BOOKING_ANALYTICS_GROUP_BY)[number];

export const bookingAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(BOOKING_ANALYTICS_GROUP_BY).default('day'),
    courtId: z.uuid().optional(),
    sportId: z.uuid().optional(),
  })
  .refine(toAfterFrom, toAfterFromError);
export type BookingAnalyticsQuery = z.infer<typeof bookingAnalyticsQuerySchema>;

export const BOOKING_ANALYTICS_COLUMNS = columns([
  { key: 'bookings', label: 'Reservas', unit: 'COUNT' },
  { key: 'hours', label: 'Horas reservadas', unit: 'HOURS' },
  { key: 'noShows', label: 'Não compareceu', unit: 'COUNT' },
  { key: 'cancelled', label: 'Canceladas', unit: 'COUNT' },
  { key: 'cancellationRate', label: 'Taxa de cancelamento', unit: 'RATIO' },
]);

export const bookingAnalyticsSchema = analyticsResponse(BOOKING_ANALYTICS_GROUP_BY, {
  bookings: count,
  hours,
  noShows: count,
  cancelled: count,
  cancellationRate: ratio,
});
export type BookingAnalytics = z.infer<typeof bookingAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Ocupação: GET /v1/manage/spaces/:spaceId/analytics/occupancy

export const OCCUPANCY_ANALYTICS_GROUP_BY = [
  'court',
  'weekday',
  'hour',
  'day',
  'week',
  'month',
] as const;
export type OccupancyAnalyticsGroupBy = (typeof OCCUPANCY_ANALYTICS_GROUP_BY)[number];

const hourOfDay = z.coerce.number().int().min(0).max(24);

export const occupancyAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(OCCUPANCY_ANALYTICS_GROUP_BY).default('court'),
    courtId: z.uuid().optional(),
    /** Dias da semana (0 = domingo … 6 = sábado); um ou vários. */
    weekday: oneOrMany(z.coerce.number().int().min(0).max(6)),
    /** Faixa horária local [hourFrom, hourTo), em horas cheias (ex.: 18 e 23 = 18h às 23h). */
    hourFrom: hourOfDay.optional(),
    hourTo: hourOfDay.optional(),
  })
  .refine(toAfterFrom, toAfterFromError)
  .refine((v) => v.hourFrom === undefined || v.hourTo === undefined || v.hourTo > v.hourFrom, {
    message: '`hourTo` deve ser depois de `hourFrom`.',
    path: ['hourTo'],
  });
export type OccupancyAnalyticsQuery = z.infer<typeof occupancyAnalyticsQuerySchema>;

export const OCCUPANCY_ANALYTICS_COLUMNS = columns([
  { key: 'openHours', label: 'Horas de funcionamento', unit: 'HOURS' },
  { key: 'blockedHours', label: 'Horas bloqueadas', unit: 'HOURS' },
  { key: 'availableHours', label: 'Horas disponíveis', unit: 'HOURS' },
  { key: 'bookedHours', label: 'Horas reservadas', unit: 'HOURS' },
  { key: 'classHours', label: 'Horas de aula', unit: 'HOURS' },
  { key: 'occupancyRate', label: 'Ocupação por reservas', unit: 'RATIO' },
  { key: 'utilizationRate', label: 'Uso total (reservas e aulas)', unit: 'RATIO' },
]);

export const occupancyAnalyticsSchema = analyticsResponse(OCCUPANCY_ANALYTICS_GROUP_BY, {
  openHours: hours,
  blockedHours: hours,
  availableHours: hours,
  bookedHours: hours,
  classHours: hours,
  occupancyRate: ratio,
  utilizationRate: ratio,
});
export type OccupancyAnalytics = z.infer<typeof occupancyAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Aulas: GET /v1/manage/spaces/:spaceId/analytics/classes

export const CLASS_ANALYTICS_GROUP_BY = ['classGroup', 'teacher', 'day', 'week', 'month'] as const;
export type ClassAnalyticsGroupBy = (typeof CLASS_ANALYTICS_GROUP_BY)[number];

export const classAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(CLASS_ANALYTICS_GROUP_BY).default('classGroup'),
    classGroupId: z.uuid().optional(),
    sportId: z.uuid().optional(),
  })
  .refine(toAfterFrom, toAfterFromError);
export type ClassAnalyticsQuery = z.infer<typeof classAnalyticsQuerySchema>;

export const CLASS_ANALYTICS_COLUMNS = columns([
  { key: 'sessionsDone', label: 'Aulas dadas', unit: 'COUNT' },
  { key: 'sessionsCancelled', label: 'Aulas canceladas', unit: 'COUNT' },
  { key: 'present', label: 'Presenças', unit: 'COUNT' },
  { key: 'absent', label: 'Faltas', unit: 'COUNT' },
  { key: 'unmarked', label: 'Sem presença marcada', unit: 'COUNT' },
  { key: 'attendanceRate', label: 'Taxa de presença', unit: 'RATIO' },
  { key: 'activeStudents', label: 'Alunos ativos', unit: 'COUNT' },
]);

export const classAnalyticsSchema = analyticsResponse(CLASS_ANALYTICS_GROUP_BY, {
  sessionsDone: count,
  sessionsCancelled: count,
  present: count,
  absent: count,
  unmarked: count,
  attendanceRate: ratio,
  /** Matrículas ativas hoje; nulo nas linhas por data (não muda com o período). */
  activeStudents: count.nullable(),
});
export type ClassAnalytics = z.infer<typeof classAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Clientes: GET /v1/manage/spaces/:spaceId/analytics/customers

export const CUSTOMER_ANALYTICS_GROUP_BY = ['customer', 'day', 'week', 'month'] as const;
export type CustomerAnalyticsGroupBy = (typeof CUSTOMER_ANALYTICS_GROUP_BY)[number];

export const CUSTOMER_ANALYTICS_DEFAULT_LIMIT = 20;
export const CUSTOMER_ANALYTICS_MAX_LIMIT = 100;

export const customerAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(CUSTOMER_ANALYTICS_GROUP_BY).default('customer'),
    courtId: z.uuid().optional(),
    sportId: z.uuid().optional(),
    /** Só em `groupBy=customer`: quantos clientes, dos que mais reservaram. */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CUSTOMER_ANALYTICS_MAX_LIMIT)
      .default(CUSTOMER_ANALYTICS_DEFAULT_LIMIT),
  })
  .refine(toAfterFrom, toAfterFromError);
export type CustomerAnalyticsQuery = z.infer<typeof customerAnalyticsQuerySchema>;

export const CUSTOMER_ANALYTICS_COLUMNS = columns([
  { key: 'customers', label: 'Clientes', unit: 'COUNT' },
  { key: 'newCustomers', label: 'Novos', unit: 'COUNT' },
  { key: 'returningCustomers', label: 'Recorrentes', unit: 'COUNT' },
  { key: 'recurringCustomers', label: 'Mensalistas', unit: 'COUNT' },
  { key: 'bookings', label: 'Reservas', unit: 'COUNT' },
  { key: 'hours', label: 'Horas reservadas', unit: 'HOURS' },
]);

/** Nome e contagens, nunca contato (decisão 122). */
export const customerAnalyticsSchema = analyticsResponse(CUSTOMER_ANALYTICS_GROUP_BY, {
  customers: count,
  newCustomers: count,
  returningCustomers: count,
  recurringCustomers: count,
  bookings: count,
  hours,
});
export type CustomerAnalytics = z.infer<typeof customerAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Receita: GET /v1/manage/spaces/:spaceId/analytics/revenue (Dono e Admin, decisão 53)

export const REVENUE_ANALYTICS_GROUP_BY = [
  'day',
  'week',
  'month',
  'method',
  'origin',
  'channel',
  'court',
  'sport',
] as const;
export type RevenueAnalyticsGroupBy = (typeof REVENUE_ANALYTICS_GROUP_BY)[number];

export const revenueAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(REVENUE_ANALYTICS_GROUP_BY).default('day'),
    courtId: z.uuid().optional(),
    sportId: z.uuid().optional(),
  })
  .refine(toAfterFrom, toAfterFromError);
export type RevenueAnalyticsQuery = z.infer<typeof revenueAnalyticsQuerySchema>;

export const REVENUE_ANALYTICS_COLUMNS = columns([
  { key: 'receivedCents', label: 'Recebido', unit: 'BRL_CENTS' },
  { key: 'paymentsCount', label: 'Pagamentos', unit: 'COUNT' },
  { key: 'reversedCents', label: 'Estornado', unit: 'BRL_CENTS' },
  { key: 'receivableCents', label: 'A receber', unit: 'BRL_CENTS' },
]);

export const revenueAnalyticsSchema = analyticsResponse(REVENUE_ANALYTICS_GROUP_BY, {
  receivedCents: cents,
  paymentsCount: count,
  reversedCents: cents,
  /** Nulo nas linhas por forma de pagamento e por canal: o que falta receber não tem os dois. */
  receivableCents: cents.nullable(),
});
export type RevenueAnalytics = z.infer<typeof revenueAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Plataforma: GET /v1/super/analytics/platform

export const PLATFORM_ANALYTICS_GROUP_BY = ['day', 'week', 'month'] as const;
export type PlatformAnalyticsGroupBy = (typeof PLATFORM_ANALYTICS_GROUP_BY)[number];

export const platformAnalyticsQuerySchema = z
  .object({ ...periodFields, groupBy: z.enum(PLATFORM_ANALYTICS_GROUP_BY).default('week') })
  .refine(toAfterFrom, toAfterFromError);
export type PlatformAnalyticsQuery = z.infer<typeof platformAnalyticsQuerySchema>;

export const PLATFORM_ANALYTICS_COLUMNS = columns([
  { key: 'bookings', label: 'Reservas', unit: 'COUNT' },
  { key: 'bookedHours', label: 'Horas reservadas', unit: 'HOURS' },
  { key: 'newUsers', label: 'Usuários novos', unit: 'COUNT' },
  { key: 'newSpaces', label: 'Espaços novos', unit: 'COUNT' },
  { key: 'activeSpaces', label: 'Espaços com movimento', unit: 'COUNT' },
  { key: 'onlinePayments', label: 'Pagamentos online', unit: 'COUNT' },
  { key: 'onlineVolumeCents', label: 'Volume online', unit: 'BRL_CENTS' },
  { key: 'platformRevenueCents', label: 'Receita da plataforma', unit: 'BRL_CENTS' },
]);

export const platformAnalyticsSchema = analyticsResponse(PLATFORM_ANALYTICS_GROUP_BY, {
  bookings: count,
  bookedHours: hours,
  newUsers: count,
  newSpaces: count,
  activeSpaces: count,
  onlinePayments: count,
  onlineVolumeCents: cents,
  platformRevenueCents: cents,
});
export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>;

// ---------------------------------------------------------------------------------------------
// Comparação entre espaços: GET /v1/super/analytics/spaces (RF-SUPER-09)

export const SPACES_ANALYTICS_GROUP_BY = ['space'] as const;

/** Ordem das linhas: por variação (padrão: quem mais caiu em reservas primeiro), valor ou nome. */
export const SPACES_ANALYTICS_SORTS = [
  'bookingsDelta',
  'presencesDelta',
  'receivedDeltaCents',
  'bookings',
  'presences',
  'receivedCents',
  'name',
] as const;
export type SpacesAnalyticsSort = (typeof SPACES_ANALYTICS_SORTS)[number];
export const ANALYTICS_ORDERS = ['asc', 'desc'] as const;
export const SPACES_ANALYTICS_DEFAULT_LIMIT = 50;
export const SPACES_ANALYTICS_MAX_LIMIT = 200;

export const spacesAnalyticsQuerySchema = z
  .object({
    ...periodFields,
    groupBy: z.enum(SPACES_ANALYTICS_GROUP_BY).default('space'),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
    sort: z.enum(SPACES_ANALYTICS_SORTS).default('bookingsDelta'),
    order: z.enum(ANALYTICS_ORDERS).default('asc'),
    /** Quantos espaços, depois de ordenar; os totais valem para todos. */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SPACES_ANALYTICS_MAX_LIMIT)
      .default(SPACES_ANALYTICS_DEFAULT_LIMIT),
  })
  .refine(toAfterFrom, toAfterFromError);
export type SpacesAnalyticsQuery = z.infer<typeof spacesAnalyticsQuerySchema>;

export const SPACES_ANALYTICS_COLUMNS = columns([
  { key: 'bookings', label: 'Reservas', unit: 'COUNT' },
  { key: 'previousBookings', label: 'Reservas (período anterior)', unit: 'COUNT' },
  { key: 'bookingsDelta', label: 'Variação de reservas', unit: 'COUNT' },
  { key: 'presences', label: 'Presenças em aula', unit: 'COUNT' },
  { key: 'previousPresences', label: 'Presenças (período anterior)', unit: 'COUNT' },
  { key: 'presencesDelta', label: 'Variação de presenças', unit: 'COUNT' },
  { key: 'receivedCents', label: 'Recebido', unit: 'BRL_CENTS' },
  { key: 'previousReceivedCents', label: 'Recebido (período anterior)', unit: 'BRL_CENTS' },
  { key: 'receivedDeltaCents', label: 'Variação do recebido', unit: 'BRL_CENTS' },
  { key: 'activeRecurring', label: 'Mensalistas ativos', unit: 'COUNT' },
  { key: 'activeStudents', label: 'Alunos ativos', unit: 'COUNT' },
]);

export const spacesAnalyticsSchema = analyticsResponse(SPACES_ANALYTICS_GROUP_BY, {
  bookings: count,
  previousBookings: count,
  bookingsDelta: delta,
  presences: count,
  previousPresences: count,
  presencesDelta: delta,
  receivedCents: cents,
  previousReceivedCents: cents,
  receivedDeltaCents: cents,
  activeRecurring: count,
  activeStudents: count,
}).extend({
  /** Período comparado: a mesma duração, imediatamente antes de `period.from`. */
  previousPeriod: analyticsPeriodSchema,
  /** Espaços no filtro (as linhas param em `limit`; os totais somam todos). */
  spacesCount: count,
});
export type SpacesAnalytics = z.infer<typeof spacesAnalyticsSchema>;

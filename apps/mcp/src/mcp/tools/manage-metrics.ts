import {
  BOOKING_ANALYTICS_GROUP_BY,
  CLASS_ANALYTICS_GROUP_BY,
  CUSTOMER_ANALYTICS_GROUP_BY,
  OCCUPANCY_ANALYTICS_GROUP_BY,
} from '@space-sports/shared';
import { z } from 'zod';
import type { ApiClient } from '../../api/client.js';
import {
  courtFilterSchema,
  MANAGE_HINTS,
  managedSpaceRefSchema,
  periodFields,
  resolveCourtAndSport,
  resolveManagedSpace,
  spaceOutput,
  sportFilterSchema,
  UUID,
} from '../manage/context.js';
import {
  type AnalyticsResponse,
  METRICS_DESCRIPTION,
  metricsOutputSchema,
  metricsSummary,
  metricsView,
} from '../manage/metrics.js';
import { normalize } from '../space-resolver.js';
import { defineTool, done, type ToolContext } from '../tool.js';
import { ToolError } from '../tool-error.js';

// Métricas da gestão (`manage:read`; docs/14-mcp.md 8.4 e 8.5): repassam os endpoints
// `…/analytics/*` da API, no mesmo formato de colunas e linhas. O papel no espaço vale como no
// painel (decisão 53): quem decide o que sai é a API.

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Resolve o espaço, chama a métrica e monta a saída (espaço + bloco) com o resumo. */
async function runMetrics(
  ctx: ToolContext,
  ref: string | undefined,
  title: string,
  fetch: (spaceId: string) => Promise<AnalyticsResponse>,
) {
  const { space } = await resolveManagedSpace(ctx, ref);
  const block = metricsView(await fetch(space.id));
  return done(metricsSummary(title, space.name, block), {
    space: spaceOutput(space),
    ...block,
  });
}

const groupBy = <T extends readonly [string, ...string[]]>(values: T, description: string) =>
  z.enum(values).optional().describe(description);

const getBookingMetrics = defineTool({
  name: 'get_booking_metrics',
  title: 'Métricas de reservas do espaço',
  scopes: ['manage:read'],
  description: [
    'Reservas de um espaço que o usuário administra (Dono, Admin ou Professor): quantidade, horas reservadas, não comparecimentos, canceladas e taxa de cancelamento, por dia, semana, mês, dia da semana, hora de início, quadra, esporte, origem (app, balcão, mensalista), canal (direto ou assistente de IA) ou status.',
    'Use para "quantas reservas tivemos", tendência de movimento, horários e quadras mais procurados e cancelamentos. Conta as reservas confirmadas, concluídas e com não comparecimento, pela data de início; sem valores (para dinheiro, get_revenue).',
    METRICS_DESCRIPTION,
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    groupBy: groupBy(
      BOOKING_ANALYTICS_GROUP_BY,
      'Agrupamento: day (padrão), week, month, weekday, hour, court, sport, source, channel ou status.',
    ),
    court: courtFilterSchema,
    sport: sportFilterSchema,
  }),
  outputSchema: metricsOutputSchema,
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  run: (input, ctx) =>
    runMetrics(ctx, input.space, 'Reservas', async (spaceId) => {
      const filters = await resolveCourtAndSport(ctx.api, spaceId, input);
      return ctx.api.bookingAnalytics(spaceId, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        ...filters,
      });
    }),
});

const getOccupancy = defineTool({
  name: 'get_occupancy',
  title: 'Ocupação das quadras do espaço',
  scopes: ['manage:read'],
  description: [
    'Ocupação das quadras ativas de um espaço que o usuário administra: horas de funcionamento, bloqueadas, disponíveis, reservadas e de aula, taxa de ocupação por reservas (occupancyRate) e de uso total com as aulas (utilizationRate), por quadra, dia da semana, hora, dia, semana ou mês.',
    'Use para "qual a ocupação da semana", horários ociosos e de pico (groupBy hour, com weekdays e hourFrom/hourTo para recortar, ex.: terças das 18h às 23h) e comparação entre quadras. As horas são repartidas pela hora local em que caem; reserva fora do funcionamento atual não conta.',
    METRICS_DESCRIPTION,
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    groupBy: groupBy(
      OCCUPANCY_ANALYTICS_GROUP_BY,
      'Agrupamento: court (padrão), weekday, hour, day, week ou month.',
    ),
    court: courtFilterSchema,
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .optional()
      .describe('Só estes dias da semana (0 = domingo … 6 = sábado).'),
    hourFrom: z
      .number()
      .int()
      .min(0)
      .max(23)
      .optional()
      .describe('Início da faixa horária local, em hora cheia (ex.: 18).'),
    hourTo: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe('Fim da faixa horária (exclusivo, ex.: 23 = até 23h). Maior que hourFrom.'),
  }),
  outputSchema: metricsOutputSchema,
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  run: (input, ctx) =>
    runMetrics(ctx, input.space, 'Ocupação', async (spaceId) => {
      const { courtId } = await resolveCourtAndSport(ctx.api, spaceId, { court: input.court });
      return ctx.api.occupancyAnalytics(spaceId, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        courtId,
        weekday: input.weekdays,
        hourFrom: input.hourFrom,
        hourTo: input.hourTo,
      });
    }),
});

/** Turma (id ou nome) e esporte (id, slug ou nome) pelas turmas do espaço que o usuário vê. */
async function resolveClassFilters(
  api: ApiClient,
  spaceId: string,
  refs: { classGroup?: string | undefined; sport?: string | undefined },
): Promise<{ classGroupId?: string; sportId?: string }> {
  if (!refs.classGroup && !refs.sport) return {};
  const { items } = await api.listClassGroups(spaceId, {});
  const result: { classGroupId?: string; sportId?: string } = {};
  if (refs.classGroup) {
    const ref = refs.classGroup;
    const key = normalize(ref);
    const matches = UUID.test(ref)
      ? items.filter((group) => group.id.toLowerCase() === ref.toLowerCase())
      : items.filter((group) => normalize(group.name) === key);
    const partial = matches.length
      ? matches
      : items.filter((group) => key && normalize(group.name).includes(key));
    if (partial.length !== 1 || !partial[0]) {
      throw new ToolError(
        partial.length ? 'CLASS_GROUP_AMBIGUOUS' : 'CLASS_GROUP_NOT_FOUND',
        partial.length
          ? `Há mais de uma turma para "${ref}". Pergunte qual e use o id.`
          : `Turma "${ref}" não encontrada entre as turmas que o usuário vê neste espaço.`,
        { options: (partial.length ? partial : items).map(({ id, name }) => ({ id, name })) },
      );
    }
    result.classGroupId = partial[0].id;
  }
  if (refs.sport) {
    const key = normalize(refs.sport);
    const sport = items
      .map((group) => group.sport)
      .find(
        (item) =>
          item.id.toLowerCase() === refs.sport?.toLowerCase() ||
          item.slug === key ||
          normalize(item.name) === key,
      );
    if (!sport) {
      throw new ToolError('SPORT_NOT_OFFERED', `Nenhuma turma de "${refs.sport}" neste espaço.`);
    }
    result.sportId = sport.id;
  }
  return result;
}

const getClassMetrics = defineTool({
  name: 'get_class_metrics',
  title: 'Métricas de aulas e presença do espaço',
  scopes: ['manage:read'],
  description: [
    'Aulas de um espaço que o usuário administra: aulas dadas e canceladas, presenças, faltas, confirmados sem presença marcada, taxa de presença (presenças ÷ presenças + faltas) e alunos ativos hoje, por turma, professor, dia, semana ou mês.',
    'Use para presença e frequência ("como está a presença das minhas turmas"), turmas mais e menos cheias e faltas. O Professor vê só as aulas e turmas em que dá aula (como no painel); Dono e Admin veem todas. Sem valores.',
    METRICS_DESCRIPTION,
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    groupBy: groupBy(
      CLASS_ANALYTICS_GROUP_BY,
      'Agrupamento: classGroup (padrão, por turma), teacher, day, week ou month.',
    ),
    classGroup: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Só uma turma: id ou nome (veja list_class_groups).'),
    sport: sportFilterSchema,
  }),
  outputSchema: metricsOutputSchema,
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  run: (input, ctx) =>
    runMetrics(ctx, input.space, 'Aulas', async (spaceId) => {
      const filters = await resolveClassFilters(ctx.api, spaceId, input);
      return ctx.api.classAnalytics(spaceId, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        ...filters,
      });
    }),
});

const getCustomerMetrics = defineTool({
  name: 'get_customer_metrics',
  title: 'Métricas de clientes do espaço',
  scopes: ['manage:read'],
  description: [
    'Clientes das reservas de um espaço (só para Dono e Admin, como a lista de clientes do painel; o Professor recebe recusa): clientes únicos, novos, recorrentes, mensalistas, reservas e horas, por cliente (os que mais reservaram, com `limit`), dia, semana ou mês.',
    'Use para "quem mais joga aqui", retenção e novos clientes. Os clientes aparecem só pelo nome (o cliente de balcão sem conta tem a chave guest-N); nunca há telefone nem e-mail, e não peça.',
    METRICS_DESCRIPTION,
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    groupBy: groupBy(
      CUSTOMER_ANALYTICS_GROUP_BY,
      'Agrupamento: customer (padrão: ranking por cliente), day, week ou month.',
    ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Em groupBy=customer: quantos clientes (padrão 20, máximo 100).'),
    court: courtFilterSchema,
    sport: sportFilterSchema,
  }),
  outputSchema: metricsOutputSchema,
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  run: (input, ctx) =>
    runMetrics(ctx, input.space, 'Clientes', async (spaceId) => {
      const filters = await resolveCourtAndSport(ctx.api, spaceId, input);
      return ctx.api.customerAnalytics(spaceId, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        limit: input.limit,
        ...filters,
      });
    }),
});

export const manageMetricTools = [
  getBookingMetrics,
  getOccupancy,
  getClassMetrics,
  getCustomerMetrics,
];

export { runMetrics };

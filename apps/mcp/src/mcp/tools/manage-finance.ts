import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  addDays,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  REVENUE_ANALYTICS_GROUP_BY,
  REVENUE_ORIGIN_LABELS,
  STATEMENT_SERVICES,
} from '@space-sports/shared';
import { z } from 'zod';
import { type Money, money } from '../../shared/money.js';
import { fromLocal, localToday, toLocal } from '../../shared/time.js';
import {
  courtFilterSchema,
  MANAGE_HINTS,
  managedSpaceRefSchema,
  periodFields,
  resolveCourtAndSport,
  resolveManagedSpace,
  spaceOutput,
  spaceOutputSchema,
  sportFilterSchema,
} from '../manage/context.js';
import { brDate, METRICS_DESCRIPTION, metricsOutputSchema } from '../manage/metrics.js';
import { defineTool, done } from '../tool.js';
import { runMetrics } from './manage-metrics.js';

// Finanças da gestão (`manage:finance:read` + `manage:read`, que resolve o espaço; docs/14-mcp.md
// 8.2 e 8.5). Só Dono e Admin recebem valores (decisão 53): para o Professor, a API recusa (403
// SPACE_FORBIDDEN), mesmo com o escopo, e a tool repassa a recusa sem reconstruir nada.

const FINANCE = ['manage:read', 'manage:finance:read'] as const;
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const FINANCE_NOTE =
  'Só Dono e Admin do espaço (o Professor nunca vê valores). Valores em centavos, com o texto em BRL.';

const moneySchema = z.object({ cents: z.number(), formatted: z.string() });

const getRevenue = defineTool({
  name: 'get_revenue',
  title: 'Receita do espaço',
  scopes: FINANCE,
  description: [
    `Receita de um espaço: recebido (pagamentos pela data do pagamento, sem os estornados), quantidade de pagamentos, estornado e a receber (saldo em aberto das reservas pela data da reserva e das mensalidades de aula pelo vencimento), por dia, semana, mês, forma de pagamento, origem (reservas, mensalistas antigos, mensalidades de aula), canal (no espaço ou online), quadra ou esporte. ${FINANCE_NOTE}`,
    'Use para faturamento, evolução da receita e "quanto falta receber". Nas linhas por forma de pagamento e por canal, o a receber vem nulo (só o total tem).',
    METRICS_DESCRIPTION,
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    groupBy: z
      .enum(REVENUE_ANALYTICS_GROUP_BY)
      .optional()
      .describe('Agrupamento: day (padrão), week, month, method, origin, channel, court ou sport.'),
    court: courtFilterSchema,
    sport: sportFilterSchema,
  }),
  outputSchema: metricsOutputSchema,
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  run: (input, ctx) =>
    runMetrics(ctx, input.space, 'Receita', async (spaceId) => {
      const filters = await resolveCourtAndSport(ctx.api, spaceId, input);
      return ctx.api.revenueAnalytics(spaceId, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        ...filters,
      });
    }),
});

const SERVICE_LABELS: Record<string, string> = {
  RENTAL: REVENUE_ORIGIN_LABELS.RENTAL,
  RECURRING: REVENUE_ORIGIN_LABELS.RECURRING,
  CLASS: REVENUE_ORIGIN_LABELS.CLASS,
};
const methodLabel = (method: string) =>
  PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method;
const channelLabel = (channel: string) =>
  PAYMENT_CHANNEL_LABELS[channel as keyof typeof PAYMENT_CHANNEL_LABELS] ?? channel;

const statementFigure = z.object({ received: moneySchema, paymentsCount: z.number() });

const getStatement = defineTool({
  name: 'get_statement',
  title: 'Extrato de recebimentos do espaço',
  scopes: FINANCE,
  description: [
    `Extrato de recebimentos de um espaço: cada pagamento (data e hora, valor, forma, canal no espaço ou online, serviço, nome de quem pagou, quadra ou plano) e os totais do período por forma e por canal. ${FINANCE_NOTE}`,
    'Use para conferir pagamentos e montar a tabela do caixa. Os totais valem para o período e os filtros inteiros (sem os estornados, que vêm em `totals.reversed`); os itens vêm do mais recente para o mais antigo, em páginas (`nextCursor`). Período padrão: os últimos 30 dias até hoje (datas locais do espaço). Não invente pagamentos nem valores ausentes.',
  ].join(' '),
  inputSchema: z.object({
    space: managedSpaceRefSchema,
    ...periodFields,
    method: z.enum(PAYMENT_METHODS).optional().describe('Só uma forma: PIX, CARD, CASH ou OTHER.'),
    service: z
      .enum(STATEMENT_SERVICES)
      .optional()
      .describe('Só um serviço: RENTAL (reservas), RECURRING (mensalistas) ou CLASS (aulas).'),
    channel: z
      .enum(PAYMENT_CHANNELS)
      .optional()
      .describe('Só um canal: ON_SITE (no espaço) ou ONLINE (pelo app).'),
    limit: z.number().int().min(1).max(100).optional().describe('Itens por página (padrão 20).'),
    cursor: z.string().min(1).max(500).optional().describe('`nextCursor` da página anterior.'),
  }),
  outputSchema: z.object({
    space: spaceOutputSchema,
    period: z.object({ from: z.string(), to: z.string() }),
    totals: statementFigure.extend({ reversed: moneySchema }),
    byMethod: z.array(statementFigure.extend({ method: z.string(), methodLabel: z.string() })),
    byChannel: z.array(statementFigure.extend({ channel: z.string(), channelLabel: z.string() })),
    payments: z.array(
      z.object({
        id: z.string(),
        date: z.string(),
        time: z.string(),
        amount: moneySchema,
        method: z.string(),
        methodLabel: z.string(),
        channel: z.string(),
        channelLabel: z.string(),
        service: z.string(),
        serviceLabel: z.string(),
        payerName: z.string().nullable(),
        reversed: z.boolean(),
        bookingDate: z.string().nullable(),
        courtName: z.string().nullable(),
        planName: z.string().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  async run(input, ctx) {
    const { api, now } = ctx;
    const { space } = await resolveManagedSpace(ctx, input.space);
    const tz = space.timeZone;
    const to = input.to ?? localToday(now(), tz);
    const from = input.from ?? addDays(to, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
    // O extrato filtra `paid_at` em UTC, meio-aberto: [início do dia `from`, início do dia seguinte a `to`).
    const statement = await api.statement(space.id, {
      from: fromLocal(from, '00:00', tz).toISOString(),
      to: fromLocal(addDays(to, 1), '00:00', tz).toISOString(),
      method: input.method,
      service: input.service,
      channel: input.channel,
      limit: input.limit,
      cursor: input.cursor,
    });
    const figure = (item: { receivedCents: number; paymentsCount: number }) => ({
      received: money(item.receivedCents),
      paymentsCount: item.paymentsCount,
    });
    const payments = statement.items.map((item) => {
      const paid = toLocal(item.paidAt, tz);
      return {
        id: item.id,
        date: paid.date,
        time: paid.time,
        amount: money(item.amountCents),
        method: item.method,
        methodLabel: methodLabel(item.method),
        channel: item.channel,
        channelLabel: channelLabel(item.channel),
        service: item.service,
        serviceLabel: SERVICE_LABELS[item.service] ?? item.service,
        payerName: item.payerName ?? null,
        reversed: item.reversedAt !== null && item.reversedAt !== undefined,
        bookingDate: item.bookingStartsAt ? toLocal(item.bookingStartsAt, tz).date : null,
        courtName: item.courtName ?? null,
        planName: item.planName ?? null,
      };
    });
    const totals = { ...figure(statement.totals), reversed: money(statement.totals.reversedCents) };
    return done(
      `Extrato de ${space.name}, ${brDate(from)} a ${brDate(to)}: ${totals.received.formatted} recebidos em ${totals.paymentsCount} pagamento(s)${totals.reversed.cents ? `, ${totals.reversed.formatted} estornados` : ''}. ${payments.length} item(ns) nesta página.`,
      {
        space: spaceOutput(space),
        period: { from, to },
        totals,
        byMethod: statement.byMethod.map((item) => ({
          ...figure(item),
          method: item.method,
          methodLabel: methodLabel(item.method),
        })),
        byChannel: statement.byChannel.map((item) => ({
          ...figure(item),
          channel: item.channel,
          channelLabel: channelLabel(item.channel),
        })),
        payments,
        nextCursor: statement.nextCursor ?? null,
      },
    );
  },
});

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: 'aguardando aprovação',
  ACTIVE: 'ativa',
  PAST_DUE: 'em atraso',
  CANCELLED: 'cancelada',
};

const listDelinquents = defineTool({
  name: 'list_delinquents',
  title: 'Inadimplência das aulas do espaço',
  scopes: FINANCE,
  description: [
    `Alunos com mensalidade de aula vencida e em aberto num espaço, do atraso mais antigo para o mais novo: nome do aluno, plano, quantas mensalidades vencidas, valor em atraso, vencimento mais antigo e dias de atraso, mais o total em atraso. ${FINANCE_NOTE}`,
    'Use para "quem está devendo". Os alunos aparecem só pelo nome; nunca há telefone nem e-mail, e não peça. Dados prontos para tabela; não invente valores.',
  ].join(' '),
  inputSchema: z.object({ space: managedSpaceRefSchema }),
  outputSchema: z.object({
    space: spaceOutputSchema,
    date: z.string(),
    totalOverdue: moneySchema,
    delinquents: z.array(
      z.object({
        studentName: z.string(),
        plan: z.string(),
        overdueCount: z.number(),
        overdue: moneySchema,
        oldestDueDate: z.string(),
        daysOverdue: z.number(),
        subscriptionStatus: z.string(),
        subscriptionStatusLabel: z.string(),
      }),
    ),
  }),
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  async run(input, ctx) {
    const { api } = ctx;
    const { space } = await resolveManagedSpace(ctx, input.space);
    const result = await api.delinquents(space.id);
    const delinquents = result.items.map((item) => ({
      studentName: item.student.name,
      plan: item.plan.name,
      overdueCount: item.overdueCount,
      overdue: money(item.overdueCents),
      oldestDueDate: item.oldestDueDate,
      daysOverdue: item.daysOverdue,
      subscriptionStatus: item.subscriptionStatus,
      subscriptionStatusLabel:
        SUBSCRIPTION_STATUS_LABELS[item.subscriptionStatus] ?? item.subscriptionStatus,
    }));
    const total = money(result.totalOverdueCents);
    return done(
      delinquents.length
        ? `${delinquents.length} aluno(s) com mensalidade vencida em ${space.name}, ${total.formatted} em atraso.`
        : `Nenhuma mensalidade de aula vencida em aberto em ${space.name}.`,
      { space: spaceOutput(space), date: result.date, totalOverdue: total, delinquents },
    );
  },
});

const MERCHANT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'cadastro no gateway não iniciado',
  PENDING: 'cadastro em análise',
  APPROVED: 'cadastro aprovado',
  REJECTED: 'cadastro recusado',
};

const getOnlinePaymentsSummary = defineTool({
  name: 'get_online_payments_summary',
  title: 'Pagamentos online do espaço',
  scopes: FINANCE,
  description: [
    `Pagamentos online (pelo app) de um espaço: situação da conta no gateway, saldo da carteira (disponível, a liberar, total e já repassado), o que libera nos próximos dias, contestações aguardando resposta, repasses que falharam e, no período, o recebido online e no espaço. ${FINANCE_NOTE}`,
    'Use para "quanto tenho a receber do app" e o peso do online no faturamento. Período padrão: os últimos 30 dias até hoje. Dados prontos para KPI, tabela ou gráfico; não invente valores ausentes.',
  ].join(' '),
  inputSchema: z.object({ space: managedSpaceRefSchema, ...periodFields }),
  outputSchema: z.object({
    space: spaceOutputSchema,
    account: z.object({ status: z.string(), statusLabel: z.string(), payoutsPaused: z.boolean() }),
    wallet: z.object({
      available: moneySchema,
      pending: moneySchema,
      balance: moneySchema,
      paidOut: moneySchema,
      upcoming: z.array(z.object({ date: z.string(), amount: moneySchema })),
    }),
    openDisputes: z.object({ count: z.number(), nextRespondBy: z.string().nullable() }),
    failedPayouts: z.object({
      count: z.number(),
      lastAmount: moneySchema.nullable(),
      lastAt: z.string().nullable(),
    }),
    period: z.object({ from: z.string(), to: z.string() }),
    received: z.object({
      online: moneySchema,
      onSite: moneySchema,
      total: moneySchema,
    }),
  }),
  hints: MANAGE_HINTS,
  annotations: READ_ONLY,
  async run(input, ctx) {
    const { api } = ctx;
    const { space } = await resolveManagedSpace(ctx, input.space);
    const tz = space.timeZone;
    const [wallet, revenue] = await Promise.all([
      api.walletSummary(space.id),
      api.revenueAnalytics(space.id, { from: input.from, to: input.to, groupBy: 'channel' }),
    ]);
    const receivedOf = (key: string): number =>
      revenue.rows.find((row) => row.key === key)?.receivedCents ?? 0;
    const received = {
      online: money(receivedOf('ONLINE')),
      onSite: money(receivedOf('ON_SITE')),
      total: money(revenue.totals.receivedCents),
    };
    const localDateTime = (instant: string | null) => {
      if (!instant) return null;
      const local = toLocal(instant, tz);
      return `${local.date} ${local.time}`;
    };
    const walletView = {
      available: money(wallet.availableCents),
      pending: money(wallet.pendingCents),
      balance: money(wallet.balanceCents),
      paidOut: money(wallet.paidOutCents),
      upcoming: wallet.upcoming.map((item) => ({
        date: item.date,
        amount: money(item.amountCents),
      })),
    };
    const lastAmount: Money | null =
      wallet.failedPayouts.lastAmountCents === null
        ? null
        : money(wallet.failedPayouts.lastAmountCents);
    return done(
      `Pagamentos online de ${space.name}: ${walletView.available.formatted} disponível e ${walletView.pending.formatted} a liberar; recebido online no período ${received.online.formatted} de ${received.total.formatted}.`,
      {
        space: spaceOutput(space),
        account: {
          status: wallet.merchantAccountStatus,
          statusLabel:
            MERCHANT_STATUS_LABELS[wallet.merchantAccountStatus] ?? wallet.merchantAccountStatus,
          payoutsPaused: wallet.payoutsPaused,
        },
        wallet: walletView,
        openDisputes: {
          count: wallet.openDisputes.count,
          nextRespondBy: localDateTime(wallet.openDisputes.nextRespondBy),
        },
        failedPayouts: {
          count: wallet.failedPayouts.count,
          lastAmount,
          lastAt: localDateTime(wallet.failedPayouts.lastAt),
        },
        period: { from: revenue.period.from, to: revenue.period.to },
        received,
      },
    );
  },
});

export const manageFinanceTools = [
  getRevenue,
  getStatement,
  listDelinquents,
  getOnlinePaymentsSummary,
];

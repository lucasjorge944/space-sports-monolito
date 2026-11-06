import type {
  ClassGroup,
  DelinquentsResponse,
  SpaceSubscriptionChargePageItemsItem,
  SubscriptionCharge,
  SubscriptionDetail,
  SubscriptionDetailStatus,
} from '@space-sports/api-client';
import { addDays, zonedToUtc } from '@space-sports/shared';
import {
  DISPLAY_TIME_ZONE,
  formatCsvMoney,
  formatLocalDate,
  formatMoney,
  startOfMonthLocal,
  todayLocal,
} from '@/lib/format';
import { teacherNames } from './aulas';
import { WEEKDAY_SHORT } from './labels';

type WithEnrollments<E> = { enrollments: E[] };
type EnrollmentLike = { status: 'PENDING' | 'ACTIVE' | 'ENDED' };

/** Assinatura (item da lista ou detalhe): só o que as regras abaixo leem. */
type SubscriptionLike = WithEnrollments<EnrollmentLike> & {
  status: SubscriptionDetailStatus;
  plan: { weeklyFrequency: number | null };
};

/** Filtros da lista de alunos: o primeiro grupo é o que a gestão abre primeiro. */
export const SUBSCRIPTION_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PENDING_APPROVAL', label: 'Aguardando aprovação' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'PAST_DUE', label: 'Inadimplentes' },
  { value: 'CANCELLED', label: 'Canceladas' },
];

/** Mensalidade `2026-10-01` → `10/2026`. */
export function chargeMonth(periodStart: string): string {
  const [y, m] = periodStart.split('-');
  return `${m}/${y}`;
}

/** Mensalidade aceita pagamento ou dispensa: em aberto (a vencer ou vencida). */
export function isChargeOpen(status: SubscriptionCharge['status']): boolean {
  return status === 'PENDING' || status === 'OVERDUE';
}

/** Dá para registrar pagamento: em aberto e com valor a receber. */
export function canReceiveCharge(charge: Pick<SubscriptionCharge, 'status' | 'dueCents'>): boolean {
  return isChargeOpen(charge.status) && charge.dueCents > 0;
}

/**
 * Dá para dispensar: em aberto e sem pagamento registrado (a API recusa com `CHARGE_HAS_PAYMENTS`;
 * esconder o botão evita o erro, mas a regra de verdade é da API).
 */
export function canWaiveCharge(charge: Pick<SubscriptionCharge, 'status' | 'paidCents'>): boolean {
  return isChargeOpen(charge.status) && charge.paidCents === 0;
}

/** Matrículas que ocupam vaga hoje. */
export function activeEnrollments<E extends EnrollmentLike>(subscription: WithEnrollments<E>): E[] {
  return subscription.enrollments.filter((e) => e.status === 'ACTIVE');
}

/** Matrículas pedidas e ainda não aprovadas (não ocupam vaga). */
export function pendingEnrollments<E extends EnrollmentLike>(
  subscription: WithEnrollments<E>,
): E[] {
  return subscription.enrollments.filter((e) => e.status === 'PENDING');
}

/** Assinatura que ainda pode mudar de turma (RN-CLASS-01): em curso, não cancelada nem pendente. */
export function canEditEnrollments(status: SubscriptionDetailStatus): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE';
}

type CancellationLike = Pick<SubscriptionDetail, 'status' | 'cancelAtPeriodEnd' | 'accessUntil'>;

/** Dá para cancelar a assinatura: em curso e ainda sem cancelamento pedido (decisão 45). */
export function canCancelSubscription(
  subscription: Pick<SubscriptionDetail, 'status' | 'cancelAtPeriodEnd'>,
): boolean {
  return canEditEnrollments(subscription.status) && !subscription.cancelAtPeriodEnd;
}

/** Dá para desfazer o cancelamento: pedido, com o acesso ainda valendo (a API confere de novo). */
export function canResumeCancel(subscription: CancellationLike, today: string): boolean {
  return (
    canEditEnrollments(subscription.status) &&
    subscription.cancelAtPeriodEnd &&
    !!subscription.accessUntil &&
    subscription.accessUntil >= today
  );
}

/** `Cancelado, com acesso até 30/11/2026` enquanto o acesso segue depois do cancelamento. */
export function cancelledAccessLabel(subscription: CancellationLike): string | null {
  if (!canEditEnrollments(subscription.status) || !subscription.cancelAtPeriodEnd) return null;
  return subscription.accessUntil
    ? `Cancelado, com acesso até ${formatLocalDate(subscription.accessUntil)}`
    : null;
}

/**
 * O que acontece ao confirmar o cancelamento (RN-CLASS-08, decisão 45); `accessUntilIfCancelled`
 * nulo = o acesso termina agora. A mensalidade do mês sem pagamento é dispensada, a parcial fica em
 * aberto com o espaço e a vencida continua devida.
 */
export function cancelEffect(
  studentName: string,
  subscription: Pick<SubscriptionDetail, 'accessUntilIfCancelled' | 'charges' | 'overdueCents'>,
  now: Date = new Date(),
): string {
  const { accessUntilIfCancelled: until, charges, overdueCents } = subscription;
  if (until) {
    return `${studentName} continua com acesso até ${formatLocalDate(until)}: mantém as turmas e confirma presença até esse dia, e nada mais é cobrado depois.`;
  }
  const periodStart = startOfMonthLocal(now);
  const current = charges.find(
    (charge) => charge.status === 'PENDING' && charge.periodStart === periodStart,
  );
  const parts = [
    `O acesso de ${studentName} termina agora, porque não há mês pago em andamento: as turmas acabam hoje.`,
  ];
  if (current) {
    parts.push(
      current.paidCents > 0
        ? 'A mensalidade deste mês já tem pagamento parcial e fica em aberto com o espaço.'
        : 'A mensalidade deste mês é dispensada.',
    );
  }
  if (overdueCents > 0) {
    parts.push(`A mensalidade em atraso (${formatMoney(overdueCents)}) continua devida.`);
  }
  return parts.join(' ');
}

/** Motivo da dispensa (o cancelamento grava o dele); `null` nas mensalidades não dispensadas. */
export function waiveNote(
  charge: Pick<SpaceSubscriptionChargePageItemsItem, 'status' | 'waiveReason'>,
): string | null {
  return charge.status === 'WAIVED' && charge.waiveReason ? `Motivo: ${charge.waiveReason}` : null;
}

/** Dá para matricular em mais uma turma: Nx/semana limita as ativas a N; ilimitado não limita. */
export function canAddEnrollment(subscription: SubscriptionLike): boolean {
  if (!canEditEnrollments(subscription.status)) return false;
  const limit = subscription.plan.weeklyFrequency;
  return limit === null || activeEnrollments(subscription).length < limit;
}

/** "2 turmas" / "1 turma" / "turmas a escolher" para o texto da regra do plano. */
export function classCountRule(weeklyFrequency: number | null): string {
  if (weeklyFrequency === null) return 'uma ou mais turmas';
  return weeklyFrequency === 1 ? 'exatamente 1 turma' : `exatamente ${weeklyFrequency} turmas`;
}

/** A escolha de turmas na aprovação respeita o plano (a API valida de novo, RN-CLASS-01). */
export function isClassSelectionValid(weeklyFrequency: number | null, selected: number): boolean {
  if (selected < 1) return false;
  return weeklyFrequency === null ? true : selected === weeklyFrequency;
}

/** Turmas ativas do esporte do plano (as únicas que a API aceita para o plano). */
export function eligibleClassGroups(groups: ClassGroup[], sportId: string): ClassGroup[] {
  return groups.filter((g) => g.active && g.sport.id === sportId);
}

/**
 * Turmas pedidas que a API não aceitaria hoje (desativada ou de outro esporte): ficam fora das
 * opções, então a aprovação precisa mostrá-las para a gestão poder tirá-las.
 */
export function unavailableRequested<T extends { id: string }>(
  requested: readonly T[],
  options: readonly { id: string }[],
): T[] {
  const available = new Set(options.map((o) => o.id));
  return requested.filter((r) => !available.has(r.id));
}

/** Mesmas turmas, na mesma ordem de escolha? (não manda `classGroupIds` se nada mudou) */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** Dia da semana + horário da turma: `Ter 19:00`. */
export function classSlotShort(g: { weekday: number; startTime: string }): string {
  return `${WEEKDAY_SHORT[g.weekday]} ${g.startTime}`;
}

/** Data do pagamento escolhida (`YYYY-MM-DD`) → `paidAt` da API; hoje (ou vazio) = agora, no servidor. */
export function paidAtFromDate(date: string, now: Date = new Date()): string | undefined {
  if (!date || date >= todayLocal(now)) return undefined;
  // Meio-dia local: a data cai no dia certo em qualquer fuso do espaço.
  return zonedToUtc(date, 12 * 60, DISPLAY_TIME_ZONE).toISOString();
}

/** A data do pagamento não pode ser futura. */
export function isFutureDate(date: string, now: Date = new Date()): boolean {
  return date > todayLocal(now);
}

/** `0.8571` → `86%`; sem aulas marcadas → `—`. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** Período padrão dos relatórios: do dia 1º do mês corrente até hoje. */
export function defaultMonthRange(now: Date = new Date()): { from: string; to: string } {
  const today = todayLocal(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Últimos `days` dias, hoje incluído (frequência e histórico). */
export function lastDaysRange(days: number, now: Date = new Date()) {
  const today = todayLocal(now);
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Linhas do CSV das mensalidades (valores em reais; o arquivo é para planilha). */
export function chargesCsvRows(
  items: readonly SpaceSubscriptionChargePageItemsItem[],
  statusLabel: (s: SpaceSubscriptionChargePageItemsItem['status']) => string,
): { header: string[]; rows: (string | number)[][] } {
  return {
    header: [
      'Aluno',
      'Plano',
      'Mês',
      'Vencimento',
      'Valor (R$)',
      'Pago (R$)',
      'Em aberto (R$)',
      'Situação',
    ],
    rows: items.map((c) => [
      c.student.name,
      c.plan.name,
      chargeMonth(c.periodStart),
      formatLocalDate(c.dueDate),
      formatCsvMoney(c.amountCents),
      formatCsvMoney(c.paidCents),
      formatCsvMoney(c.dueCents),
      statusLabel(c.status),
    ]),
  };
}

/** Linhas do CSV de inadimplentes. */
export function delinquentsCsvRows(items: DelinquentsResponse['items']) {
  return {
    header: [
      'Aluno',
      'Plano',
      'Mensalidades vencidas',
      'Valor vencido (R$)',
      'Vencida desde',
      'Dias de atraso',
    ],
    rows: items.map((d) => [
      d.student.name,
      d.plan.name,
      d.overdueCount,
      formatCsvMoney(d.overdueCents),
      formatLocalDate(d.oldestDueDate),
      d.daysOverdue,
    ]),
  };
}

/** Linhas do CSV de frequência de uma turma. */
export function frequencyCsvRows(
  students: readonly {
    name: string;
    enrolled: boolean;
    present: number;
    absent: number;
    unmarked: number;
    attendanceRate: number | null;
  }[],
) {
  return {
    header: ['Aluno', 'Matriculado', 'Presenças', 'Faltas', 'Sem marcação', 'Frequência'],
    rows: students.map((s) => [
      s.name,
      s.enrolled ? 'Sim' : 'Não',
      s.present,
      s.absent,
      s.unmarked,
      formatRate(s.attendanceRate),
    ]),
  };
}

/** Linhas do CSV de ocupação das turmas. */
export function occupancyCsvRows(groups: readonly ClassGroup[]) {
  return {
    header: [
      'Turma',
      'Esporte',
      'Professores',
      'Dia',
      'Horário',
      'Capacidade',
      'Matriculados',
      'Vagas',
      'Ocupação',
      'Situação',
    ],
    rows: groups.map((g) => [
      g.name,
      g.sport.name,
      teacherNames(g.teachers),
      WEEKDAY_SHORT[g.weekday] ?? '',
      g.startTime,
      g.capacity,
      g.enrolledCount,
      g.availableSpots,
      formatRate(occupancyRate(g)),
      g.active ? 'Ativa' : 'Inativa',
    ]),
  };
}

/** Matriculados / capacidade (0–1); turma sem capacidade → nulo. */
export function occupancyRate(g: Pick<ClassGroup, 'enrolledCount' | 'capacity'>): number | null {
  return g.capacity > 0 ? Math.min(1, g.enrolledCount / g.capacity) : null;
}

/** Soma de ocupação do conjunto de turmas ativas (para o resumo do topo). */
export function occupancyTotals(groups: readonly ClassGroup[]) {
  const active = groups.filter((g) => g.active);
  const capacity = active.reduce((sum, g) => sum + g.capacity, 0);
  const enrolled = active.reduce((sum, g) => sum + g.enrolledCount, 0);
  return {
    groups: active.length,
    capacity,
    enrolled,
    spots: Math.max(0, capacity - enrolled),
    rate: capacity > 0 ? Math.min(1, enrolled / capacity) : null,
    full: active.filter((g) => g.availableSpots === 0).length,
  };
}

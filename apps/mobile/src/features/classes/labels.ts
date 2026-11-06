import type {
  StaffSpacesResponseItemsItemTodayClassSessionsItemAttendeesItemStatus as AttendeeStatus,
  ClassSessionStatus,
  MyClassSessionDetailBlockedReason,
  PaymentMethod,
  SubscriptionChargeStatus,
  SubscriptionDetailNextChargeStatus,
  SubscriptionDetailStatus,
} from '@space-sports/api-client';
import { WEEKDAY_SHORT } from '@/lib/datetime';

type Variant = 'default' | 'secondary' | 'muted' | 'success' | 'warning' | 'destructive';
type Label = { label: string; variant: Variant };

/** Estado da lista de presença de uma aula (RN-CLASS-04), na linguagem de quem vai à aula. */
export const SESSION_STATUS_LABELS: Record<ClassSessionStatus, Label & { hint: string }> = {
  SCHEDULED: {
    label: 'Lista fechada',
    variant: 'muted',
    hint: 'A lista ainda não abriu. Avisamos quando abrir.',
  },
  OPEN: { label: 'Lista aberta', variant: 'success', hint: 'Você já pode confirmar presença.' },
  CLOSED: {
    label: 'Lista encerrada',
    variant: 'muted',
    hint: 'A lista foi encerrada para esta aula.',
  },
  DONE: { label: 'Encerrada', variant: 'muted', hint: 'Esta aula já aconteceu.' },
  CANCELLED: { label: 'Cancelada', variant: 'destructive', hint: 'Esta aula foi cancelada.' },
};

export const SUBSCRIPTION_STATUS_LABELS: Record<
  SubscriptionDetailStatus,
  Label & { hint: string }
> = {
  PENDING_APPROVAL: {
    label: 'Aguardando aprovação',
    variant: 'warning',
    hint: 'O espaço vai analisar o seu pedido. Avisamos quando houver resposta.',
  },
  ACTIVE: { label: 'Ativo', variant: 'success', hint: 'Seu plano está em dia.' },
  PAST_DUE: {
    label: 'Em atraso',
    variant: 'destructive',
    hint: 'Há mensalidade em atraso. Regularize com o espaço para voltar a confirmar presença.',
  },
  CANCELLED: { label: 'Cancelado', variant: 'muted', hint: 'Este plano foi encerrado.' },
};

export const CHARGE_STATUS_LABELS: Record<SubscriptionChargeStatus, Label> = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  PAID: { label: 'Paga', variant: 'success' },
  OVERDUE: { label: 'Em atraso', variant: 'destructive' },
  WAIVED: { label: 'Dispensada', variant: 'muted' },
};

export const NEXT_CHARGE_STATUS_LABELS: Record<SubscriptionDetailNextChargeStatus, Label> = {
  PROJECTED: { label: 'Prevista', variant: 'muted' },
  PENDING: CHARGE_STATUS_LABELS.PENDING,
  OVERDUE: CHARGE_STATUS_LABELS.OVERDUE,
};

export const ATTENDEE_STATUS_LABELS: Record<AttendeeStatus, Label> = {
  CONFIRMED: { label: 'Confirmado', variant: 'success' },
  WAITLIST: { label: 'Na espera', variant: 'warning' },
  CANCELLED: { label: 'Desistiu', variant: 'muted' },
  PRESENT: { label: 'Presente', variant: 'success' },
  ABSENT: { label: 'Faltou', variant: 'destructive' },
};

/** Por que o botão de confirmar não aparece (o `blockedReason` da API). */
export const BLOCKED_REASON_LABELS: Record<
  NonNullable<MyClassSessionDetailBlockedReason>,
  string
> = {
  LIST_NOT_OPEN: 'A lista de presença ainda não está aberta.',
  NOT_ENROLLED: 'Você só confirma presença nas aulas das suas turmas.',
  SUBSCRIPTION_ACCESS_ENDED: 'Esta aula é depois do último dia do seu plano.',
  SUBSCRIPTION_PAST_DUE: 'Há mensalidade em atraso. Regularize com o espaço para confirmar.',
  SCHEDULE_OVERLAP: 'Você já está na lista de outra aula neste mesmo horário.',
};

/** Texto do bloqueio: lista que não abre mais (encerrada, passou, cancelada) segue o status da aula. */
export function blockedReasonText(session: {
  status: ClassSessionStatus;
  blockedReason: MyClassSessionDetailBlockedReason;
}): string | null {
  const { blockedReason, status } = session;
  if (!blockedReason) return null;
  if (blockedReason === 'LIST_NOT_OPEN' && ['CLOSED', 'DONE', 'CANCELLED'].includes(status)) {
    return SESSION_STATUS_LABELS[status].hint;
  }
  return BLOCKED_REASON_LABELS[blockedReason];
}

export const CLASS_LEVEL_LABELS = {
  BEGINNER: 'Iniciante',
  INTERMEDIATE: 'Intermediário',
  ADVANCED: 'Avançado',
  PRO: 'Profissional',
} as const;

export const PAYMENT_PREFERENCE_NONE = 'Sem preferência';

export const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'CARD', 'CASH', 'OTHER'];

/** Plano em aberto: ainda ocupa vaga e aceita ações do aluno. */
export function isOpenSubscription(status: SubscriptionDetailStatus): boolean {
  return status !== 'CANCELLED';
}

/** "1x por semana", "3x por semana" ou "Ilimitado" (decisão 12). */
export function planFrequencyLabel(weeklyFrequency: number | null): string {
  return weeklyFrequency === null ? 'Ilimitado' : `${weeklyFrequency}x por semana`;
}

/** Listas: um professor e "+N" ("Prof. Ana +2"); sem professor, nada (decisão 47). */
export function teachersSummary(teachers: { name: string }[]): string | null {
  const [first, ...others] = teachers;
  if (!first) return null;
  return `Prof. ${first.name}${others.length > 0 ? ` +${others.length}` : ''}`;
}

/** Detalhes: todos os nomes ("Ana, Bruno e Carla"). */
export function teachersFull(teachers: { name: string }[]): string {
  const names = teachers.map((teacher) => teacher.name);
  const last = names.pop();
  if (!last) return '';
  return names.length > 0 ? `${names.join(', ')} e ${last}` : last;
}

/** "Sáb · 07:00 · 1h" sem a duração por extenso: só o dia e o horário da turma. */
export function groupScheduleLabel(group: { weekday: number; startTime: string }): string {
  return `${WEEKDAY_SHORT[group.weekday]} · ${group.startTime.slice(0, 5)}`;
}

import type {
  ClassGroup,
  ClassGroupLevel,
  CreateClassGroupInput,
  CreatePlanInput,
  Plan,
} from '@space-sports/api-client';
import { centsToInput, parseMoneyToCents } from '@space-sports/shared';
import { formatDuration } from '@/lib/format';
import { WEEKDAY_LABEL, WEEKDAY_SHORT } from './labels';

const MIN_PER_DAY = 1440;

/** Limite da API para a lista de professores de uma turma ou aula. */
export const MAX_TEACHERS = 10;

/** `Ana, Bruno`: todos os professores de uma turma ou aula (decisão 47). */
export function teacherNames(teachers: readonly { name: string }[]): string {
  return teachers.map((t) => t.name).join(', ');
}

/** Opções do seletor: os professores do espaço e quem já está na lista, mesmo fora dela. */
export function withCurrentTeachers<T extends { memberId: string; name: string }>(
  options: readonly T[],
  current: readonly T[],
): { memberId: string; name: string }[] {
  const known = new Set(options.map((t) => t.memberId));
  return [...options, ...current.filter((t) => !known.has(t.memberId))];
}

/** Rótulo do campo no singular ou no plural, conforme a lista. */
export function teachersLabel(teachers: readonly unknown[]): string {
  return teachers.length > 1 ? 'Professores' : 'Professor';
}

/** `19:00` + 90 → `20:30` (as aulas ficam dentro do dia; passando da meia-noite volta ao começo). */
export function endTimeLabel(startTime: string, durationMin: number): string {
  const [h = '0', m = '0'] = startTime.split(':');
  const total = (Number(h) * 60 + Number(m) + durationMin) % MIN_PER_DAY;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** `Seg · 19:00–20:00` (horário do espaço, sem conversão de fuso). */
export function formatClassSlot(g: Pick<ClassGroup, 'weekday' | 'startTime' | 'durationMin'>) {
  return `${WEEKDAY_SHORT[g.weekday]} · ${g.startTime}–${endTimeLabel(g.startTime, g.durationMin)}`;
}

/** Horários de início de 30 em 30 min, `00:00` a `23:30`. */
export const START_TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const minutes = i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** Durações de 30 min a 6 h (a API aceita múltiplos de 30 entre 30 e 360). */
export const DURATION_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 12 },
  (_, i) => {
    const minutes = (i + 1) * 30;
    return { value: String(minutes), label: formatDuration(minutes) };
  },
);

export const WEEKDAY_OPTIONS = WEEKDAY_LABEL.map((label, i) => ({ value: String(i), label }));

// --- Turma ------------------------------------------------------------------------------------

/** Campos do formulário de turma como texto (inputs controlados). */
export type ClassGroupDraft = {
  name: string;
  courtId: string;
  sportId: string;
  level: NonNullable<ClassGroupLevel> | '';
  teacherMemberIds: string[];
  weekday: string;
  startTime: string;
  durationMin: string;
  capacity: string;
  active: boolean;
};

export function emptyClassGroupDraft(): ClassGroupDraft {
  return {
    name: '',
    courtId: '',
    sportId: '',
    level: '',
    teacherMemberIds: [],
    weekday: '1',
    startTime: '19:00',
    durationMin: '60',
    capacity: '',
    active: true,
  };
}

export function draftFromClassGroup(g: ClassGroup): ClassGroupDraft {
  return {
    name: g.name,
    courtId: g.court.id,
    sportId: g.sport.id,
    level: g.level ?? '',
    teacherMemberIds: g.teachers.map((t) => t.memberId),
    weekday: String(g.weekday),
    startTime: g.startTime,
    durationMin: String(g.durationMin),
    capacity: String(g.capacity),
    active: g.active,
  };
}

export type ClassGroupResult =
  | { ok: true; data: CreateClassGroupInput }
  | { ok: false; errors: Record<string, string> };

const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * Valida a turma no cliente (a API valida de novo, inclusive a agenda). `enrolledCount` é o piso
 * da capacidade ao editar (CAPACITY_BELOW_ENROLLMENTS).
 */
export function classGroupFromDraft(d: ClassGroupDraft, enrolledCount = 0): ClassGroupResult {
  const errors: Record<string, string> = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Informe o nome da turma';
  else if (name.length > 80) errors.name = 'Use até 80 caracteres';
  if (!d.courtId) errors.courtId = 'Escolha a quadra';
  if (!d.sportId) errors.sportId = 'Escolha o esporte';
  if (d.teacherMemberIds.length === 0) errors.teacherMemberIds = 'Escolha ao menos um professor';
  else if (d.teacherMemberIds.length > MAX_TEACHERS)
    errors.teacherMemberIds = `Escolha até ${MAX_TEACHERS} professores`;

  const weekday = integer(d.weekday);
  if (weekday === null || weekday > 6) errors.weekday = 'Escolha o dia da semana';
  if (!START_TIME_OPTIONS.includes(d.startTime)) errors.startTime = 'Escolha o horário';

  const duration = integer(d.durationMin);
  if (duration === null || duration < 30 || duration > 360 || duration % 30 !== 0)
    errors.durationMin = 'Use múltiplos de 30 minutos (30 a 360)';

  const capacity = integer(d.capacity);
  if (capacity === null || capacity < 1 || capacity > 100) errors.capacity = 'De 1 a 100 alunos';
  else if (capacity < enrolledCount)
    errors.capacity = `A turma já tem ${enrolledCount} aluno(s) matriculado(s)`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      sportId: d.sportId,
      level: d.level === '' ? null : d.level,
      teacherMemberIds: d.teacherMemberIds,
      courtId: d.courtId,
      weekday: weekday as number,
      startTime: d.startTime,
      durationMin: duration as number,
      capacity: capacity as number,
      active: d.active,
    },
  };
}

// --- Plano ------------------------------------------------------------------------------------

/** Valor do seletor de frequência: `UNLIMITED` ou o número de aulas por semana. */
export const UNLIMITED = 'UNLIMITED';

export const FREQUENCY_OPTIONS = [
  { value: '1', label: '1x por semana' },
  { value: '2', label: '2x por semana' },
  { value: '3', label: '3x por semana' },
  { value: '4', label: '4x por semana' },
  { value: '5', label: '5x por semana' },
  { value: UNLIMITED, label: 'Ilimitado' },
];

export function frequencyLabel(weeklyFrequency: number | null): string {
  return weeklyFrequency === null ? 'Ilimitado' : `${weeklyFrequency}x por semana`;
}

export type PlanDraft = {
  name: string;
  sportId: string;
  frequency: string;
  price: string;
  billingDay: string;
  active: boolean;
};

export function emptyPlanDraft(): PlanDraft {
  return {
    name: '',
    sportId: '',
    frequency: '2',
    price: '',
    billingDay: '10',
    active: true,
  };
}

export function draftFromPlan(p: Plan): PlanDraft {
  return {
    name: p.name,
    sportId: p.sport.id,
    frequency: p.weeklyFrequency === null ? UNLIMITED : String(p.weeklyFrequency),
    price: centsToInput(p.priceCents),
    billingDay: String(p.billingDay),
    active: p.active,
  };
}

export type PlanResult =
  | { ok: true; data: CreatePlanInput }
  | { ok: false; errors: Record<string, string> };

export function planFromDraft(d: PlanDraft): PlanResult {
  const errors: Record<string, string> = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Informe o nome do plano';
  else if (name.length > 80) errors.name = 'Use até 80 caracteres';
  if (!d.sportId) errors.sportId = 'Escolha o esporte';

  const weeklyFrequency = d.frequency === UNLIMITED ? null : integer(d.frequency);
  if (d.frequency !== UNLIMITED && (weeklyFrequency === null || weeklyFrequency < 1))
    errors.frequency = 'Escolha a frequência';

  const priceCents = parseMoneyToCents(d.price);
  if (!d.price.trim()) errors.price = 'Informe o valor mensal';
  else if (priceCents === null) errors.price = 'Valor inválido';

  const billingDay = integer(d.billingDay);
  if (billingDay === null || billingDay < 1 || billingDay > 28)
    errors.billingDay = 'O vencimento vai do dia 1 ao 28';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      sportId: d.sportId,
      weeklyFrequency,
      priceCents: priceCents as number,
      billingDay: billingDay as number,
      active: d.active,
    },
  };
}

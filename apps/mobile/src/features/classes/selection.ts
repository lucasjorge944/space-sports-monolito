import type { PublicSpaceClasses } from '@space-sports/api-client';

type PublicPlan = PublicSpaceClasses['plans'][number];
export type PublicGroup = PublicSpaceClasses['classGroups'][number];

/** Limite do contrato (`classGroupIds` aceita de 1 a 14 turmas). */
export const MAX_GROUPS_PER_REQUEST = 14;

/** Turmas do esporte do plano (RN-CLASS-01); a API recusa as de outro esporte. */
export function eligibleGroups(plan: PublicPlan, groups: PublicGroup[]): PublicGroup[] {
  return groups.filter((group) => group.sport.id === plan.sport.id);
}

/** Quantas turmas o plano pede: N para Nx/semana, `null` quando é ilimitado (uma ou mais). */
export function requiredGroupCount(plan: Pick<PublicPlan, 'weeklyFrequency'>): number | null {
  return plan.weeklyFrequency;
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Duas turmas do mesmo dia da semana com horários que se sobrepõem (RN-CLASS-01). */
export function groupsOverlap(
  a: Pick<PublicGroup, 'weekday' | 'startTime' | 'durationMin'>,
  b: Pick<PublicGroup, 'weekday' | 'startTime' | 'durationMin'>,
): boolean {
  if (a.weekday !== b.weekday) return false;
  const aStart = toMinutes(a.startTime);
  const bStart = toMinutes(b.startTime);
  return aStart < bStart + b.durationMin && bStart < aStart + a.durationMin;
}

/** Por que a turma não pode ser marcada agora, ou `null` se pode (ou se já está marcada). */
export function groupDisabledReason(
  plan: Pick<PublicPlan, 'weeklyFrequency'>,
  group: PublicGroup,
  selected: PublicGroup[],
): 'FULL' | 'OVERLAP' | 'LIMIT' | null {
  if (selected.some((item) => item.id === group.id)) return null;
  if (group.availableSpots <= 0) return 'FULL';
  if (selected.some((item) => groupsOverlap(item, group))) return 'OVERLAP';
  const required = requiredGroupCount(plan);
  if ((required ?? MAX_GROUPS_PER_REQUEST) <= selected.length) return 'LIMIT';
  return null;
}

/** Marca ou desmarca a turma, respeitando as travas de `groupDisabledReason`. */
export function toggleGroup(
  plan: Pick<PublicPlan, 'weeklyFrequency'>,
  groups: PublicGroup[],
  selectedIds: string[],
  groupId: string,
): string[] {
  if (selectedIds.includes(groupId)) return selectedIds.filter((id) => id !== groupId);
  const group = groups.find((item) => item.id === groupId);
  if (!group) return selectedIds;
  const selected = groups.filter((item) => selectedIds.includes(item.id));
  return groupDisabledReason(plan, group, selected) === null
    ? [...selectedIds, groupId]
    : selectedIds;
}

/** Nx/semana = exatamente N turmas; ilimitado = ao menos uma (RN-CLASS-01). */
export function isSelectionComplete(
  plan: Pick<PublicPlan, 'weeklyFrequency'>,
  selectedCount: number,
): boolean {
  const required = requiredGroupCount(plan);
  return required === null
    ? selectedCount >= 1 && selectedCount <= MAX_GROUPS_PER_REQUEST
    : selectedCount === required;
}

/** Instrução curta acima da lista de turmas. */
export function selectionInstruction(plan: Pick<PublicPlan, 'weeklyFrequency'>): string {
  const required = requiredGroupCount(plan);
  if (required === null) {
    return 'Escolha as turmas em que você quer ter aula. Neste plano você vai quantas vezes quiser nelas.';
  }
  return required === 1
    ? 'Escolha a turma da sua aula da semana.'
    : `Escolha exatamente ${required} turmas, uma para cada aula da semana.`;
}

/** "2 de 3 turmas escolhidas" / "1 turma escolhida". */
export function selectionProgress(
  plan: Pick<PublicPlan, 'weeklyFrequency'>,
  selectedCount: number,
): string {
  const required = requiredGroupCount(plan);
  if (required === null) {
    return `${selectedCount} ${selectedCount === 1 ? 'turma escolhida' : 'turmas escolhidas'}`;
  }
  return `${selectedCount} de ${required} ${required === 1 ? 'turma escolhida' : 'turmas escolhidas'}`;
}

export const GROUP_DISABLED_LABELS = {
  FULL: 'Lotada',
  OVERLAP: 'Mesmo horário de outra turma escolhida',
  LIMIT: 'Você já escolheu todas as turmas do plano',
} as const;

/** Vagas em texto: "3 vagas", "1 vaga", "Lotada". */
export function spotsLabel(availableSpots: number): string {
  if (availableSpots <= 0) return 'Lotada';
  return `${availableSpots} ${availableSpots === 1 ? 'vaga' : 'vagas'}`;
}

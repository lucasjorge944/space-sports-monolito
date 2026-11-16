import { PERIOD_MAX_DATE, PERIOD_MIN_DATE, periodDateSchema } from '@space-sports/shared';

/** Faixa de datas que os filtros de período da API aceitam (`min`/`max` dos seletores de data). */
export const PERIOD_RANGE = { min: PERIOD_MIN_DATE, max: PERIOD_MAX_DATE } as const;

/**
 * Data de filtro lida da URL (`?data=`, `?de=`): só vale uma data real dentro da faixa da API; qualquer
 * outra coisa (`9999-12-31`, `2026-02-30`, lixo) cai no `fallback`, em vez de quebrar as contas de
 * calendário ou virar um 400.
 */
export function periodDateParam(raw: string | null | undefined, fallback: string): string {
  return raw && periodDateSchema.safeParse(raw).success ? raw : fallback;
}

/** Prende uma data à faixa da API (navegação por setas e fim da semana perto do limite). */
export function clampPeriodDate(date: string): string {
  if (date < PERIOD_MIN_DATE) return PERIOD_MIN_DATE;
  return date > PERIOD_MAX_DATE ? PERIOD_MAX_DATE : date;
}

import { earliest, type Interval, latest, mergeIntervals } from '@space-sports/shared';

// Aritmética de conjuntos de intervalos `[start, end)` para a ocupação (docs/14-mcp.md 8.4).
// As listas de entrada podem vir em qualquer ordem e com sobreposição: tudo passa por
// `mergeIntervals` (o mesmo da grade de disponibilidade) antes.

const HOUR_MS = 3_600_000;

/** `base` menos `cut`. */
export function subtractIntervals(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  const holes = mergeIntervals(cut);
  const result: Interval[] = [];
  for (const interval of mergeIntervals(base)) {
    let start = interval.start;
    for (const hole of holes) {
      if (hole.end <= start || hole.start >= interval.end) continue;
      if (hole.start > start) result.push({ start, end: hole.start });
      if (hole.end > start) start = hole.end;
      if (start >= interval.end) break;
    }
    if (start < interval.end) result.push({ start, end: interval.end });
  }
  return result;
}

/** Interseção de `a` e `b`. */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i] as Interval;
    const y = right[j] as Interval;
    const start = latest(x.start, y.start);
    const end = earliest(x.end, y.end);
    if (start < end) result.push({ start, end });
    if (x.end < y.end) i += 1;
    else j += 1;
  }
  return result;
}

/**
 * Reparte os intervalos em horas cheias (UTC) e chama `add(início da hora, minutos)` para cada
 * pedaço. Os fusos do Brasil têm deslocamento de horas inteiras, então a hora cheia UTC é também
 * a hora cheia local.
 */
export function eachHour(
  intervals: readonly Interval[],
  add: (hourStartMs: number, minutes: number) => void,
): void {
  for (const interval of intervals) {
    let cursor = interval.start.getTime();
    const end = interval.end.getTime();
    while (cursor < end) {
      const hourStart = Math.floor(cursor / HOUR_MS) * HOUR_MS;
      const pieceEnd = Math.min(hourStart + HOUR_MS, end);
      add(hourStart, (pieceEnd - cursor) / 60_000);
      cursor = pieceEnd;
    }
  }
}

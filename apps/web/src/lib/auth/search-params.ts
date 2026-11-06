export type SearchParams = Record<string, string | string[] | undefined>;

/** Primeiro valor de um parâmetro da URL (`?a=1&a=2` vira `1`). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first || undefined;
}

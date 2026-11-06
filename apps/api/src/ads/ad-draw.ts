/** Campanha candidata ao sorteio: peso (1 a 10) e as peças que podem ser entregues. */
export type DrawCandidate<T> = { campaignId: string; weight: number; creatives: T[] };

/**
 * Sorteio ponderado sem reposição (RF-ADS-07): cada campanha entra no máximo uma vez, e a chance
 * de sair antes das outras é proporcional ao peso. Corrida exponencial (Efraimidis–Spirakis):
 * chave `-ln(u)/peso`, menor primeiro. De cada campanha sorteada sai uma peça, ao acaso entre as
 * entregáveis. A ordem do resultado é a do sorteio (a do carrossel).
 */
export function drawCreatives<T>(
  candidates: DrawCandidate<T>[],
  max: number,
  random: () => number = Math.random,
): T[] {
  return candidates
    .filter((candidate) => candidate.creatives.length > 0 && candidate.weight > 0)
    .map((candidate) => ({ candidate, key: -Math.log(1 - random()) / candidate.weight }))
    .sort((a, b) => a.key - b.key)
    .slice(0, max)
    .map(({ candidate }) => {
      const index = Math.min(
        Math.floor(random() * candidate.creatives.length),
        candidate.creatives.length - 1,
      );
      return candidate.creatives[index] as T;
    });
}

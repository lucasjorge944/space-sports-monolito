/** Áreas do app ligadas ou desligadas num lugar só. Torneios voltam mudando aqui. */
export const FEATURES: { tournaments: boolean } = { tournaments: false };

/** Serviço do espaço que o app mostra: aba, filtro, card e tela do espaço passam por aqui. */
export function isServiceVisible(service: string): boolean {
  return service !== 'TOURNAMENTS' || FEATURES.tournaments;
}

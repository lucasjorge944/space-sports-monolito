import type { AdDeliveryListItemsItem, SpaceCard } from '@space-sports/api-client';

export type Ad = AdDeliveryListItemsItem;

/** Espaços antes da primeira vaga: o card patrocinado entra na 3ª posição. */
export const FIRST_AD_AFTER = 2;
/** Espaços entre uma vaga e a seguinte. */
export const AD_EVERY = 8;

export type FeedItem =
  | { type: 'space'; key: string; space: SpaceCard; spaceIndex: number }
  | { type: 'ad'; key: string; ad: Ad; slot: number }
  | { type: 'sponsored-space'; key: string; ad: Ad; slot: number };

/** Índice (0-based) do espaço que vem logo depois da vaga `slot`: 2, 10, 18… */
export function slotSpaceIndex(slot: number): number {
  return FIRST_AD_AFTER + slot * AD_EVERY;
}

/**
 * Quantas vagas já "passaram pela tela": a vaga cujo espaço seguinte (ou um depois dele) já
 * apareceu. Pôr um anúncio nela empurraria um card que a pessoa já viu.
 */
export function slotsPassed(seenSpaceIndex: number): number {
  if (seenSpaceIndex < FIRST_AD_AFTER) return 0;
  return Math.floor((seenSpaceIndex - FIRST_AD_AFTER) / AD_EVERY) + 1;
}

/** Anunciante espaço sem imagem própria: vira o card do espaço com o selo. */
export function isSponsoredSpace(ad: Ad): boolean {
  return ad.imageUrl === null && ad.destination.type === 'SPACE';
}

/**
 * Peça da vez `turn` (0 = a primeira vaga que segue o rodízio). Em rodízio pela ordem do sorteio,
 * sem a mesma peça em duas vagas seguidas: com uma peça só, ela entra em vagas alternadas.
 */
function adForTurn(ads: readonly Ad[], turn: number): Ad | null {
  if (turn < 0 || ads.length === 0) return null;
  if (ads.length === 1) return turn % 2 === 0 ? (ads[0] ?? null) : null;
  return ads[turn % ads.length] ?? null;
}

/**
 * Como as vagas recebem as peças: as primeiras `kept.length` vagas ficam com a peça já decidida
 * (`null` = vaga vazia, porque passou pela tela antes de o anúncio chegar); as demais seguem o
 * rodízio de `ads`, a partir da vez `offset`.
 */
export interface SlotPlan {
  kept?: readonly (Ad | null)[];
  offset?: number;
}

export function slotAd(
  ads: readonly Ad[] | null,
  slot: number,
  { kept = [], offset = 0 }: SlotPlan = {},
): Ad | null {
  if (slot < kept.length) return kept[slot] ?? null;
  return ads ? adForTurn(ads, slot - kept.length + offset) : null;
}

/**
 * Lista do Explorar com os cards patrocinados (RF-ADS-05) em vagas fixas: a 3ª posição e depois a
 * cada 8 espaços (3ª, 12ª, 21ª… contando os patrocinados). As vagas dependem só da posição dos
 * espaços, então a paginação infinita continua o mesmo ritmo.
 */
export function buildFeed(
  spaces: readonly SpaceCard[],
  ads: readonly Ad[] | null,
  plan: SlotPlan = {},
): FeedItem[] {
  const items: FeedItem[] = [];
  let slot = 0;
  const pushSlot = () => {
    const ad = slotAd(ads, slot, plan);
    if (ad) {
      items.push({
        type: isSponsoredSpace(ad) ? 'sponsored-space' : 'ad',
        key: `ad-slot-${slot}`,
        ad,
        slot,
      });
    }
    slot += 1;
  };
  spaces.forEach((space, spaceIndex) => {
    if (spaceIndex === slotSpaceIndex(slot)) pushSlot();
    items.push({ type: 'space', key: space.id, space, spaceIndex });
  });
  // Lista que termina bem na vaga: o card fica no fim (a próxima página entra depois dele).
  if (spaces.length > 0 && spaces.length === slotSpaceIndex(slot)) pushSlot();
  return items;
}

/**
 * Estado das vagas de uma "sessão" da lista (mesma busca, até o puxar para atualizar). Cada nova
 * entrega (abertura do Explorar, token perto de vencer) só entra nas vagas que ainda não passaram
 * pela tela: as vagas vistas mantêm a peça (com o token novo, se a peça veio de novo), e as vistas
 * antes do primeiro anúncio chegar continuam vazias. Assim nenhum card visto troca nem empurra a
 * lista.
 */
export interface FeedSlotsState {
  listKey: string;
  /** Última entrega aplicada; `null` enquanto os anúncios não chegaram. */
  ads: Ad[] | null;
  /** Peças fixadas nas vagas que já passaram pela tela (`null` = vaga vazia). */
  kept: (Ad | null)[];
  /** Vez do rodízio da primeira vaga depois de `kept`. */
  offset: number;
  /** Maior índice de espaço que já apareceu na tela. */
  seenSpaceIndex: number;
}

export type FeedSlotsAction =
  | { type: 'seen'; listKey: string; spaceIndex: number }
  | { type: 'ads'; listKey: string; ads: Ad[] };

export function initialFeedSlots(listKey: string): FeedSlotsState {
  return { listKey, ads: null, kept: [], offset: 0, seenSpaceIndex: -1 };
}

/** O estado vale para uma lista (`listKey`); ação de outra lista começa do zero. */
export function currentFeedSlots(state: FeedSlotsState, listKey: string): FeedSlotsState {
  return state.listKey === listKey ? state : initialFeedSlots(listKey);
}

/** A peça mantida na vaga vista leva o token da nova entrega, se a peça veio de novo. */
function refreshToken(piece: Ad | null, ads: readonly Ad[]): Ad | null {
  if (!piece) return null;
  const fresh = ads.find((ad) => ad.creativeId === piece.creativeId);
  return fresh
    ? { ...piece, deliveryToken: fresh.deliveryToken, tokenExpiresAt: fresh.tokenExpiresAt }
    : piece;
}

function applyDelivery(state: FeedSlotsState, ads: Ad[]): FeedSlotsState {
  if (state.ads === ads) return state;
  const passed = slotsPassed(state.seenSpaceIndex);
  const kept = Array.from({ length: passed }, (_, slot) =>
    refreshToken(slotAd(state.ads, slot, state), ads),
  );
  // Sem a mesma peça em duas vagas seguidas também na emenda entre a parte vista e a nova.
  const last = kept[passed - 1] ?? null;
  const offset = last && ads[0]?.creativeId === last.creativeId ? 1 : 0;
  return { ...state, ads, kept, offset };
}

export function feedSlotsReducer(state: FeedSlotsState, action: FeedSlotsAction): FeedSlotsState {
  const current = currentFeedSlots(state, action.listKey);
  switch (action.type) {
    case 'seen':
      return action.spaceIndex > current.seenSpaceIndex
        ? { ...current, seenSpaceIndex: action.spaceIndex }
        : current;
    case 'ads':
      return applyDelivery(current, action.ads);
  }
}

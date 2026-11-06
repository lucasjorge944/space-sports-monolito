import {
  buildFeed,
  currentFeedSlots,
  type FeedItem,
  feedSlotsReducer,
  initialFeedSlots,
  slotsPassed,
} from './feed';
import { makeAd, makeSpace, makeSpaces } from './test-fixtures';

/** Posições (1-based) dos cards patrocinados e as peças em cada uma. */
function adPositions(items: FeedItem[]): Array<[number, string]> {
  return items.flatMap((item, i) => (item.type === 'space' ? [] : [[i + 1, item.ad.creativeId]]));
}

describe('buildFeed (RF-ADS-05: vagas fixas no feed)', () => {
  const ads = [makeAd('a'), makeAd('b'), makeAd('c')];

  it('põe o card patrocinado na 3ª posição e depois a cada 8 espaços', () => {
    const items = buildFeed(makeSpaces(30), ads);
    expect(adPositions(items)).toEqual([
      [3, 'a'],
      [12, 'b'],
      [21, 'c'],
      [30, 'a'],
    ]);
    // 8 espaços entre um patrocinado e o seguinte.
    expect(items.slice(3, 11).every((item) => item.type === 'space')).toBe(true);
    expect(items.filter((item) => item.type === 'space')).toHaveLength(30);
  });

  it('sem anúncios (falha, 429 ou lista vazia), é só a lista de espaços', () => {
    expect(buildFeed(makeSpaces(12), null).every((item) => item.type === 'space')).toBe(true);
    expect(buildFeed(makeSpaces(12), []).every((item) => item.type === 'space')).toBe(true);
  });

  it('lista curta: com 1 espaço não há vaga; com 2, o card fica no fim', () => {
    expect(adPositions(buildFeed(makeSpaces(1), ads))).toEqual([]);
    expect(adPositions(buildFeed(makeSpaces(2), ads))).toEqual([[3, 'a']]);
    expect(adPositions(buildFeed([], ads))).toEqual([]);
  });

  it('paginação infinita: a página nova não mexe nas vagas de antes e continua o ritmo', () => {
    const firstPage = buildFeed(makeSpaces(20), ads);
    const twoPages = buildFeed([...makeSpaces(20), ...makeSpaces(20, 20)], ads);
    expect(twoPages.slice(0, firstPage.length).map((item) => item.key)).toEqual(
      firstPage.map((item) => item.key),
    );
    expect(adPositions(twoPages)).toEqual([
      [3, 'a'],
      [12, 'b'],
      [21, 'c'],
      [30, 'a'],
      [39, 'b'],
    ]);
  });

  it('não repete a mesma peça em duas vagas seguidas', () => {
    const items = buildFeed(makeSpaces(80), [makeAd('a'), makeAd('b')]);
    const ids = adPositions(items).map(([, id]) => id);
    expect(ids.length).toBeGreaterThan(5);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it('com uma peça só, ela entra em vagas alternadas', () => {
    expect(adPositions(buildFeed(makeSpaces(30), [makeAd('a')]))).toEqual([
      [3, 'a'],
      [20, 'a'],
    ]);
  });

  it('as chaves das vagas são estáveis e únicas', () => {
    const items = buildFeed(makeSpaces(30), ads);
    const keys = items.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items[2]?.key).toBe('ad-slot-0');
  });

  it('anunciante espaço sem imagem vira o card do espaço com selo (sponsored-space)', () => {
    const spaceAd = makeAd('s', {
      imageUrl: null,
      advertiser: { name: 'Arena', kind: 'SPACE' },
      destination: { type: 'SPACE', space: makeSpace(99) },
    });
    const withImage = makeAd('i', {
      advertiser: { name: 'Arena', kind: 'SPACE' },
      destination: { type: 'SPACE', space: makeSpace(98) },
    });
    const items = buildFeed(makeSpaces(12), [spaceAd, withImage]);
    expect(items[2]?.type).toBe('sponsored-space');
    expect(items[11]?.type).toBe('ad');
  });

  it('pula as vagas já vistas: a primeira vaga livre recebe a primeira peça', () => {
    const items = buildFeed(makeSpaces(30), ads, { kept: [null] });
    expect(adPositions(items)).toEqual([
      [11, 'a'],
      [20, 'b'],
      [29, 'c'],
    ]);
  });
});

describe('slotsPassed', () => {
  it('conta a vaga como vista quando o espaço logo depois dela já apareceu', () => {
    expect(slotsPassed(-1)).toBe(0);
    expect(slotsPassed(1)).toBe(0);
    expect(slotsPassed(2)).toBe(1);
    expect(slotsPassed(9)).toBe(1);
    expect(slotsPassed(10)).toBe(2);
    expect(slotsPassed(18)).toBe(3);
  });
});

describe('feedSlotsReducer (anúncio atrasado e nova entrega)', () => {
  const key = 'lista';
  const ads = [makeAd('a'), makeAd('b')];

  it('anúncio que chega antes de rolar preenche todas as vagas', () => {
    const state = feedSlotsReducer(initialFeedSlots(key), { type: 'ads', listKey: key, ads });
    expect(state.kept).toEqual([]);
    expect(adPositions(buildFeed(makeSpaces(12), state.ads, state))[0]).toEqual([3, 'a']);
  });

  it('anúncio atrasado só entra nas vagas que ainda não apareceram na tela', () => {
    let state = initialFeedSlots(key);
    // A pessoa rolou até o 5º espaço (índice 4) antes de os anúncios chegarem.
    state = feedSlotsReducer(state, { type: 'seen', listKey: key, spaceIndex: 4 });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads });
    expect(state.kept).toEqual([null]);
    const items = buildFeed(makeSpaces(20), state.ads, state);
    // Os 5 primeiros espaços seguem nas mesmas posições: nenhum card visto foi empurrado.
    expect(items.slice(0, 5).map((item) => item.key)).toEqual(makeSpaces(5).map((s) => s.id));
    expect(adPositions(items)).toEqual([
      [11, 'a'],
      [20, 'b'],
    ]);
  });

  it('a vaga no fim da tela, ainda sem o espaço seguinte visto, recebe o anúncio', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), {
      type: 'seen',
      listKey: key,
      spaceIndex: 1,
    });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads });
    expect(state.kept).toEqual([]);
  });

  it('nova entrega (nova abertura) só entra nas vagas ainda não vistas', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), { type: 'ads', listKey: key, ads });
    // Viu até o 12º espaço: as vagas 0 (3ª posição) e 1 (12ª) já passaram pela tela.
    state = feedSlotsReducer(state, { type: 'seen', listKey: key, spaceIndex: 11 });
    const before = adPositions(buildFeed(makeSpaces(40), state.ads, state));
    const delivery = [makeAd('x'), makeAd('y')];
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads: delivery });
    const after = adPositions(buildFeed(makeSpaces(40), state.ads, state));
    // As vagas vistas mantêm a peça; as seguintes já vêm da nova entrega.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after.slice(0, 2)).toEqual([
      [3, 'a'],
      [12, 'b'],
    ]);
    expect(after.slice(2)).toEqual([
      [21, 'x'],
      [30, 'y'],
      [39, 'x'],
    ]);
  });

  it('vaga vista mantém a peça, com o token novo se a peça veio de novo', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), { type: 'ads', listKey: key, ads });
    state = feedSlotsReducer(state, { type: 'seen', listKey: key, spaceIndex: 2 });
    const renewed = makeAd('a', { deliveryToken: 'token-a-2', title: 'Outro título' });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads: [renewed, makeAd('c')] });
    const seen = buildFeed(makeSpaces(12), state.ads, state)[2];
    expect(seen?.type).toBe('ad');
    if (seen?.type !== 'ad') return;
    expect(seen.ad.deliveryToken).toBe('token-a-2');
    // A peça na tela não muda (só o token).
    expect(seen.ad.title).toBe('Título a');
    // A vaga seguinte não repete a peça da vaga vista anterior.
    expect(adPositions(buildFeed(makeSpaces(12), state.ads, state))).toEqual([
      [3, 'a'],
      [12, 'c'],
    ]);
  });

  it('peça que saiu da nova entrega (campanha encerrada) some das vagas ainda não vistas', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), { type: 'ads', listKey: key, ads });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads: [makeAd('z'), makeAd('w')] });
    const ids = adPositions(buildFeed(makeSpaces(20), state.ads, state)).map(([, id]) => id);
    expect(ids).toEqual(['z', 'w', 'z']);
  });

  it('vaga vista que ficou vazia continua vazia na nova entrega', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), {
      type: 'seen',
      listKey: key,
      spaceIndex: 4,
    });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads: [makeAd('z')] });
    expect(adPositions(buildFeed(makeSpaces(12), state.ads, state))).toEqual([[11, 'z']]);
  });

  it('a mesma entrega aplicada de novo não muda o estado', () => {
    const state = feedSlotsReducer(initialFeedSlots(key), { type: 'ads', listKey: key, ads });
    expect(feedSlotsReducer(state, { type: 'ads', listKey: key, ads })).toBe(state);
  });

  it('nova busca ou puxar para atualizar (outra listKey) começa do zero', () => {
    let state = feedSlotsReducer(initialFeedSlots(key), {
      type: 'seen',
      listKey: key,
      spaceIndex: 15,
    });
    state = feedSlotsReducer(state, { type: 'ads', listKey: key, ads });
    expect(state.kept).toEqual([null, null]);
    expect(currentFeedSlots(state, 'outra')).toEqual(initialFeedSlots('outra'));
    const fresh = feedSlotsReducer(state, { type: 'ads', listKey: 'outra', ads });
    expect(fresh.kept).toEqual([]);
  });
});

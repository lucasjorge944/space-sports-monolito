import { exploreLayout } from '@space-sports/ui-tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { Ad } from './feed';
import { HeroCarousel } from './hero-carousel';
import { makeAd } from './test-fixtures';

jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));

const AUTOPLAY_MS = exploreLayout.hero.autoplayMs;
const ads = [makeAd('a'), makeAd('b'), makeAd('c')].map((ad) => ({
  ...ad,
  placement: 'EXPLORE_HERO' as const,
}));

function currentIds(onCurrentChange: jest.Mock): string[] {
  return onCurrentChange.mock.calls.map(([ad]: [Ad | null]) => ad?.creativeId ?? 'null');
}

function lastCurrent(onCurrentChange: jest.Mock): string | undefined {
  return currentIds(onCurrentChange).at(-1);
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function renderCarousel(list: Ad[] = ads, active = true) {
  const onCurrentChange = jest.fn();
  const result = await render(
    <HeroCarousel
      ads={list}
      active={active}
      onPressAd={jest.fn()}
      onCurrentChange={onCurrentChange}
    />,
  );
  // Deixa as consultas de acessibilidade (reduzir movimento, leitor de tela) responderem.
  await act(async () => undefined);
  return { ...result, onCurrentChange };
}

let reduceMotion = false;
let screenReader = false;

beforeEach(() => {
  jest.useFakeTimers();
  reduceMotion = false;
  screenReader = false;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(async () => reduceMotion);
  jest
    .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
    .mockImplementation(async () => screenReader);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('HeroCarousel (RF-ADS-04)', () => {
  it('troca de peça a cada 5 s e volta da última para a primeira', async () => {
    const { onCurrentChange } = await renderCarousel();
    expect(lastCurrent(onCurrentChange)).toBe('a');
    await advance(AUTOPLAY_MS - 1);
    expect(lastCurrent(onCurrentChange)).toBe('a');
    await advance(1);
    expect(lastCurrent(onCurrentChange)).toBe('b');
    await advance(AUTOPLAY_MS);
    expect(lastCurrent(onCurrentChange)).toBe('c');
    await advance(AUTOPLAY_MS);
    expect(lastCurrent(onCurrentChange)).toBe('a');
  });

  it('pausa enquanto a pessoa toca e dá 5 s inteiros depois de soltar', async () => {
    const { onCurrentChange } = await renderCarousel();
    const list = screen.getByTestId('explorar-carrossel-lista');
    await advance(AUTOPLAY_MS - 1000);
    await fireEvent(list, 'touchStart');
    await advance(AUTOPLAY_MS * 3);
    expect(lastCurrent(onCurrentChange)).toBe('a');
    await fireEvent(list, 'touchEnd');
    await advance(AUTOPLAY_MS - 1);
    expect(lastCurrent(onCurrentChange)).toBe('a');
    await advance(1);
    expect(lastCurrent(onCurrentChange)).toBe('b');
  });

  it('fica parado com "reduzir movimento"', async () => {
    reduceMotion = true;
    const { onCurrentChange } = await renderCarousel();
    await advance(AUTOPLAY_MS * 3);
    expect(new Set(currentIds(onCurrentChange))).toEqual(new Set(['a']));
  });

  it('fica parado com leitor de tela', async () => {
    screenReader = true;
    const { onCurrentChange } = await renderCarousel();
    await advance(AUTOPLAY_MS * 3);
    expect(new Set(currentIds(onCurrentChange))).toEqual(new Set(['a']));
  });

  it('fica parado fora de foco, em segundo plano ou fora da tela (inativo)', async () => {
    const { onCurrentChange } = await renderCarousel(ads, false);
    await advance(AUTOPLAY_MS * 3);
    expect(new Set(currentIds(onCurrentChange))).toEqual(new Set(['a']));
  });

  it('nova entrega com outras peças volta para a primeira', async () => {
    const { onCurrentChange, rerender } = await renderCarousel();
    await advance(AUTOPLAY_MS);
    await advance(AUTOPLAY_MS);
    expect(lastCurrent(onCurrentChange)).toBe('c');
    const delivery = [makeAd('x'), makeAd('y')];
    await rerender(
      <HeroCarousel
        ads={delivery}
        active
        onPressAd={jest.fn()}
        onCurrentChange={onCurrentChange}
      />,
    );
    expect(lastCurrent(onCurrentChange)).toBe('x');
    // E o tempo da peça recomeça.
    await advance(AUTOPLAY_MS - 1);
    expect(lastCurrent(onCurrentChange)).toBe('x');
    await advance(1);
    expect(lastCurrent(onCurrentChange)).toBe('y');
  });

  it('mesmas peças com tokens novos não mexem na posição', async () => {
    const { onCurrentChange, rerender } = await renderCarousel();
    await advance(AUTOPLAY_MS);
    expect(lastCurrent(onCurrentChange)).toBe('b');
    const renewed = ads.map((ad) => ({ ...ad, deliveryToken: `${ad.deliveryToken}-2` }));
    await rerender(
      <HeroCarousel ads={renewed} active onPressAd={jest.fn()} onCurrentChange={onCurrentChange} />,
    );
    expect(onCurrentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ creativeId: 'b', deliveryToken: 'token-b-2' }),
    );
  });
});

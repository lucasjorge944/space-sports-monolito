import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { AD_EVENTS_FLUSH_MS, AdEventQueue, ImpressionTracker } from './ad-events';
import { makeAd } from './test-fixtures';
import { useAdMetrics } from './use-ad-metrics';

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  sendAdEvents: jest.fn(async () => ({ accepted: 0 })),
}));

function queueWithSpy() {
  const send = jest.fn(async (_events: unknown[]) => ({ accepted: 0 }));
  return { send, queue: new AdEventQueue(send) };
}

describe('AdEventQueue (RF-ADS-08)', () => {
  it('envia impressões e cliques em lote, só com o token da entrega', async () => {
    const { send, queue } = queueWithSpy();
    queue.impression(makeAd('a'));
    queue.impression(makeAd('b'));
    queue.click(makeAd('a'));
    expect(send).not.toHaveBeenCalled();
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([
      { token: 'token-a', type: 'IMPRESSION' },
      { token: 'token-b', type: 'IMPRESSION' },
      { token: 'token-a', type: 'CLICK' },
    ]);
    // Nada de usuário ou aparelho: cada evento só tem token e tipo.
    for (const event of send.mock.calls[0]?.[0] ?? []) {
      expect(Object.keys(event as object).sort()).toEqual(['token', 'type']);
    }
  });

  it('conta uma impressão por peça a cada abertura do Explorar', async () => {
    const { send, queue } = queueWithSpy();
    queue.impression(makeAd('a'));
    queue.impression(makeAd('a'));
    // A mesma peça em outra vaga (mesmo creativeId) também não conta de novo.
    queue.impression(makeAd('a', { deliveryToken: 'outro-token' }));
    await queue.flush();
    expect(send.mock.calls[0]?.[0]).toHaveLength(1);

    queue.impression(makeAd('a'));
    expect(queue.size).toBe(0);
    queue.startSession();
    queue.impression(makeAd('a'));
    expect(queue.size).toBe(1);
  });

  it('um clique por entrega', () => {
    const { queue } = queueWithSpy();
    queue.click(makeAd('a'));
    queue.click(makeAd('a'));
    expect(queue.size).toBe(1);
  });

  it('descarta eventos de token vencido', () => {
    const { queue } = queueWithSpy();
    queue.impression(makeAd('a', { tokenExpiresAt: '2000-01-01T00:00:00Z' }));
    queue.click(makeAd('a', { tokenExpiresAt: '2000-01-01T00:00:00Z' }));
    expect(queue.size).toBe(0);
  });

  it('divide em lotes de até 50', async () => {
    const { send, queue } = queueWithSpy();
    for (let i = 0; i < 120; i++) queue.impression(makeAd(`p${i}`));
    await queue.flush();
    expect(send.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 20]);
  });

  it('falha no envio descarta o lote em silêncio', async () => {
    const send = jest.fn(async () => {
      throw new Error('429');
    });
    const queue = new AdEventQueue(send);
    queue.impression(makeAd('a'));
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(queue.size).toBe(0);
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fila vazia não chama a API', async () => {
    const { send, queue } = queueWithSpy();
    await queue.flush();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('ImpressionTracker (≥ 50% por 1 s)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('conta a peça que fica visível por 1 s seguido', () => {
    const onImpression = jest.fn();
    const tracker = new ImpressionTracker(onImpression);
    tracker.setActive(true);
    tracker.setVisible('feed', [makeAd('a')]);
    jest.advanceTimersByTime(999);
    expect(onImpression).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onImpression).toHaveBeenCalledWith(expect.objectContaining({ creativeId: 'a' }));
  });

  it('peça que sai da tela antes de 1 s não conta', () => {
    const onImpression = jest.fn();
    const tracker = new ImpressionTracker(onImpression);
    tracker.setActive(true);
    tracker.setVisible('feed', [makeAd('a')]);
    jest.advanceTimersByTime(600);
    tracker.setVisible('feed', []);
    jest.advanceTimersByTime(2000);
    expect(onImpression).not.toHaveBeenCalled();
  });

  it('inativo (fora de foco ou em segundo plano) não conta; ao voltar, recomeça o 1 s', () => {
    const onImpression = jest.fn();
    const tracker = new ImpressionTracker(onImpression);
    tracker.setVisible('hero', [makeAd('h')]);
    jest.advanceTimersByTime(5000);
    expect(onImpression).not.toHaveBeenCalled();
    tracker.setActive(true);
    jest.advanceTimersByTime(500);
    tracker.setActive(false);
    jest.advanceTimersByTime(5000);
    expect(onImpression).not.toHaveBeenCalled();
    tracker.setActive(true);
    jest.advanceTimersByTime(1000);
    expect(onImpression).toHaveBeenCalledTimes(1);
  });

  it('conta com o token mais recente da peça que continua na tela', () => {
    const onImpression = jest.fn();
    const tracker = new ImpressionTracker(onImpression);
    tracker.setActive(true);
    tracker.setVisible('feed', [makeAd('a')]);
    jest.advanceTimersByTime(500);
    tracker.setVisible('feed', [makeAd('a', { deliveryToken: 'token-a-2' })]);
    jest.advanceTimersByTime(500);
    expect(onImpression).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryToken: 'token-a-2' }),
    );
  });

  it('junta as fontes (lista e carrossel)', () => {
    const onImpression = jest.fn();
    const tracker = new ImpressionTracker(onImpression);
    tracker.setActive(true);
    tracker.setVisible('feed', [makeAd('a')]);
    tracker.setVisible('hero', [makeAd('h')]);
    jest.advanceTimersByTime(1000);
    expect(onImpression.mock.calls.map(([ad]) => ad.creativeId).sort()).toEqual(['a', 'h']);
  });
});

describe('useAdMetrics (envio a cada 10 s, ao sair e no segundo plano)', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFocused = true;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('envia a fila a cada ~10 s com o Explorar em foco', async () => {
    const { send, queue } = queueWithSpy();
    const { unmount } = await renderHook(() => useAdMetrics(queue));
    queue.impression(makeAd('a'));
    await act(async () => {
      jest.advanceTimersByTime(AD_EVENTS_FLUSH_MS);
    });
    expect(send).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('envia ao ir para segundo plano e para de contar impressões', async () => {
    const { send, queue } = queueWithSpy();
    const { result, unmount } = await renderHook(() => useAdMetrics(queue));
    queue.click(makeAd('a'));
    result.current.tracker.setVisible('feed', [makeAd('b')]);
    await act(async () => {
      appStateListener?.('background');
    });
    expect(send).toHaveBeenCalledWith([{ token: 'token-a', type: 'CLICK' }]);
    expect(result.current.active).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(queue.size).toBe(0);
    await unmount();
  });

  it('envia ao sair da tela (perder o foco)', async () => {
    const { send, queue } = queueWithSpy();
    const { rerender, unmount } = await renderHook(() => useAdMetrics(queue));
    queue.impression(makeAd('a'));
    mockFocused = false;
    await rerender({});
    expect(send).toHaveBeenCalledWith([{ token: 'token-a', type: 'IMPRESSION' }]);
    await unmount();
  });

  it('restart (nova abertura com a entrega nova) libera nova impressão da mesma peça', async () => {
    const { queue } = queueWithSpy();
    const { result, rerender, unmount } = await renderHook(() => useAdMetrics(queue));
    queue.impression(makeAd('a'));
    await act(async () => {
      await queue.flush();
    });
    // Só o foco não basta: o token antigo já contou a impressão dele.
    mockFocused = false;
    await rerender({});
    mockFocused = true;
    await rerender({});
    queue.impression(makeAd('a'));
    expect(queue.size).toBe(0);
    await act(async () => result.current.restart());
    queue.impression(makeAd('a', { deliveryToken: 'token-a-2' }));
    expect(queue.size).toBe(1);
    await unmount();
  });

  it('restart recomeça o 1 s das peças na tela e conta com o token mais recente', async () => {
    const { send, queue } = queueWithSpy();
    const { result, unmount } = await renderHook(() => useAdMetrics(queue));
    result.current.tracker.setVisible('feed', [makeAd('a')]);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(queue.size).toBe(1);
    result.current.tracker.setVisible('feed', [makeAd('a', { deliveryToken: 'token-a-2' })]);
    await act(async () => result.current.restart());
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await queue.flush();
    });
    expect(send.mock.calls.flatMap(([events]) => events)).toEqual([
      { token: 'token-a', type: 'IMPRESSION' },
      { token: 'token-a-2', type: 'IMPRESSION' },
    ]);
    await unmount();
  });
});

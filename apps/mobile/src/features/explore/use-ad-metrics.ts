import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { AD_EVENTS_FLUSH_MS, type AdEventQueue, adEvents, ImpressionTracker } from './ad-events';
import type { Ad } from './feed';

/**
 * Métricas dos anúncios no Explorar (RF-ADS-08): a fila vai em lote a cada ~10 s, ao sair da tela
 * e ao ir para segundo plano, e as impressões só correm com a aba em foco e o app ativo. Quem usa
 * chama `restart()` a cada abertura, quando a nova entrega chega: só então cada peça volta a poder
 * contar uma impressão (antes disso, o token antigo já contou a dele).
 */
export function useAdMetrics(queue: AdEventQueue = adEvents) {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const tracker = useMemo(() => new ImpressionTracker((ad) => queue.impression(ad)), [queue]);

  useEffect(() => () => tracker.dispose(), [tracker]);
  useEffect(() => queue.startSession(), [queue]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      if (!active) void queue.flush();
    });
    return () => subscription.remove();
  }, [queue]);

  useEffect(() => {
    if (!focused) return;
    const interval = setInterval(() => void queue.flush(), AD_EVENTS_FLUSH_MS);
    return () => {
      clearInterval(interval);
      void queue.flush();
    };
  }, [focused, queue]);

  const active = focused && appActive;
  useEffect(() => tracker.setActive(active), [tracker, active]);

  // O clique vai na hora: o destino costuma levar o app para segundo plano logo depois.
  const click = useCallback(
    (ad: Ad) => {
      queue.click(ad);
      void queue.flush();
    },
    [queue],
  );
  /** Nova abertura (foco, volta do segundo plano ou puxar para atualizar) com a entrega nova. */
  const restart = useCallback(() => {
    queue.startSession();
    tracker.restart();
  }, [queue, tracker]);
  return { tracker, active, click, restart };
}

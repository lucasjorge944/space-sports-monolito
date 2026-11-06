import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { countdownAnnouncement, remainingMs, serverNow } from './countdown';

/**
 * Quanto falta até `deadline` no relógio do servidor, atualizado a cada segundo enquanto houver
 * prazo. Anuncia aos 5 min e a 1 min para leitores de tela. `offsetMs` é a diferença servidor −
 * aparelho da resposta que trouxe o prazo (o `serverTime` da reserva ou da cobrança); sem ele, a
 * da última cobrança recebida.
 */
export function useCountdown(
  deadline: string | null | undefined,
  announce = false,
  offsetMs?: number | null,
): number | null {
  const now = () => (offsetMs == null ? serverNow() : Date.now() + offsetMs);
  const compute = () => (deadline ? remainingMs(deadline, now()) : null);
  const [ms, setMs] = useState<number | null>(compute);
  const previous = useRef<number | null>(ms);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `compute` depende só de `deadline`.
  useEffect(() => {
    const tick = () => {
      const next = compute();
      if (announce && previous.current !== null && next !== null) {
        const message = countdownAnnouncement(previous.current, next);
        if (message) AccessibilityInfo.announceForAccessibility(message);
      }
      previous.current = next;
      setMs(next);
    };
    tick();
    if (!deadline) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline, announce, offsetMs]);

  return ms;
}

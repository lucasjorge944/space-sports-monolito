import { useEffect, useState } from 'react';

/** Maior atraso que o `setTimeout` aceita (acima disso dispara na hora). */
const MAX_DELAY_MS = 2 ** 31 - 1;

/**
 * Instante atual que se atualiza sozinho ao cruzar cada `boundaries` (ISO), para a tela reagir a
 * "a aula começou/terminou" sem recarregar. Sem fronteira futura, não agenda nada.
 */
export function useNow(boundaries: readonly string[]): Date {
  const [now, setNow] = useState(() => new Date());
  const key = boundaries.join('|');
  useEffect(() => {
    const times = key
      .split('|')
      .map((iso) => Date.parse(iso))
      .filter((t) => Number.isFinite(t));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const current = Date.now();
      const next = Math.min(...times.filter((t) => t > current));
      if (!Number.isFinite(next)) return;
      // +50 ms garante `now >= fronteira` mesmo com o arredondamento do timer.
      timer = setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        Math.min(next - current + 50, MAX_DELAY_MS),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [key]);
  return now;
}

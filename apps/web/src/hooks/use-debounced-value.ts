import { useEffect, useState } from 'react';

/** Valor que só muda depois de `delayMs` sem novas alterações (busca digitada sem uma requisição por tecla). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

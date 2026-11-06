import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Conta as aberturas do Explorar depois da primeira (RF-ADS-08): a aba ganhar o foco de novo ou o
 * app voltar do segundo plano com a aba em foco. Cada abertura vale um número novo, então quem usa
 * reage uma vez só por abertura. O `inactive` do iOS (central de controle, chamada) não conta.
 */
export function useExploreOpenings(): number {
  const focused = useIsFocused();
  const [opening, setOpening] = useState(0);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const firstFocus = useRef(true);

  useEffect(() => {
    if (!focused) return;
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    setOpening((count) => count + 1);
  }, [focused]);

  useEffect(() => {
    let wentBackground = AppState.currentState === 'background';
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wentBackground = true;
      } else if (state === 'active' && wentBackground) {
        wentBackground = false;
        if (focusedRef.current) setOpening((count) => count + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  return opening;
}

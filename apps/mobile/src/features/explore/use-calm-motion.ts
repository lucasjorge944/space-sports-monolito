import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * `true` com "reduzir movimento" ou leitor de tela ligado: nada se move sozinho (WCAG 2.2.2), e o
 * carrossel não troca de peça por conta própria.
 */
export function useCalmMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduceMotion(value))
      .catch(() => undefined);
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => alive && setScreenReader(value))
      .catch(() => undefined);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      alive = false;
      motion.remove();
      reader.remove();
    };
  }, []);

  return reduceMotion || screenReader;
}

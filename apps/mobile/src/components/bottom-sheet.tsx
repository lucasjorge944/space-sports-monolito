import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';

/**
 * Reserva do iOS caso o `onDismiss` do Modal não chegue: um pouco acima da animação `slide`.
 * (O `InteractionManager` saiu do React Native 0.88.)
 */
export const IOS_DISMISS_FALLBACK_MS = 500;

interface BottomSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /**
   * Chamado uma vez depois que a folha some (de `visible` para falso). No iOS vem do `onDismiss`
   * do Modal, com uma reserva por tempo; nas outras plataformas, no tick seguinte. Use-o para abrir
   * um `Alert` ou outro Modal: no iOS, abrir no mesmo toque em que esta fecha falha sem erro.
   */
  onDismissed?: () => void;
  children: ReactNode;
}

/** Folha que sobe da base (filtros, escolha rápida). Fecha no toque fora, no botão Voltar e no gesto do sistema. */
export function BottomSheet({ visible, title, onClose, onDismissed, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const dismissedRef = useRef(onDismissed);
  dismissedRef.current = onDismissed;
  // Verdadeiro enquanto não há um fechamento pendente de aviso.
  const firedRef = useRef(true);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    dismissedRef.current?.();
  }, []);

  useEffect(() => {
    if (visible) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    const timer = setTimeout(fire, Platform.OS === 'ios' ? IOS_DISMISS_FALLBACK_MS : 0);
    return () => clearTimeout(timer);
  }, [visible, fire]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? fire : undefined}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          accessibilityLabel="Fechar"
          className="absolute inset-0 bg-mar-900/60"
          onPress={onClose}
        />
        <View
          className="max-h-[85%] rounded-t-xl bg-card px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Text variant="h4" className="mb-3">
            {title}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 pb-2">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Menu de ações numa `BottomSheet`: a escolha (`choose`) fecha a folha e só roda `run` depois que
 * ela some (`onDismissed`), para o `Alert` de confirmação ou outra folha abrirem no iOS. Só vale a
 * primeira escolha (ou o fechar) com a folha aberta: toques durante o fechamento são ignorados. A folha
 * fica montada só enquanto aberta ou fechando (`mounted`), para listas não carregarem um Modal por
 * item.
 */
export function useMenuSheet<T>(run: (choice: T) => void) {
  type MenuState = 'closed' | 'open' | 'closing';
  const [state, setStateValue] = useState<MenuState>('closed');
  // Espelho síncrono do estado: dois toques no mesmo quadro (ou durante a animação de fechar, que
  // no iOS dura até o onDismiss) não podem trocar nem apagar a escolha já feita.
  const stateRef = useRef<MenuState>('closed');
  const setState = useCallback((next: MenuState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);
  const pending = useRef<{ choice: T } | null>(null);
  const runRef = useRef(run);
  runRef.current = run;

  const open = useCallback(() => {
    if (stateRef.current !== 'closed') return;
    pending.current = null;
    setState('open');
  }, [setState]);
  const close = useCallback(() => {
    if (stateRef.current !== 'open') return;
    pending.current = null;
    setState('closing');
  }, [setState]);
  const choose = useCallback(
    (choice: T) => {
      if (stateRef.current !== 'open') return;
      pending.current = { choice };
      setState('closing');
    },
    [setState],
  );
  const onDismissed = useCallback(() => {
    if (stateRef.current !== 'closing') return;
    setState('closed');
    const chosen = pending.current;
    pending.current = null;
    if (chosen) runRef.current(chosen.choice);
  }, [setState]);

  return {
    mounted: state !== 'closed',
    visible: state === 'open',
    open,
    close,
    choose,
    onDismissed,
  };
}

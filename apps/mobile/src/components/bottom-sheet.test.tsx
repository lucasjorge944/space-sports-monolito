import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Pressable } from 'react-native';
import { BottomSheet, IOS_DISMISS_FALLBACK_MS, useMenuSheet } from './bottom-sheet';
import { Text } from './ui/text';

// Modal "de verdade" para o teste: o conteúdo continua na tela depois de `visible` falso (como no iOS,
// em que a folha desce animada até o `onDismiss`), e a última prop `onDismiss` fica guardada para o
// teste simular o fim da animação.
const mockModal: { visible?: boolean; onDismiss?: () => void } = {};
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function MockModal(props: { visible?: boolean; onDismiss?: () => void; children?: unknown }) {
    mockModal.visible = props.visible;
    mockModal.onDismiss = props.onDismiss;
    return createElement(View, { testID: 'modal' }, props.children);
  }
  return { __esModule: true, default: MockModal };
});
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function Menu({ run }: { run: (choice: string) => void }) {
  const menu = useMenuSheet<string>(run);
  return (
    <>
      <Pressable testID="abrir" onPress={menu.open} />
      {menu.mounted ? (
        <BottomSheet
          visible={menu.visible}
          title="Menu"
          onClose={menu.close}
          onDismissed={menu.onDismissed}
        >
          <Pressable testID="escolher" onPress={() => menu.choose('excluir')}>
            <Text>Excluir</Text>
          </Pressable>
          <Pressable testID="editar" onPress={() => menu.choose('editar')}>
            <Text>Editar</Text>
          </Pressable>
        </BottomSheet>
      ) : null}
    </>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useMenuSheet (ação depois que a folha fecha)', () => {
  it('no iOS, a escolha só roda depois que a folha some', async () => {
    expect(Platform.OS).toBe('ios');
    const run = jest.fn();
    await render(<Menu run={run} />);
    await fireEvent.press(screen.getByTestId('abrir'));
    await fireEvent.press(screen.getByTestId('escolher'));
    // A folha já está fechando, mas a ação espera o fim da animação (onDismiss do Modal ou a reserva).
    expect(mockModal.visible).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(IOS_DISMISS_FALLBACK_MS));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('excluir');
  });

  it('no iOS, roda no onDismiss do Modal, uma vez só (a reserva não repete)', async () => {
    const run = jest.fn();
    await render(<Menu run={run} />);
    await fireEvent.press(screen.getByTestId('abrir'));
    await fireEvent.press(screen.getByTestId('escolher'));
    await act(() => jest.advanceTimersByTime(IOS_DISMISS_FALLBACK_MS - 100));
    expect(run).not.toHaveBeenCalled();
    await act(() => mockModal.onDismiss?.());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('excluir');
    expect(screen.queryByTestId('modal')).toBeNull();
    await act(() => jest.advanceTimersByTime(IOS_DISMISS_FALLBACK_MS));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['o fundo', 'Fechar'],
    ['outra ação', 'editar'],
  ])('tocar %s durante o fechamento não troca nem apaga a escolha', async (_caso, alvo) => {
    const run = jest.fn();
    await render(<Menu run={run} />);
    await fireEvent.press(screen.getByTestId('abrir'));
    await fireEvent.press(screen.getByTestId('escolher'));
    // A folha ainda está na tela, descendo: o segundo toque é ignorado.
    await fireEvent.press(
      alvo === 'Fechar' ? screen.getByLabelText('Fechar') : screen.getByTestId(alvo),
    );
    await act(() => mockModal.onDismiss?.());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('excluir');
  });

  it('fechar sem escolher não roda nada', async () => {
    const run = jest.fn();
    await render(<Menu run={run} />);
    await fireEvent.press(screen.getByTestId('abrir'));
    await fireEvent.press(screen.getByLabelText('Fechar'));
    await act(() => jest.advanceTimersByTime(IOS_DISMISS_FALLBACK_MS));
    expect(run).not.toHaveBeenCalled();
    // Abre de novo normalmente.
    await fireEvent.press(screen.getByTestId('abrir'));
    expect(screen.getByTestId('escolher')).toBeTruthy();
  });

  it('nas outras plataformas, roda no tick seguinte', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const run = jest.fn();
    await render(<Menu run={run} />);
    await fireEvent.press(screen.getByTestId('abrir'));
    await fireEvent.press(screen.getByTestId('escolher'));
    await act(() => jest.advanceTimersByTime(0));
    expect(run).toHaveBeenCalledWith('excluir');
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MyPaymentsScreen } from './my-payments-screen';
import { myPayment } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
const mockList = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  listMyPayments: (...args: unknown[]) => mockList(...args),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyPaymentsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockPush.mockReset();
});

describe('Meus pagamentos (RF-ONPAY-06)', () => {
  it('lista por mês, avisa que não existe saldo e abre o comprovante', async () => {
    mockList.mockResolvedValue({
      items: [
        myPayment(),
        myPayment({
          id: 'oc9',
          status: 'FAILED',
          method: 'CARD',
          createdAt: '2026-10-03T12:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    await renderScreen();
    expect(await screen.findByText('Novembro de 2026')).toBeTruthy();
    expect(screen.getByText('Outubro de 2026')).toBeTruthy();
    expect(screen.getByText(/não existe saldo no Space Sports/)).toBeTruthy();
    expect(screen.queryByText(/carteira|crédito/i)).toBeNull();
    expect(screen.getByTestId('meus-pagamentos-item-oc9')).toHaveTextContent(/Recusado/);
    await fireEvent.press(screen.getByTestId('meus-pagamentos-item-oc1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/meus-pagamentos/[id]',
      params: { id: 'oc1' },
    });
  });

  it('o filtro vai para a API e, sem nada, oferece "Ver todos"', async () => {
    mockList.mockResolvedValueOnce({ items: [myPayment()], nextCursor: null });
    mockList.mockResolvedValue({ items: [], nextCursor: null });
    await renderScreen();
    await screen.findByTestId('meus-pagamentos-item-oc1');
    await fireEvent.press(screen.getByTestId('meus-pagamentos-filtro-refunds'));
    expect(await screen.findByText('Nada com este filtro')).toBeTruthy();
    expect(mockList).toHaveBeenLastCalledWith(
      { status: ['PARTIALLY_REFUNDED', 'REFUNDED'], limit: 20 },
      expect.anything(),
    );
  });

  it('vazio sem filtro explica como o pagamento aparece aqui', async () => {
    mockList.mockResolvedValue({ items: [], nextCursor: null });
    await renderScreen();
    expect(await screen.findByText('Nenhum pagamento pelo app ainda')).toBeTruthy();
  });

  it('pagina pelo cursor', async () => {
    mockList
      .mockResolvedValueOnce({ items: [myPayment()], nextCursor: 'c2' })
      .mockResolvedValue({ items: [myPayment({ id: 'oc2' })], nextCursor: null });
    await renderScreen();
    await screen.findByTestId('meus-pagamentos-item-oc1');
    await fireEvent(screen.getByTestId('meus-pagamentos-lista'), 'onEndReached');
    expect(await screen.findByTestId('meus-pagamentos-item-oc2')).toBeTruthy();
    expect(mockList).toHaveBeenLastCalledWith({ limit: 20, cursor: 'c2' }, expect.anything());
  });
});

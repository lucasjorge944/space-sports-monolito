import type { PlayerBookingDto } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { booking } from '@/features/booking/test-fixtures';
import { MyBookingsScreen } from './my-bookings-screen';

const mockRefetch = jest.fn();
const mockPush = jest.fn();
let mockFocus: (() => void) | undefined;
let mockItems: PlayerBookingDto[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    mockFocus = effect;
  },
}));
jest.mock('@/components/screen', () => ({
  Screen: jest.requireActual('react-native').View,
}));
jest.mock('@/features/auth/session', () => ({ useMe: () => ({ id: 'u1' }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceBySlug: () => ({ data: undefined, isPending: true }),
}));
jest.mock('@/features/classes/my-classes-section', () => ({ MyClassesSection: () => null }));
jest.mock('./use-my-bookings', () => ({
  useMyBookings: () => ({
    data: { pages: [{ items: mockItems }] },
    isPending: false,
    isError: false,
    refetch: mockRefetch,
  }),
}));

beforeEach(() => {
  mockItems = [];
  mockPush.mockReset();
});

describe('Minhas reservas', () => {
  it('aguardando pagamento fica no topo, com "Pague até" e "Pagar agora" (RF-ONPAY-04)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-02T12:32:00.000Z') });
    mockItems = [
      booking({ id: 'b2' }),
      booking({
        id: 'b1',
        status: 'PENDING_PAYMENT',
        paymentDueAt: '2026-11-02T12:47:00.000Z',
        openOnlineCharge: {
          id: 'oc1',
          method: 'PIX',
          expiresAt: '2099-11-02T12:47:00.000Z',
          createdAt: '2026-11-02T12:32:00.000Z',
        },
      } as Partial<PlayerBookingDto>),
    ];
    await render(<MyBookingsScreen />);
    const section = screen.getByTestId('agenda-aguardando-pagamento');
    expect(section).toHaveTextContent(/Aguardando pagamento/);
    expect(section).toHaveTextContent(/Pague até 09:47/);
    // Com o Pix aberto e no prazo, volta para o mesmo código.
    await fireEvent.press(screen.getByTestId('reserva-card-b1-pagar'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/reserva/pagar/[id]',
      params: { id: 'b1', forma: 'pix' },
    });
    jest.useRealTimers();
  });

  it('cancelada por falta de pagamento: "Pagamento não feito no prazo"', async () => {
    mockItems = [booking({ id: 'b3', status: 'CANCELLED', cancelReason: 'PAYMENT_EXPIRED' })];
    await render(<MyBookingsScreen />);
    expect(screen.getByTestId('reserva-card-b3-sem-pagamento')).toHaveTextContent(
      'Pagamento não feito no prazo',
    );
    expect(screen.queryByTestId('agenda-aguardando-pagamento')).toBeNull();
  });

  it('relê ao voltar à aba: a reserva vinculada entra por fora do app (RF-CONTACT-04)', async () => {
    await render(<MyBookingsScreen />);
    mockFocus?.();
    expect(mockRefetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });
});

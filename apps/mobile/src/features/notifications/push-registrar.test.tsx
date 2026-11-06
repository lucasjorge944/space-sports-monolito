import { render } from '@testing-library/react-native';
import { PushRegistrar } from './push-registrar';

const mockInvalidate = jest.fn();
const mockPush = jest.fn();
type Listener = (value: unknown) => void;
let mockReceived: Listener;
let mockResponse: Listener;

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('./push-device', () => ({ registerPushDevice: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationReceivedListener: (listener: Listener) => {
    mockReceived = listener;
    return { remove: jest.fn() };
  },
  addNotificationResponseReceivedListener: (listener: Listener) => {
    mockResponse = listener;
    return { remove: jest.fn() };
  },
}));

const bookingId = '0192f0a0-0000-7000-8000-000000000001';
const notification = (data: unknown) => ({ request: { identifier: 'n1', content: { data } } });

describe('PushRegistrar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reserva vinculada com o app aberto atualiza Minhas reservas e o detalhe', async () => {
    await render(<PushRegistrar userId="u1" />);
    mockReceived(notification({ bookingId }));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['/v1/me/notifications'] });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['/v1/bookings'] });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: [`/v1/bookings/${bookingId}`] });
  });

  it('aviso sem reserva atualiza só as notificações', async () => {
    await render(<PushRegistrar userId="u1" />);
    mockReceived(notification({ subscriptionId: bookingId }));
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it('tocar na notificação da reserva vinculada abre a reserva', async () => {
    await render(<PushRegistrar userId="u1" />);
    mockResponse({ notification: notification({ bookingId }) });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/reserva/[id]', params: { id: bookingId } });
  });
});

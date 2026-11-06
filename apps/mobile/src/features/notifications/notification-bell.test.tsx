import { fireEvent, render, screen } from '@testing-library/react-native';
import { NotificationBell, unreadBadge } from './notification-bell';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
let mockUnread = 0;
let mockFocus: (() => void) | undefined;

jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    mockFocus = effect;
  },
}));
jest.mock('./use-notifications', () => ({
  useUnreadCount: () => mockUnread,
  useRefreshUnreadCount: () => mockRefresh,
}));

describe('sino de notificações (RF-NOTIF-04)', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
  });

  it('sem não lidas, não mostra contador', async () => {
    mockUnread = 0;
    await render(<NotificationBell />);
    expect(screen.queryByTestId('notificacoes-contador')).toBeNull();
    expect(screen.getByLabelText('Notificações')).toBeTruthy();
  });

  it('mostra o contador e diz quantas são', async () => {
    mockUnread = 3;
    await render(<NotificationBell />);
    expect(screen.getByTestId('notificacoes-contador').props.children).toBe('3');
    expect(screen.getByLabelText('Notificações, 3 não lidas')).toBeTruthy();
  });

  it('abre a central', async () => {
    mockUnread = 1;
    await render(<NotificationBell />);
    await fireEvent.press(screen.getByTestId('notificacoes-sino'));
    expect(mockPush).toHaveBeenCalledWith('/notificacoes');
  });

  it('relê o contador ao voltar para a aba', async () => {
    await render(<NotificationBell />);
    mockFocus?.();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('limita o selo em 99+', () => {
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(120)).toBe('99+');
  });
});

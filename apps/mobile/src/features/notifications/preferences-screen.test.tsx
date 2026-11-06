import {
  type MeResponse,
  type NotificationPreferences,
  NotificationPreferencesItemsItemType,
} from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PREFERENCE_LABELS } from './labels';
import { NotificationPreferencesScreen } from './preferences-screen';

const mockMutate = jest.fn();
let mockMe: Pick<MeResponse, 'memberships'>;
let mockData: { items: { type: string; push: boolean; inApp: boolean }[] };

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('@/features/auth/session', () => ({ useMe: () => mockMe }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetNotificationPreferences: () => ({
    data: mockData as NotificationPreferences,
    isPending: false,
    isError: false,
  }),
  useUpdateNotificationPreferences: () => ({ mutate: mockMutate, isError: false }),
}));

const item = (type: string) => ({ type, push: true, inApp: true });
const withRoles = (...roles: MeResponse['memberships'][number]['roles']) => ({
  memberships: [
    {
      space: {
        id: 's1',
        name: 'Arena 7',
        slug: 'arena-7',
        status: 'ACTIVE' as const,
        logoUrl: null,
      },
      roles,
    },
  ],
});

const STAFF_TITLE = 'Reservas alteradas no espaço';

describe('preferências de notificação (RF-NOTIF-04)', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockData = { items: [item('BOOKING_UPDATED'), item('SPACE_BOOKING_UPDATED')] };
  });

  it('todo tipo da API tem rótulo, inclusive os do cancelamento do plano', async () => {
    expect(Object.keys(PREFERENCE_LABELS).sort()).toEqual(
      Object.values(NotificationPreferencesItemsItemType).sort(),
    );
    mockMe = { memberships: [] };
    mockData = { items: [item('SUBSCRIPTION_CANCELLED'), item('SUBSCRIPTION_CANCEL_RESUMED')] };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Plano cancelado')).toBeTruthy();
    expect(screen.getByText('Cancelamento desfeito')).toBeTruthy();
  });

  it('tipo desconhecido (app antigo com API nova) fica de fora sem derrubar a tela', async () => {
    mockMe = { memberships: [] };
    mockData = { items: [item('TIPO_DO_FUTURO'), item('BOOKING_UPDATED')] };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Reserva alterada')).toBeTruthy();
    expect(screen.queryByText(/TIPO_DO_FUTURO/)).toBeNull();
  });

  it('quem não é da gestão não vê o aviso de reservas do espaço', async () => {
    mockMe = { memberships: [] };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Reserva alterada')).toBeTruthy();
    expect(screen.queryByText(STAFF_TITLE)).toBeNull();
  });

  it('jogador vê os avisos do pagamento, não os da gestão (RN-ONPAY-08)', async () => {
    mockMe = withRoles('TEACHER');
    mockData = {
      items: [
        'PAYMENT_CONFIRMED',
        'PAYMENT_REFUNDED',
        'PAYMENT_CHARGEBACK',
        'MERCHANT_PAYOUT_CHANGE_REJECTED',
      ].map(item),
    };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Pagamento confirmado')).toBeTruthy();
    expect(screen.getByText('Estorno')).toBeTruthy();
    expect(screen.queryByText('Contestação no cartão')).toBeNull();
    expect(screen.queryByText('Troca de conta recusada')).toBeNull();
  });

  it('Dono vê os avisos do pagamento da gestão', async () => {
    mockMe = withRoles('OWNER');
    mockData = {
      items: [
        'PAYMENT_CONFIRMED',
        'PAYMENT_REFUNDED',
        'PAYMENT_CHARGEBACK',
        'MERCHANT_PAYOUT_CHANGE_REJECTED',
      ].map(item),
    };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Contestação no cartão')).toBeTruthy();
    expect(screen.getByText('Troca de conta recusada')).toBeTruthy();
  });

  it('avaliações (RF-REVIEW-09): pedido e resposta para todos; avaliação nova só para Dono e Admin', async () => {
    mockData = { items: ['REVIEW_REQUEST', 'REVIEW_REPLIED', 'REVIEW_CREATED'].map(item) };
    mockMe = withRoles('TEACHER');
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Pedido de avaliação')).toBeTruthy();
    expect(screen.getByText('Resposta à sua avaliação')).toBeTruthy();
    expect(screen.queryByText('Avaliação nova')).toBeNull();

    mockMe = withRoles('ADMIN');
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Avaliação nova')).toBeTruthy();
  });

  it('Professor também não vê: esse aviso nunca chega para ele', async () => {
    mockMe = withRoles('TEACHER');
    await render(<NotificationPreferencesScreen />);
    expect(screen.queryByText(STAFF_TITLE)).toBeNull();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    '%s vê e altera o aviso de reservas do espaço',
    async (role) => {
      mockMe = withRoles(role);
      await render(<NotificationPreferencesScreen />);
      expect(screen.getByText(STAFF_TITLE)).toBeTruthy();

      await fireEvent(
        screen.getByLabelText(`${STAFF_TITLE}: aviso no celular`),
        'valueChange',
        false,
      );
      expect(mockMutate).toHaveBeenCalledWith({
        data: { items: [{ type: 'SPACE_BOOKING_UPDATED', push: false }] },
      });
    },
  );

  it('tipo que esta versão do app não conhece fica de fora, sem derrubar a tela', async () => {
    mockMe = { memberships: [] };
    mockData = { items: [item('TIPO_DE_UMA_VERSAO_NOVA'), item('BOOKING_UPDATED')] };
    await render(<NotificationPreferencesScreen />);
    expect(screen.getByText('Reserva alterada')).toBeTruthy();
    expect(screen.queryByText('TIPO_DE_UMA_VERSAO_NOVA')).toBeNull();
  });
});

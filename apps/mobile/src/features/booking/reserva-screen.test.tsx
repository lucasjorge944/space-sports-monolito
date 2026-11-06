import type { PlayerBookingDetailDto } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ReservaScreen from '@/app/reserva/[id]';
import { booking } from './test-fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));
jest.mock('@/features/auth/session', () => ({ useMe: () => ({ id: 'u1', memberships: [] }) }));
jest.mock('@/features/bookings/booking-actions', () => ({ BookingActions: () => null }));
jest.mock('@/features/booking/invite-section', () => ({ InviteSection: () => null }));
// O card de avaliação tem teste próprio (review-prompt-card.test.tsx); aqui só onde ele aparece.
jest.mock('@/features/reviews/review-prompt-card', () => ({
  ...jest.requireActual('@/features/reviews/review-prompt-card'),
  ReviewPromptCard: ({ testID }: { testID: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID={testID}>card de avaliação</Text>;
  },
}));

let mockBooking: PlayerBookingDetailDto;
let mockSpaceOptions: { query?: { enabled?: boolean } } | undefined;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMyBooking: () => ({ data: mockBooking, isPending: false, isError: false }),
  useCancelMyBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateMyBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useGetSpaceAvailability: () => ({ data: undefined, isPending: true, isError: false }),
  useGetMyPayment: () => ({ data: undefined, isPending: true, isError: false }),
  useGetSpaceBySlug: (_slug: string, options?: { query?: { enabled?: boolean } }) => {
    mockSpaceOptions = options;
    return {
      data: (require('./test-fixtures') as typeof import('./test-fixtures')).space({
        whatsapp: '+5531999998888',
      }),
      isError: false,
      error: null,
      refetch: jest.fn(),
    };
  },
}));

const started = {
  canEditPeople: false,
  peopleEditBlock: { code: 'BOOKING_STARTED', message: 'A reserva já começou. Fale com o espaço.' },
  canEditSchedule: false,
  scheduleEditBlock: { code: 'BOOKING_EDIT_DEADLINE_PASSED', message: 'O prazo terminou.' },
} as const;

describe('detalhe da reserva: editar (RF-BOOK-03)', () => {
  it('com permissão mostra "Editar reserva", que abre a folha', async () => {
    mockBooking = booking();
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-sem-edicao')).toBeNull();
    expect(screen.queryByTestId('editar-confirmar')).toBeNull();
    await fireEvent.press(screen.getByTestId('reserva-editar'));
    expect(screen.getByTestId('editar-confirmar')).toBeTruthy();
  });

  it('só com o horário liberado também mostra o botão', async () => {
    mockBooking = booking({
      canEditPeople: false,
      peopleEditBlock: { code: 'BOOKING_STARTED', message: 'x' },
    });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-editar')).toBeTruthy();
  });

  it('sem permissão mostra o motivo da API e o WhatsApp do espaço', async () => {
    mockBooking = booking(started);
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-editar')).toBeNull();
    expect(screen.getByTestId('reserva-sem-edicao')).toHaveTextContent(/já começou/);
    expect(screen.getByTestId('reserva-whatsapp')).toBeTruthy();
  });

  it('espaço suspenso mostra o motivo, sem mandar falar com o espaço', async () => {
    const message = 'Este espaço não está aceitando alterações no momento.';
    mockBooking = booking({
      canEditPeople: false,
      peopleEditBlock: { code: 'SPACE_READ_ONLY', message },
      canEditSchedule: false,
      scheduleEditBlock: { code: 'SPACE_READ_ONLY', message },
    });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-sem-edicao')).toHaveTextContent(message);
    expect(screen.queryByTestId('reserva-whatsapp')).toBeNull();
  });

  it('convidado não vê edição nem motivo, e o espaço nem é buscado', async () => {
    const message = 'Só quem fez a reserva pode alterá-la.';
    mockBooking = booking({
      organizer: { userId: 'outra', name: 'Ana', phone: null },
      canEditPeople: false,
      peopleEditBlock: { code: 'NOT_BOOKING_ORGANIZER', message },
      canEditSchedule: false,
      scheduleEditBlock: { code: 'NOT_BOOKING_ORGANIZER', message },
    });
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-editar')).toBeNull();
    expect(screen.queryByTestId('reserva-sem-edicao')).toBeNull();
    expect(mockSpaceOptions?.query?.enabled).toBe(false);
  });
});

describe('detalhe da reserva: avalie sua experiência (RF-REVIEW-02)', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it('reserva confirmada que já terminou mostra o card', async () => {
    mockBooking = booking({ startsAt: hoursAgo(3), endsAt: hoursAgo(2) });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-avaliacao')).toBeTruthy();
  });

  it('reserva futura, cancelada ou no-show não mostra', async () => {
    mockBooking = booking({ startsAt: hoursAgo(-2), endsAt: hoursAgo(-3) });
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-avaliacao')).toBeNull();

    for (const status of ['CANCELLED', 'NO_SHOW'] as const) {
      mockBooking = booking({ status, startsAt: hoursAgo(3), endsAt: hoursAgo(2) });
      await render(<ReservaScreen />);
      expect(screen.queryByTestId('reserva-avaliacao')).toBeNull();
    }
  });

  it('reserva de mais de 6 meses não mostra', async () => {
    mockBooking = booking({ startsAt: hoursAgo(24 * 200), endsAt: hoursAgo(24 * 200 - 1) });
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-avaliacao')).toBeNull();
  });
});

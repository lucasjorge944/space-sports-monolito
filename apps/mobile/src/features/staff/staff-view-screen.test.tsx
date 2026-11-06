import type { BookingDetailDto, MeResponse, StaffSpacesResponse } from '@space-sports/api-client';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StaffViewScreen } from './staff-view-screen';

const mockMe = {
  id: '0192f0a0-0000-7000-8000-000000000001',
  memberships: [],
} as unknown as MeResponse;
jest.mock('@/features/auth/session', () => ({ useMe: () => mockMe }));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockStaff: { data?: StaffSpacesResponse; isPending: boolean; isError: boolean };
let mockBooking: {
  data?: BookingDetailDto;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
};
const mockGetBooking = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMyStaffSpaces: () => ({ ...mockStaff, refetch: jest.fn(), error: null }),
  useGetSpaceBooking: (spaceId: string, bookingId: string) => {
    mockGetBooking(spaceId, bookingId);
    return { ...mockBooking, refetch: jest.fn() };
  },
  useGetSpaceBySlug: () => ({
    data: {
      address: {
        street: 'Rua A',
        number: '1',
        neighborhood: null,
        postalCode: null,
        city: { id: 'c', name: 'Belo Horizonte', state: 'MG' },
      },
      phone: null,
      openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '22:00' }],
    },
  }),
}));

const staff = (items: StaffSpacesResponse['items']) => {
  mockStaff = { data: { items }, isPending: false, isError: false };
};

const SPACE = {
  id: 's1',
  name: 'Arena 7',
  slug: 'arena-7',
  status: 'ACTIVE',
  logoUrl: null,
  timeZone: 'America/Sao_Paulo',
} as const;

const BOOKING = {
  id: 'b1',
  court: { id: 'c1', name: 'Quadra 1' },
  sportName: 'Futevôlei',
  startsAt: '2026-10-29T22:00:00.000Z',
  endsAt: '2026-10-29T23:00:00.000Z',
  status: 'CONFIRMED',
  source: 'APP',
  peopleCount: 4,
  customerName: 'Bruno',
} as const;

const SESSION = {
  id: 'ses1',
  classGroup: { id: 'g1', name: 'Futevôlei iniciante' },
  sportName: 'Futevôlei',
  court: { id: 'c1', name: 'Quadra A' },
  teachers: [
    { name: 'Ana', avatarUrl: null },
    { name: 'Bia', avatarUrl: null },
  ],
  startsAt: '2026-10-29T22:00:00.000Z',
  endsAt: '2026-10-29T23:00:00.000Z',
  status: 'CLOSED',
  capacity: 10,
  confirmedCount: 3,
  waitlistCount: 1,
  attendees: [
    { userId: 'u3', name: 'Diego', avatarUrl: null, status: 'WAITLIST', waitlistPosition: 1 },
    { userId: 'u2', name: 'Carla', avatarUrl: null, status: 'ABSENT', waitlistPosition: null },
    { userId: 'u1', name: 'Bruno', avatarUrl: null, status: 'PRESENT', waitlistPosition: null },
    { userId: 'u4', name: 'Eva', avatarUrl: null, status: 'CANCELLED', waitlistPosition: null },
  ],
} as const;

const DETAIL = {
  id: 'b1',
  priceCents: 12_000,
  paidCents: 4_000,
  paymentStatus: 'PARTIALLY_PAID',
  intendedPaymentMethod: 'PIX',
  cancelReason: null,
  participants: [
    {
      id: 'p0',
      userId: 'u1',
      name: 'Bruno',
      isOrganizer: true,
      shareCents: 3_000,
      status: 'ACCEPTED',
    },
    {
      id: 'p1',
      userId: null,
      name: 'Carla',
      isOrganizer: false,
      shareCents: 3_000,
      status: 'INVITED',
    },
    {
      id: 'p2',
      userId: null,
      name: null,
      isOrganizer: false,
      shareCents: 3_000,
      status: 'ACCEPTED',
    },
  ],
} as unknown as BookingDetailDto;

const today = (
  roles: StaffSpacesResponse['items'][number]['roles'],
  bookings: StaffSpacesResponse['items'][number]['today']['bookings'],
  classSessions: StaffSpacesResponse['items'][number]['today']['classSessions'],
) => staff([{ space: SPACE, roles, today: { date: '2026-10-29', bookings, classSessions } }]);

describe('visão de equipe somente leitura (RN-AUTH-04)', () => {
  beforeEach(() => {
    mockGetBooking.mockClear();
    mockBooking = { data: DETAIL, isPending: false, isError: false };
  });

  it('mostra papel, reservas de hoje e informações', async () => {
    today(['ADMIN'], [{ ...BOOKING }], []);
    await render(<StaffViewScreen />);
    expect(screen.getByText('Seu papel: Admin')).toBeTruthy();
    const card = within(screen.getByTestId('equipe-reserva-b1'));
    expect(card.getByText('19:00')).toBeTruthy();
    expect(card.getByText('20:00')).toBeTruthy();
    expect(card.getByText('Bruno')).toBeTruthy();
    expect(card.getByText('Quadra 1 · Futevôlei')).toBeTruthy();
    expect(card.getByText('Confirmada')).toBeTruthy();
    expect(card.getByText('4 pessoas')).toBeTruthy();
    expect(screen.getByText('Rua A, 1 · Belo Horizonte/MG')).toBeTruthy();
    // O detalhe só é buscado ao tocar.
    expect(mockGetBooking).not.toHaveBeenCalled();
  });

  it('tocar na reserva abre cliente, pessoas, participantes e pagamento, sem ações', async () => {
    today(['ADMIN'], [{ ...BOOKING }], []);
    await render(<StaffViewScreen />);
    await fireEvent.press(screen.getByTestId('equipe-reserva-b1'));
    expect(mockGetBooking).toHaveBeenCalledWith('s1', 'b1');
    expect(screen.getByText('Cliente')).toBeTruthy();
    const participants = within(screen.getByTestId('equipe-reserva-participantes'));
    expect(participants.getByText('Participantes (2)')).toBeTruthy();
    expect(participants.getByText('Carla')).toBeTruthy();
    expect(participants.getByText('Sem nome')).toBeTruthy();
    expect(participants.queryByText('Bruno')).toBeNull();
    const payment = within(screen.getByTestId('equipe-reserva-pagamento'));
    expect(payment.getByText('Pago em parte')).toBeTruthy();
    expect(payment.getByText('R$ 120,00')).toBeTruthy();
    expect(payment.getByText('R$ 40,00')).toBeTruthy();
    expect(payment.getByText('Pix')).toBeTruthy();
    // Só o cartão da lista é tocável: decisão 21.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('o Professor vê participantes, sem pagamento nem valores', async () => {
    today(['TEACHER'], [{ ...BOOKING }], []);
    await render(<StaffViewScreen />);
    await fireEvent.press(screen.getByTestId('equipe-reserva-b1'));
    expect(screen.getByTestId('equipe-reserva-participantes')).toBeTruthy();
    expect(screen.queryByTestId('equipe-reserva-pagamento')).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it('o detalhe da reserva carrega e, na falha, oferece tentar de novo', async () => {
    today(['ADMIN'], [{ ...BOOKING }], []);
    mockBooking = { isPending: true, isError: false };
    const { rerender } = await render(<StaffViewScreen />);
    await fireEvent.press(screen.getByTestId('equipe-reserva-b1'));
    expect(screen.getByText('Carregando a reserva…')).toBeTruthy();
    mockBooking = {
      isPending: false,
      isError: true,
      error: new TypeError('Network request failed'),
    };
    await rerender(<StaffViewScreen />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
    // O que veio na lista continua na folha.
    expect(screen.getByText('Cliente')).toBeTruthy();
  });

  it('mostra as aulas de hoje com um professor e +N, sem valores (RF-CLASS-10)', async () => {
    today(
      ['TEACHER'],
      [],
      [{ ...SESSION, attendees: [...SESSION.attendees], teachers: [...SESSION.teachers] }],
    );
    await render(<StaffViewScreen />);
    expect(screen.getByText('Aulas de hoje')).toBeTruthy();
    const card = within(screen.getByTestId('equipe-aula-ses1'));
    expect(card.getByText('19:00')).toBeTruthy();
    expect(card.getByText('Futevôlei iniciante')).toBeTruthy();
    expect(card.getByText('Quadra A · Futevôlei')).toBeTruthy();
    expect(card.getByText('Prof. Ana +1')).toBeTruthy();
    expect(card.getByText('Lista encerrada')).toBeTruthy();
    expect(card.getByText('3/10 vagas · 1 na espera')).toBeTruthy();
    expect(screen.queryByText('Carla')).toBeNull();
  });

  it('tocar na aula abre professores, quadra, confirmados e espera, sem ações', async () => {
    today(
      ['TEACHER'],
      [],
      [{ ...SESSION, attendees: [...SESSION.attendees], teachers: [...SESSION.teachers] }],
    );
    await render(<StaffViewScreen />);
    await fireEvent.press(screen.getByTestId('equipe-aula-ses1'));
    expect(screen.getByTestId('equipe-aula-professores')).toHaveTextContent(/Ana e Bia/);
    const confirmed = within(screen.getByTestId('equipe-aula-confirmados'));
    const names = confirmed.getAllByText(/^(Bruno|Carla|Diego|Eva)$/).map((n) => n.props.children);
    // Presença em ordem alfabética; a espera vai para a lista dela; quem desistiu não aparece.
    expect(names).toEqual(['Bruno', 'Carla']);
    expect(confirmed.getByText('Presente')).toBeTruthy();
    expect(confirmed.getByText('Faltou')).toBeTruthy();
    const waitlist = within(screen.getByTestId('equipe-aula-espera'));
    expect(waitlist.getByText('Diego')).toBeTruthy();
    expect(waitlist.getByText('Na espera (1º)')).toBeTruthy();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.queryByText('Eva')).toBeNull();
    // Só o cartão da lista: nenhuma ação de gestão (abrir/fechar, marcar presença).
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sem aulas hoje avisa', async () => {
    staff([
      {
        space: {
          id: 's1',
          name: 'Arena 7',
          slug: 'arena-7',
          status: 'ACTIVE',
          logoUrl: null,
          timeZone: 'America/Sao_Paulo',
        },
        roles: ['OWNER'],
        today: { date: '2026-10-29', bookings: [], classSessions: [] },
      },
    ]);
    await render(<StaffViewScreen />);
    expect(screen.getByText('Nenhuma aula para hoje.')).toBeTruthy();
  });

  it('sem vínculo mostra o estado vazio', async () => {
    staff([]);
    await render(<StaffViewScreen />);
    expect(screen.getByText('Nenhum espaço vinculado')).toBeTruthy();
  });
});

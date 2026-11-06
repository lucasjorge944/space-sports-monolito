import { ApiError, type InvitePreviewDto } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ConviteScreen from '@/app/convite/[token]';

const mockReplace = jest.fn();
let mockToken = 'tok12345678';
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ token: mockToken }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
}));
const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

let mockSignedIn = true;
let mockName = 'Ana';
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({
    state: mockSignedIn
      ? {
          status: 'signed-in',
          // Decisão 66: o que falta vem da API em profile.missing.
          me: { name: mockName, profile: { missing: mockName ? [] : ['name'] } },
        }
      : { status: 'signed-out' },
  }),
}));

const mockSave = jest.fn();
jest.mock('@/features/invites/pending-invite', () => ({
  ...jest.requireActual('@/features/invites/pending-invite'),
  savePendingInvite: (token: string) => Promise.resolve(mockSave(token)),
}));

type Options = { mutation: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void } };
const mockAccept = jest.fn();
const mockDecline = jest.fn();
const mockRefetch = jest.fn();
let acceptOptions: Options;
let mockInvite: InvitePreviewDto;
let mockInviteEnabled: boolean | undefined;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetInvite: (_token: string, options: { query: { enabled: boolean } }) => {
    mockInviteEnabled = options.query.enabled;
    return {
      data: mockInvite,
      isPending: false,
      isError: false,
      refetch: (...args: unknown[]) => mockRefetch(...args),
    };
  },
  useAcceptInvite: (options: Options) => {
    acceptOptions = options;
    return { mutate: (...args: unknown[]) => mockAccept(...args), isPending: false };
  },
  useDeclineInvite: () => ({
    mutate: (...args: unknown[]) => mockDecline(...args),
    isPending: false,
  }),
}));

const invite = (
  over: Partial<InvitePreviewDto> = {},
  bookingOver: Partial<InvitePreviewDto['booking']> = {},
): InvitePreviewDto => ({
  participantId: 'p2',
  status: 'INVITED',
  shareCents: 5_000,
  acceptedByMe: false,
  slotTaken: false,
  forAnotherAccount: false,
  ...over,
  booking: {
    id: 'b1',
    space: { id: 's1', name: 'Arena 7', slug: 'arena-7', timeZone: 'America/Sao_Paulo' },
    court: { id: 'c1', name: 'Quadra A' },
    sport: { id: 'sp1', name: 'Futevôlei', slug: 'futevolei' },
    startsAt: '2099-11-02T13:00:00.000Z',
    endsAt: '2099-11-02T14:00:00.000Z',
    status: 'CONFIRMED',
    intendedPaymentMethod: null,
    organizerName: 'Bruno',
    ...bookingOver,
  },
});

describe('Deep link do convite (RF-BOOK-04, RF-CONTACT-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedIn = true;
    mockName = 'Ana';
    mockToken = 'tok12345678';
    mockInvite = invite();
  });

  it('deslogado guarda o token e leva ao login', async () => {
    mockSignedIn = false;
    await render(<ConviteScreen />);
    await fireEvent.press(screen.getByTestId('convite-entrar'));
    expect(mockSave).toHaveBeenCalledWith('tok12345678');
    expect(mockReplace).toHaveBeenCalledWith('/entrar');
  });

  it('logado com cadastro incompleto guarda o token e leva a completar o perfil, sem ir à API', async () => {
    mockName = '';
    await render(<ConviteScreen />);
    await act(async () => {});
    expect(mockSave).toHaveBeenCalledWith('tok12345678');
    expect(mockReplace).toHaveBeenCalledWith('/completar-perfil');
    expect(mockInviteEnabled).toBe(false);
    expect(screen.queryByTestId('convite-aceitar')).toBeNull();
  });

  it('token malformado não vai à API', async () => {
    mockToken = 'curto';
    await render(<ConviteScreen />);
    expect(screen.getByTestId('convite-invalido')).toBeTruthy();
    expect(screen.queryByTestId('convite-aceitar')).toBeNull();
  });

  it('pendente aceita e vai para a reserva, atualizando Minhas reservas', async () => {
    await render(<ConviteScreen />);
    await fireEvent.press(screen.getByTestId('convite-aceitar'));
    expect(mockAccept).toHaveBeenCalledWith({ token: 'tok12345678' });
    await act(async () => acceptOptions.mutation.onSuccess(invite()));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['/v1/bookings'] });
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/reserva/[id]', params: { id: 'b1' } });
  });

  it('convite direto a esta conta, pendente, ainda pode ser respondido', async () => {
    await render(<ConviteScreen />);
    expect(screen.getByTestId('convite-aceitar')).toBeTruthy();
    expect(screen.getByTestId('convite-recusar')).toBeTruthy();
    expect(screen.queryByText('Você já aceitou')).toBeNull();
  });

  it('quem confirmou sem conta traz a presença para a conta pelo mesmo aceite', async () => {
    mockInvite = invite({ status: 'ACCEPTED' });
    await render(<ConviteScreen />);
    expect(screen.queryByText('Você já aceitou')).toBeNull();
    expect(screen.queryByTestId('convite-ver-reserva')).toBeNull();
    await fireEvent.press(screen.getByTestId('convite-trazer-para-conta'));
    expect(mockAccept).toHaveBeenCalledWith({ token: 'tok12345678' });
  });

  it('vaga de outra pessoa não oferece trazer para a conta', async () => {
    mockInvite = invite({ status: 'ACCEPTED', slotTaken: true });
    await render(<ConviteScreen />);
    expect(screen.getByText('Vaga ocupada')).toBeTruthy();
    expect(screen.queryByText('Presença confirmada')).toBeNull();
    expect(screen.queryByTestId('convite-trazer-para-conta')).toBeNull();
    expect(screen.queryByTestId('convite-aceitar')).toBeNull();
    await fireEvent.press(screen.getByTestId('convite-inicio'));
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it('vaga ocupada depois da prévia mostra o erro e relê o convite', async () => {
    mockInvite = invite({ status: 'ACCEPTED' });
    await render(<ConviteScreen />);
    await fireEvent.press(screen.getByTestId('convite-trazer-para-conta'));
    const taken = new ApiError({
      status: 409,
      code: 'INVITE_SLOT_TAKEN',
      message: 'Esta vaga já foi preenchida por outra pessoa.',
    });
    await act(async () => acceptOptions.mutation.onError(taken));
    expect(screen.getByText('Esta vaga já foi preenchida por outra pessoa.')).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('já aceito por esta conta abre a reserva', async () => {
    mockInvite = invite({ status: 'ACCEPTED', acceptedByMe: true });
    await render(<ConviteScreen />);
    expect(screen.getByText('Você já aceitou')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('convite-ver-reserva'));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/reserva/[id]', params: { id: 'b1' } });
  });

  it.each([
    ['recusado', invite({ status: 'DECLINED' })],
    ['de reserva cancelada', invite({}, { status: 'CANCELLED' })],
    [
      'confirmado sem conta em reserva terminada',
      invite({ status: 'ACCEPTED' }, { endsAt: '2020-01-01T00:00:00.000Z' }),
    ],
  ])('convite %s volta ao início, sem abrir reserva que a pessoa não vê', async (_label, item) => {
    mockInvite = item;
    await render(<ConviteScreen />);
    expect(screen.queryByTestId('convite-aceitar')).toBeNull();
    expect(screen.queryByTestId('convite-trazer-para-conta')).toBeNull();
    await fireEvent.press(screen.getByTestId('convite-inicio'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

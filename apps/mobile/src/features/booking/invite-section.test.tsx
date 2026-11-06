import { ApiError, type PlayerBookingParticipantDto } from '@space-sports/api-client';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { InviteSection } from './invite-section';
import { booking } from './test-fixtures';

jest.mock('@/features/auth/session', () => ({ useMe: () => ({ id: 'u1' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const mockOpenLink = jest.fn();
jest.mock('@/features/space/links', () => ({
  openLink: (url: string) => mockOpenLink(url),
}));

type Options = {
  mutation: {
    onSuccess: (data?: unknown, variables?: unknown) => void;
    onError: (e: unknown) => void;
  };
};
const mockCreate = jest.fn();
const mockConfirmLink = jest.fn();
let createOptions: Options;
let linkOptions: Options;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useCreateBookingInvites: (options: Options) => {
    createOptions = options;
    return { mutate: (...args: unknown[]) => mockCreate(...args), isPending: false };
  },
  useConfirmInviteLink: (options: Options) => {
    linkOptions = options;
    return { mutate: (...args: unknown[]) => mockConfirmLink(...args), isPending: false };
  },
  useRevokeBookingInvite: () => ({ mutate: jest.fn(), isPending: false }),
}));

const guest = (over: Partial<PlayerBookingParticipantDto> = {}): PlayerBookingParticipantDto => ({
  id: 'p2',
  name: 'Ana',
  isOrganizer: false,
  isMe: false,
  shareCents: 5_000,
  status: 'INVITED',
  inviteToken: 'tok12345678',
  inviteUrl: 'https://app.exemplo/r/tok12345678',
  suggestedUser: null,
  hasAccount: false,
  ...over,
});

const onChanged = jest.fn();
const open = (participants: PlayerBookingParticipantDto[] = [], peopleCount = 3) =>
  render(<InviteSection booking={booking({ peopleCount, participants })} onChanged={onChanged} />);

/** Simula a resposta do POST com o convite novo, como o `useMutation` faria. */
const respond = async (phone?: string) => {
  await act(async () => {
    createOptions.mutation.onSuccess(booking({ participants: [guest()] }), {
      data: { items: [{ name: 'Ana', ...(phone ? { phone } : {}) }] },
    });
  });
};

describe('Convite com contato (RF-CONTACT-01)', () => {
  let share: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenLink.mockResolvedValue(true);
    share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  });

  it('explica para que serve o contato', async () => {
    await open();
    expect(screen.getByText(/convite abre direto na conversa/)).toBeTruthy();
  });

  it('mascara o WhatsApp enquanto digita e envia em E.164', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('convite-nome'), ' Ana ');
    await fireEvent.changeText(screen.getByTestId('convite-whatsapp'), '31999998888');
    expect(screen.getByTestId('convite-whatsapp').props.value).toBe('(31) 99999-8888');
    await fireEvent.press(screen.getByTestId('convite-enviar'));
    expect(mockCreate).toHaveBeenCalledWith({
      bookingId: 'b1',
      data: { items: [{ name: 'Ana', phone: '+5531999998888' }] },
    });
  });

  it('com WhatsApp, abre a conversa com o link e não usa o compartilhamento', async () => {
    await open();
    await respond('+5531999998888');
    await waitFor(() => expect(mockOpenLink).toHaveBeenCalledTimes(1));
    const url = new URL(mockOpenLink.mock.calls[0][0]);
    expect(url.pathname).toBe('/5531999998888');
    expect(url.searchParams.get('text')).toContain('https://app.exemplo/r/tok12345678');
    expect(share).not.toHaveBeenCalled();
  });

  it('sem WhatsApp, usa o compartilhamento do sistema', async () => {
    await open();
    await respond();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].message).toContain('https://app.exemplo/r/tok12345678');
    expect(mockOpenLink).not.toHaveBeenCalled();
  });

  it('sem app para abrir o wa.me, cai no compartilhamento', async () => {
    mockOpenLink.mockResolvedValue(false);
    await open();
    await respond('+5531999998888');
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  });

  it('se o compartilhamento falhar, avisa que o convite já existe', async () => {
    share.mockRejectedValue(new Error('falhou'));
    await open();
    await respond();
    expect(await screen.findByText(/Convite criado/)).toBeTruthy();
  });

  it('limpa o formulário depois de criar', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('convite-nome'), 'Ana');
    await respond();
    expect(screen.getByTestId('convite-nome').props.value).toBe('');
    expect(onChanged).toHaveBeenCalled();
  });

  it('exige o nome e recusa WhatsApp incompleto, sem chamar a API', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('convite-enviar'));
    expect(screen.getByText('Informe o nome do convidado')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('convite-nome'), 'Ana');
    await fireEvent.changeText(screen.getByTestId('convite-whatsapp'), '3199');
    await fireEvent.press(screen.getByTestId('convite-enviar'));
    expect(screen.getByText('Confira o WhatsApp, com DDD')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('"Convidar por link" cria uma vaga aberta, sem pedir dados', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('convite-por-link'));
    expect(mockCreate).toHaveBeenCalledWith({ bookingId: 'b1', data: { items: [{}] } });
  });

  it('não oferece convite com todas as vagas ocupadas', async () => {
    await open([guest()], 2);
    expect(screen.queryByTestId('convite-enviar')).toBeNull();
    expect(screen.getByText('Todas as vagas já têm convite.')).toBeTruthy();
  });

  it('erro da API aparece e relê a reserva', async () => {
    await open();
    await act(async () => {
      createOptions.mutation.onError(
        new ApiError({ status: 422, code: 'TOO_MANY_INVITES', message: 'x' }),
      );
    });
    expect(screen.getByText('Você já convidou todas as pessoas desta reserva.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('Status do convidado e vínculo sugerido (RF-CONTACT-05)', () => {
  const suggestedUser = { id: 'u2', firstName: 'Ana' };

  beforeEach(() => jest.clearAllMocks());

  it('vaga aberta aparece como vaga, com link para reenviar', async () => {
    await open([guest({ name: null })]);
    expect(screen.getByText('Vaga aberta')).toBeTruthy();
    expect(screen.getByTestId('convite-status-vaga-aberta')).toHaveTextContent('Aguardando');
    expect(screen.getByText('Compartilhar')).toBeTruthy();
  });

  it('mostra quem confirmou sem conta, com a ação de vincular', async () => {
    await open([guest({ status: 'ACCEPTED', inviteUrl: null, suggestedUser })]);
    expect(screen.getByTestId('convite-status-ana')).toHaveTextContent('Confirmado sem conta');
    await fireEvent.press(screen.getByText('É essa pessoa? Vincular'));
    expect(mockConfirmLink).toHaveBeenCalledWith({
      bookingId: 'b1',
      participantId: 'p2',
      data: { userId: 'u2' },
    });
  });

  it('vincular relê a reserva', async () => {
    await open([guest({ suggestedUser })]);
    await act(async () => linkOptions.mutation.onSuccess());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('sugestão vencida avisa e relê a lista', async () => {
    await open([guest({ suggestedUser })]);
    await act(async () =>
      linkOptions.mutation.onError(
        new ApiError({ status: 409, code: 'SUGGESTED_USER_MISMATCH', message: 'x' }),
      ),
    );
    expect(screen.getByText(/não é mais a sugerida/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('sem sugestão, não oferece vínculo', async () => {
    await open([guest({ status: 'ACCEPTED', inviteUrl: null })]);
    expect(screen.getByTestId('convite-status-ana')).toHaveTextContent('Confirmado sem conta');
    expect(screen.queryByText('É essa pessoa? Vincular')).toBeNull();
  });

  it('quem confirmou com conta aparece como no app', async () => {
    await open([guest({ status: 'ACCEPTED', inviteUrl: null, hasAccount: true })]);
    expect(screen.getByTestId('convite-status-ana')).toHaveTextContent('No app');
  });

  it('quem não organiza não vê sugestão nem formulário', async () => {
    await render(
      <InviteSection
        booking={booking({
          organizer: { userId: 'outro', name: 'Bruno', phone: null },
          peopleCount: 3,
          participants: [guest({ suggestedUser })],
        })}
        onChanged={onChanged}
      />,
    );
    expect(screen.queryByText('É essa pessoa? Vincular')).toBeNull();
    expect(screen.queryByTestId('convite-enviar')).toBeNull();
  });
});

import type { PlayerBookingDetailDto } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ReservaScreen from '@/app/reserva/[id]';
import { cardCharge, pixCharge, SANDBOX_ENV } from '@/features/payments/test-fixtures';
import { booking, space } from './test-fixtures';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: () => true,
};
let mockParams: Record<string, string> = { id: 'b1' };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
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
jest.mock('@/features/booking/invite-section', () => ({
  InviteSection: () => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID="convites">convites</Text>;
  },
}));

let mockBooking: PlayerBookingDetailDto;
let mockReceivedAt: number | undefined;
const mockCancel = jest.fn();
let mockPaymentDetail: unknown;
const mockOnlineSpace = space({
  onlinePayments: {
    rental: { mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] },
    classes: { mode: 'ON_SITE', options: ['ON_SITE'] },
  },
  paymentEnvironment: SANDBOX_ENV,
} as never);

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMyBooking: () => ({
    data: mockBooking,
    isPending: false,
    isError: false,
    dataUpdatedAt: mockReceivedAt,
  }),
  useCancelMyBooking: () => ({ mutate: mockCancel, isPending: false }),
  useUpdateMyBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useGetSpaceAvailability: () => ({ data: undefined, isPending: true, isError: false }),
  useGetMyPayment: () => ({ data: mockPaymentDetail, isPending: false, isError: false }),
  useGetSpaceBySlug: () => ({ data: mockOnlineSpace, isPending: false, isError: false }),
}));

const NOW = new Date('2026-11-02T12:00:00.000Z');

const pending = (extra: Partial<PlayerBookingDetailDto> = {}) =>
  booking({
    status: 'PENDING_PAYMENT',
    paymentDueAt: '2026-11-02T12:12:41.000Z',
    paymentStatus: 'PENDING',
    discountCents: 0,
    paidCents: 0,
    openOnlineCharge: null,
    onlinePayment: null,
    ...extra,
  } as Partial<PlayerBookingDetailDto>);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockParams = { id: 'b1' };
  mockReceivedAt = undefined;
  mockPaymentDetail = undefined;
  mockCancel.mockReset();
  mockRouter.push.mockReset();
  mockRouter.setParams.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('reserva aguardando pagamento (RF-ONPAY-04)', () => {
  it('mostra o prazo em hora e em contagem, o botão de pagar e esconde edição e convites', async () => {
    mockBooking = pending();
    await render(<ReservaScreen />);
    const card = screen.getByTestId('reserva-aguardando-pagamento');
    expect(card).toHaveTextContent(/Falta pagar para confirmar/);
    expect(card).toHaveTextContent(/guardado até 09:12/);
    expect(screen.getByTestId('reserva-prazo-contagem')).toHaveTextContent('Faltam 12:41');
    expect(screen.getByTestId('reserva-pagar')).toHaveTextContent(/Pagar R\$\s100,00/);
    expect(screen.queryByTestId('reserva-editar')).toBeNull();
    expect(screen.queryByTestId('convites')).toBeNull();
    expect(screen.queryByTestId('reserva-cancelar')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('reserva-prazo-contagem')).toHaveTextContent('Faltam 12:40');
  });

  it('a contagem usa o serverTime da reserva (aparelho com a hora errada)', async () => {
    // O aparelho está 3 min adiantado: a reserva chegou agora dizendo 11:57 no servidor.
    mockReceivedAt = NOW.getTime();
    mockBooking = pending({ serverTime: '2026-11-02T11:57:00.000Z' });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-prazo-contagem')).toHaveTextContent('Faltam 15:41');
  });

  it('com o Pix aberto e no prazo, "Pagar" volta para o mesmo código', async () => {
    mockBooking = pending({
      openOnlineCharge: {
        id: 'oc1',
        method: 'PIX',
        expiresAt: '2026-11-02T12:12:41.000Z',
        createdAt: '2026-11-02T11:57:41.000Z',
      },
    });
    await render(<ReservaScreen />);
    await fireEvent.press(screen.getByTestId('reserva-pagar'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/reserva/pagar/[id]',
      params: { id: 'b1', forma: 'pix' },
    });
  });

  it('sem cobrança aberta, "Pagar" abre a folha com Pix e cartão (sem "No local")', async () => {
    mockBooking = pending();
    await render(<ReservaScreen />);
    await fireEvent.press(screen.getByTestId('reserva-pagar'));
    expect(screen.getByTestId('pagar-opcao-pix')).toBeTruthy();
    expect(screen.getByTestId('pagar-opcao-cartao')).toBeTruthy();
    expect(screen.queryByTestId('pagar-opcao-local')).toBeNull();
    await fireEvent.press(screen.getByTestId('pagar-opcao-cartao'));
    await fireEvent.press(screen.getByTestId('pagar-continuar'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/reserva/pagar/[id]',
      params: { id: 'b1', forma: 'cartao' },
    });
  });

  it('"Desistir da reserva" confirma antes e cancela (decisão 96)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockBooking = pending();
    await render(<ReservaScreen />);
    await fireEvent.press(screen.getByTestId('reserva-desistir'));
    expect(alert.mock.calls[0]?.[0]).toBe('Desistir da reserva?');
    expect(alert.mock.calls[0]?.[1]).toMatch(/o valor volta sozinho/);
    alert.mock.calls[0]?.[2]?.find((b) => b.text === 'Desistir')?.onPress?.();
    expect(mockCancel).toHaveBeenCalledWith({ bookingId: 'b1', data: {} });
    alert.mockRestore();
  });

  it('vindo do formulário com Pix, abre a tela de pagamento por cima uma vez', async () => {
    mockParams = { id: 'b1', nova: '1', pagar: 'pix' };
    mockBooking = pending();
    await render(<ReservaScreen />);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/reserva/pagar/[id]',
      params: { id: 'b1', forma: 'pix' },
    });
  });

  it('cancelada por falta de pagamento: o motivo e "Reservar de novo"', async () => {
    mockBooking = pending({
      status: 'CANCELLED',
      cancelReason: 'PAYMENT_EXPIRED',
    });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-motivo-cancelamento')).toHaveTextContent(
      'O pagamento não foi feito até 09:12 e o horário foi liberado.',
    );
    await fireEvent.press(screen.getByTestId('reserva-reservar-de-novo'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/reservar',
      params: { slug: 'arena-7' },
    });
  });

  it('desistência mostra "Você desistiu antes de pagar."', async () => {
    mockBooking = pending({ status: 'CANCELLED', cancelReason: 'PAYMENT_ABANDONED' });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-motivo-cancelamento')).toHaveTextContent(
      'Você desistiu antes de pagar.',
    );
  });
});

describe('bloco "Pagamento" com o online', () => {
  const confirmed = (extra: Partial<PlayerBookingDetailDto> = {}) =>
    booking({
      startsAt: '2026-11-02T21:00:00.000Z',
      endsAt: '2026-11-02T22:00:00.000Z',
      cancellableUntil: '2026-11-02T20:00:00.000Z',
      paymentDueAt: null,
      discountCents: 0,
      openOnlineCharge: null,
      onlinePayment: null,
      ...extra,
    } as Partial<PlayerBookingDetailDto>);

  it('opcional sem pagar: "Pagar online" e "Ou pague no espaço no dia do jogo."', async () => {
    mockBooking = confirmed();
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-situacao-pagamento')).toHaveTextContent(
      'Pagamento pendente',
    );
    expect(screen.getByTestId('reserva-pagar-online')).toHaveTextContent(
      /Pagar online.*Ou pague no espaço no dia do jogo\./s,
    );
  });

  it('reserva de balcão (ou de mensalista) segue paga no local: sem "Pagar online"', async () => {
    mockBooking = confirmed({ source: 'DESK' } as Partial<PlayerBookingDetailDto>);
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-pagar-online')).toBeNull();
  });

  it('reserva que já começou (no relógio do servidor) não oferece pagar online', async () => {
    mockBooking = confirmed({
      startsAt: '2026-11-02T11:00:00.000Z',
      endsAt: '2026-11-02T12:30:00.000Z',
    });
    await render(<ReservaScreen />);
    expect(screen.queryByTestId('reserva-pagar-online')).toBeNull();
  });

  it('pago com cartão: "Pago com cartão final 1111 em 02/11 às 15:42" e o comprovante', async () => {
    mockBooking = confirmed({
      paymentStatus: 'PAID',
      paidCents: 10_000,
      onlinePayment: cardCharge({ paidAt: '2026-11-02T18:42:00.000Z' }),
    });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-situacao-pagamento')).toHaveTextContent('Pago');
    expect(screen.getByTestId('reserva-pago-online')).toHaveTextContent(
      /Pago com cartão final 1111 em 02\/11 às 15:42/,
    );
    expect(screen.queryByTestId('reserva-pagar-online')).toBeNull();
    await fireEvent.press(screen.getByTestId('reserva-ver-comprovante'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/meus-pagamentos/[id]',
      params: { id: 'oc2' },
    });
  });

  it('cancelar paga online avisa que o valor volta para o Pix', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockBooking = confirmed({
      paymentStatus: 'PAID',
      paidCents: 10_000,
      onlinePayment: pixCharge({
        status: 'PAID',
        amountCents: 10_000,
        paidAt: '2026-11-02T18:42:00.000Z',
      }),
    });
    await render(<ReservaScreen />);
    await fireEvent.press(screen.getByTestId('reserva-cancelar'));
    expect(alert.mock.calls[0]?.[1]).toMatch(/Os R\$\s100,00 voltam para o seu Pix\./);
    alert.mockRestore();
  });

  it('estorno parcial com abatimento: o devolvido com o motivo, sem "Falta pagar"', async () => {
    mockBooking = confirmed({
      paymentStatus: 'PAID',
      paidCents: 6_000,
      discountCents: 4_000,
      onlinePayment: pixCharge({
        status: 'PARTIALLY_REFUNDED',
        amountCents: 10_000,
        refundedCents: 4_000,
        paidAt: '2026-11-02T18:42:00.000Z',
      }),
    });
    mockPaymentDetail = {
      refunds: [
        {
          id: 'r1',
          kind: 'REFUND',
          status: 'SUCCEEDED',
          amountCents: 4_000,
          reason: 'Quadra sem iluminação',
          reasonCode: 'MANUAL',
          createdAt: '2026-11-02T19:00:00.000Z',
        },
      ],
    };
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-situacao-pagamento')).toHaveTextContent('Estorno parcial');
    const block = screen.getByTestId('reserva-estorno-parcial');
    expect(block).toHaveTextContent(/Devolvido em 02\/11/);
    expect(block).toHaveTextContent(/“Quadra sem iluminação”/);
    expect(block).not.toHaveTextContent(/Falta pagar/);
  });

  it('estorno parcial que volta a ser cobrado: "Falta pagar R$ 40,00 no espaço"', async () => {
    mockBooking = confirmed({
      paymentStatus: 'PARTIALLY_PAID',
      paidCents: 6_000,
      discountCents: 0,
      onlinePayment: pixCharge({
        status: 'PARTIALLY_REFUNDED',
        amountCents: 10_000,
        refundedCents: 4_000,
        paidAt: '2026-11-02T18:42:00.000Z',
      }),
    });
    mockPaymentDetail = { refunds: [] };
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-estorno-parcial')).toHaveTextContent(
      /Falta pagar R\$\s40,00 no espaço/,
    );
  });

  it('contestado no cartão: avisa que voltou a constar como não paga', async () => {
    mockBooking = confirmed({
      paymentStatus: 'PENDING',
      onlinePayment: cardCharge({ status: 'CHARGEBACK' }),
    });
    await render(<ReservaScreen />);
    expect(screen.getByTestId('reserva-situacao-pagamento')).toHaveTextContent(
      'Contestado no cartão',
    );
    expect(screen.getByTestId('reserva-contestado')).toHaveTextContent(/não paga/);
  });
});

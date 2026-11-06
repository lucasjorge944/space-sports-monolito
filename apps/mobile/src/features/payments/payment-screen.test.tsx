import { ApiError, type MyPaymentDetail } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { booking, space } from '@/features/booking/test-fixtures';
import { resetServerClock } from './countdown';
import { PaymentScreen } from './payment-screen';
import { cardCharge, myPaymentDetail, pixCharge, SANDBOX_ENV } from './test-fixtures';

const refund = (reasonCode: MyPaymentDetail['refunds'][number]['reasonCode']) => ({
  id: `r-${reasonCode}`,
  kind: 'REFUND' as const,
  status: 'SUCCEEDED' as const,
  amountCents: 12_000,
  reason: null,
  reasonCode,
  createdAt: '2026-11-08T21:49:00.000Z',
});

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  dismissTo: jest.fn(),
  replace: jest.fn(),
  canGoBack: () => true,
};
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('expo-image', () => ({ Image: () => null }));
const mockCopy = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (v: string) => mockCopy(v) }));

const mockGetPayment = jest.fn();
let mockReceipt: unknown;
const mockReceiptIds: string[] = [];
const mockPay = jest.fn();
let mockBooking = booking();
let mockBookingReceivedAt: number | undefined;
const sandboxSpace = () =>
  space({
    onlinePayments: {
      rental: { mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] },
      classes: { mode: 'ON_SITE', options: ['ON_SITE'] },
    },
    paymentEnvironment: SANDBOX_ENV,
  } as never);
let mockSpace = sandboxSpace();
let mockSubscription: unknown;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  getMyBookingPayment: (...args: unknown[]) => mockGetPayment(...args),
  useGetMyPayment: (id: string, options?: { query?: { enabled?: boolean } }) => {
    if (options?.query?.enabled) mockReceiptIds.push(id);
    return { data: options?.query?.enabled ? mockReceipt : undefined };
  },
  payMyBooking: (...args: unknown[]) => mockPay(...args),
  getMySubscriptionChargePayment: (...args: unknown[]) => mockGetPayment(...args),
  payMySubscriptionCharge: (...args: unknown[]) => mockPay(...args),
  useGetMyBooking: () => ({
    data: mockBooking,
    isPending: false,
    isError: false,
    dataUpdatedAt: mockBookingReceivedAt,
    refetch: jest.fn(),
  }),
  useGetMySubscription: () => ({
    data: mockSubscription,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useGetSpaceBySlug: () => ({ data: mockSpace, isPending: false }),
}));

const NOW = new Date('2026-11-08T21:32:00.000Z');

/**
 * Avança o relógio falso em passos curtos. Cada passo roda os timers e as promessas que eles
 * disparam (`advanceTimersByTimeAsync`) e o `act` renderiza antes do próximo, então o resultado
 * não depende da velocidade da máquina.
 */
async function tick(ms: number, step = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(() => jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed)));
  }
}
/** Clientes criados no teste, limpos no afterEach para nada vazar para o próximo. */
const queryClients: QueryClient[] = [];
function clearQueryClients() {
  for (const client of queryClients.splice(0)) client.clear();
}
const notFound = () => new ApiError({ status: 404, code: 'ONLINE_CHARGE_NOT_FOUND', message: 'x' });

function renderScreen(
  payable:
    | { type: 'BOOKING'; bookingId: string }
    | { type: 'SUBSCRIPTION_CHARGE'; subscriptionId: string; chargeId: string } = {
    type: 'BOOKING',
    bookingId: 'b1',
  },
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  queryClients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <PaymentScreen payable={payable} />
    </QueryClientProvider>,
  );
}

const requiredBooking = () =>
  booking({
    status: 'PENDING_PAYMENT',
    paymentDueAt: '2026-11-08T21:47:00.000Z',
    paymentStatus: 'PENDING',
    discountCents: 0,
    paidCents: 0,
    priceCents: 12_000,
    openOnlineCharge: null,
    onlinePayment: null,
  } as never);

/**
 * Aquecimento: o primeiro render carrega sob demanda boa parte do react-native (Animated,
 * TextInput, ScrollView…) e os ícones, e com o cache do Jest frio (CI) cada módulo passa pelo
 * Babel ali. Isso levava o primeiro teste além dos 5 s, e o teste estourado seguia rodando com
 * um act() aberto, derrubando os seguintes ("overlapping act() calls"). Pagamos esse custo uma
 * vez aqui, com prazo próprio, renderizando o Pix e o cartão.
 */
beforeAll(async () => {
  jest.useFakeTimers({ now: NOW });
  try {
    mockBooking = requiredBooking();
    mockGetPayment.mockResolvedValue(pixCharge());
    mockParams = { forma: 'pix' };
    await renderScreen();
    await screen.findByTestId('pix-copia-e-cola');
    await cleanup();
    mockGetPayment.mockRejectedValue(notFound());
    mockParams = { forma: 'cartao' };
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('cartao-teste-aprova'));
  } finally {
    await cleanup();
    clearQueryClients();
    jest.useRealTimers();
  }
}, 60_000);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetServerClock();
  mockParams = { forma: 'pix' };
  mockBooking = requiredBooking();
  mockSpace = sandboxSpace();
  mockSubscription = undefined;
  mockGetPayment.mockReset();
  mockReceipt = undefined;
  mockReceiptIds.length = 0;
  mockBookingReceivedAt = undefined;
  mockPay.mockReset();
  mockCopy.mockReset();
  Object.values(mockRouter).forEach((fn) => {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as jest.Mock).mockReset();
  });
});
afterEach(async () => {
  // Desmonta ainda com o relógio falso e descarta o cache e os timers pendentes deste teste.
  await cleanup();
  clearQueryClients();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('Pix (RF-ONPAY-03)', () => {
  it('retoma o Pix aberto: mesmo código, contagem e hora do prazo, sem gerar outro', async () => {
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    expect(await screen.findByTestId('pix-copia-e-cola')).toHaveTextContent(/fake-pix-code/);
    expect(screen.getByTestId('pix-contagem')).toHaveTextContent(/Pague em 15:00/);
    expect(screen.getByTestId('pix-contagem')).toHaveTextContent(/Horário guardado até 18:47/);
    expect(screen.getByTestId('pagamento-selo-teste')).toBeTruthy();
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('a contagem desce a cada segundo e vira alerta nos 3 últimos minutos', async () => {
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    await screen.findByTestId('pix-contagem');
    await act(async () => {
      jest.advanceTimersByTime(12 * 60_000 + 1_000);
    });
    expect(screen.getByTestId('pix-contagem')).toHaveTextContent(/Pague em 02:59/);
    expect(screen.getByTestId('pix-contagem')).toHaveTextContent(/O horário é liberado às 18:47/);
  });

  it('na hora do prazo mostra "Conferindo…" e, com a reserva cancelada, o prazo acabou', async () => {
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    await screen.findByTestId('pix-contagem');
    await act(async () => {
      jest.advanceTimersByTime(15 * 60_000);
    });
    expect(screen.getByTestId('pix-conferindo')).toBeTruthy();

    mockBooking = booking({
      ...requiredBooking(),
      status: 'CANCELLED',
      cancelReason: 'PAYMENT_EXPIRED',
    } as never);
    mockGetPayment.mockResolvedValue(pixCharge({ status: 'EXPIRED' }));
    // A próxima consulta (5 s) traz a reserva cancelada; o relógio avança em passos curtos.
    await tick(6_000);
    expect(await screen.findByTestId('pagamento-prazo-acabou')).toBeTruthy();
    expect(screen.getByText('O prazo para pagar acabou')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pagamento-reservar-de-novo'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/reservar',
      params: { slug: 'arena-7' },
    });
  });

  it('o relógio errado do aparelho não muda o prazo (usa o serverTime)', async () => {
    // O aparelho está 2 min adiantado: o servidor diz 21:30.
    mockGetPayment.mockResolvedValue(pixCharge({ serverTime: '2026-11-08T21:30:00.000Z' }));
    await renderScreen();
    await screen.findByTestId('pix-contagem');
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('pix-contagem')).toHaveTextContent(/Pague em 16:59/);
  });

  it('sem cobrança, gera o Pix uma vez com uma Idempotency-Key', async () => {
    mockGetPayment.mockRejectedValueOnce(notFound()).mockResolvedValue(pixCharge());
    mockPay.mockResolvedValue(pixCharge());
    await renderScreen();
    expect(await screen.findByTestId('pix-copia-e-cola')).toBeTruthy();
    expect(mockPay).toHaveBeenCalledTimes(1);
    const [bookingId, input, options] = mockPay.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(bookingId).toBe('b1');
    expect(input).toEqual({ method: 'PIX' });
    expect(options.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('502 pendente de verificação: consulta a cobrança em vez de criar outra', async () => {
    mockGetPayment.mockRejectedValueOnce(notFound()).mockResolvedValue(pixCharge({ pix: null }));
    mockPay.mockRejectedValue(
      new ApiError({
        status: 502,
        code: 'PAYMENT_GATEWAY_UNAVAILABLE',
        message: 'x',
        details: { chargeId: 'oc1', verification: 'PENDING' },
      }),
    );
    await renderScreen();
    await waitFor(() => expect(mockPay).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetPayment.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId('pix-aguardando')).toHaveTextContent(/Gerando o Pix/);
    mockGetPayment.mockResolvedValue(pixCharge());
    await tick(5_000);
    expect(await screen.findByTestId('pix-copia-e-cola')).toBeTruthy();
    expect(mockPay).toHaveBeenCalledTimes(1);
  });

  it('erro ao gerar mostra "Tentar de novo", com uma chave nova', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    mockPay.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'PAYMENT_IN_PROGRESS', message: 'x' }),
    );
    await renderScreen();
    expect(await screen.findByTestId('pagamento-erro')).toHaveTextContent(/pagamento em andamento/);
    mockPay.mockResolvedValue(pixCharge());
    await fireEvent.press(screen.getByTestId('pagamento-tentar-de-novo'));
    await waitFor(() => expect(mockPay).toHaveBeenCalledTimes(2));
    const keys = mockPay.mock.calls.map(
      (call) => (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('copia o código e mostra "Copiado!"', async () => {
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('pix-copiar'));
    expect(mockCopy).toHaveBeenCalledWith(pixCharge().pix?.copyPaste);
    expect(await screen.findByText('Copiado!')).toBeTruthy();
  });

  it('o push/consulta com o pagamento confirmado troca para "Pagamento confirmado"', async () => {
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    await screen.findByTestId('pix-copia-e-cola');
    mockGetPayment.mockResolvedValue(
      pixCharge({ status: 'PAID', paidAt: '2026-11-08T21:42:00.000Z' }),
    );
    await tick(5_000);
    expect(await screen.findByTestId('pagamento-confirmado')).toHaveTextContent(
      /R\$\s120,00 · Pix · 18:42/,
    );
    await fireEvent.press(screen.getByTestId('pagamento-ver-item'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: '/reserva/[id]',
      params: { id: 'b1' },
    });
  });

  it('pago depois do prazo: o motivo vem do reasonCode do estorno (decisão 96)', async () => {
    mockBooking = booking({
      ...requiredBooking(),
      status: 'CANCELLED',
      cancelReason: 'PAYMENT_EXPIRED',
    } as never);
    mockGetPayment.mockResolvedValue(
      pixCharge({ status: 'EXPIRED', paidAt: '2026-11-08T21:48:00.000Z' }),
    );
    mockReceipt = myPaymentDetail({
      status: 'EXPIRED',
      refunds: [refund('PAID_AFTER_DEADLINE')],
    });
    await renderScreen();
    const state = await screen.findByTestId('pagamento-estornado-sozinho');
    expect(state).toHaveTextContent(/O pagamento chegou depois do prazo/);
    expect(state).toHaveTextContent(
      /A reserva já tinha sido cancelada\. Os R\$\s120,00 voltam para o mesmo Pix/,
    );
    expect(mockReceiptIds).toContain('oc1');
  });

  it.each([
    ['PAID_AFTER_METHOD_CHANGE', /Você já tinha trocado de forma de pagamento/],
    ['ITEM_ALREADY_PAID', /Este item já estava pago/],
  ] as const)('estorno automático %s: o texto segue o motivo', async (reasonCode, text) => {
    mockBooking = booking({
      ...requiredBooking(),
      status: 'CONFIRMED',
      paymentDueAt: null,
    } as never);
    mockGetPayment.mockResolvedValue(
      pixCharge({ status: 'CANCELLED', paidAt: '2026-11-08T21:40:00.000Z' }),
    );
    mockReceipt = myPaymentDetail({ refunds: [refund(reasonCode)] });
    await renderScreen();
    const state = await screen.findByTestId('pagamento-estornado-sozinho');
    expect(state).toHaveTextContent(/Este pagamento chegou atrasado/);
    expect(state).toHaveTextContent(text);
  });

  it('estornada pelo cancelamento da reserva: "Pagamento estornado", não "chegou atrasado"', async () => {
    mockBooking = booking({
      ...requiredBooking(),
      status: 'CANCELLED',
      cancelReason: 'PAYMENT_EXPIRED',
    } as never);
    mockGetPayment.mockResolvedValue(
      pixCharge({ status: 'REFUNDED', paidAt: '2026-11-08T21:40:00.000Z', refundedCents: 12_000 }),
    );
    mockReceipt = myPaymentDetail({
      status: 'REFUNDED',
      refunds: [refund('BOOKING_CANCELLED_BY_PLAYER')],
    });
    await renderScreen();
    expect(await screen.findByTestId('pagamento-estornado')).toBeTruthy();
    expect(screen.queryByTestId('pagamento-estornado-sozinho')).toBeNull();
  });

  it('o hold conta pelo serverTime da reserva, não pelo da cobrança', async () => {
    // A reserva chegou agora dizendo 21:30 no servidor (aparelho 2 min adiantado); a cobrança
    // traz outro serverTime, que não vale para o hold.
    mockBookingReceivedAt = NOW.getTime();
    mockBooking = booking({
      ...requiredBooking(),
      serverTime: '2026-11-08T21:30:00.000Z',
    } as never);
    mockGetPayment.mockResolvedValue(pixCharge({ serverTime: '2026-11-08T21:32:00.000Z' }));
    await renderScreen();
    expect(await screen.findByTestId('pix-contagem')).toHaveTextContent(/Pague em 17:00/);
  });

  it('trocar para cartão com o Pix aberto pergunta antes (decisão 96)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetPayment.mockResolvedValue(pixCharge());
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('pix-pagar-cartao'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]?.[0]).toBe('Já pagou? Aguarde a confirmação');
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((b) => b.text === 'Trocar mesmo assim')?.onPress?.();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ forma: 'cartao' });
    alert.mockRestore();
  });
});

describe('cartão (RN-ONPAY-10)', () => {
  beforeEach(() => {
    mockParams = { forma: 'cartao' };
  });

  const fillWithTestCard = async (label: 'aprova' | 'recusa') => {
    await fireEvent.press(await screen.findByTestId(`cartao-teste-${label}`));
  };

  it('valida antes de enviar e não chama a API', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('cartao-pagar'));
    expect(screen.getByText('Confira o número do cartão')).toBeTruthy();
    expect(screen.getByText('Informe o código de segurança')).toBeTruthy();
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('manda só o token (nunca o número) e mostra "Pagamento aprovado"', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    mockPay.mockResolvedValue(cardCharge());
    await renderScreen();
    await fillWithTestCard('aprova');
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await waitFor(() => expect(mockPay).toHaveBeenCalledTimes(1));
    const [, input] = mockPay.mock.calls[0] as [string, { method: string; cardToken: string }];
    expect(input.method).toBe('CARD');
    expect(input.cardToken).toBe('tok_fake_approve_visa_1111');
    expect(JSON.stringify(mockPay.mock.calls[0])).not.toContain('4111111111111111');
    expect(await screen.findByText('Pagamento aprovado')).toBeTruthy();
    expect(screen.getByTestId('pagamento-confirmado')).toHaveTextContent(/Cartão final 1111/);
  });

  it('recusado: alerta, código limpo e nova tentativa na mesma reserva', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    const declined = cardCharge({
      status: 'FAILED',
      paidAt: null,
      cardLast4: '0002',
      failureReason: null,
    });
    mockPay.mockResolvedValueOnce(declined);
    await renderScreen();
    await fillWithTestCard('recusa');
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    expect(await screen.findByTestId('cartao-recusado')).toHaveTextContent(/O banco não autorizou/);
    expect(screen.getByTestId('cartao-cvv').props.value).toBe('');
    // Nova tentativa: outra chave, a mesma reserva.
    mockPay.mockResolvedValueOnce(cardCharge());
    await fillWithTestCard('aprova');
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await waitFor(() => expect(mockPay).toHaveBeenCalledTimes(2));
    expect(mockPay.mock.calls[1]?.[0]).toBe('b1');
  });

  it('sem resposta: confere a cobrança antes de deixar tentar de novo', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    mockPay.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await fillWithTestCard('aprova');
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    // As repetições automáticas (mesma chave) esperam 1,5 s cada.
    await tick(4_000);
    expect(
      await screen.findByText('Não conseguimos falar com o banco. Tente de novo.'),
    ).toBeTruthy();
    expect(mockPay).toHaveBeenCalledTimes(3);
    const keys = new Set(
      mockPay.mock.calls.map(
        (call) => (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
      ),
    );
    expect(keys.size).toBe(1);
    expect(mockGetPayment.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('sem resposta, mas a cobrança foi criada: mostra o resultado dela', async () => {
    mockGetPayment.mockRejectedValueOnce(notFound()).mockResolvedValue(cardCharge());
    mockPay.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await fillWithTestCard('aprova');
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await tick(4_000);
    expect(await screen.findByText('Pagamento aprovado')).toBeTruthy();
  });

  it('com o hold no fim, mostra o tempo que falta para pagar', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    await renderScreen();
    expect(await screen.findByTestId('cartao-prazo')).toHaveTextContent(
      /Horário guardado por mais 15:00/,
    );
  });
});

describe('sempre um estado final (revisão da PG.4)', () => {
  const subscriptionPayable = {
    type: 'SUBSCRIPTION_CHARGE' as const,
    subscriptionId: 'sub1',
    chargeId: 'ch2',
  };
  const withCharge = (extra: Record<string, unknown>) => {
    const { subscription } =
      require('@/features/classes/test-fixtures') as typeof import('@/features/classes/test-fixtures');
    const base = subscription();
    return {
      ...base,
      charges: base.charges.map((c) => (c.id === 'ch2' ? { ...c, ...extra } : c)),
    };
  };

  it.each([
    ['paga', { status: 'PAID', paidCents: 29_900, dueCents: 0 }],
    ['dispensada', { status: 'WAIVED', dueCents: 0 }],
    ['sem saldo', { status: 'PENDING', dueCents: 0 }],
  ])('mensalidade %s: "Nada a pagar", sem gerar Pix', async (_label, extra) => {
    mockParams = { forma: 'pix', plano: 'sub1' };
    mockSubscription = withCharge(extra);
    mockGetPayment.mockRejectedValue(notFound());
    await renderScreen(subscriptionPayable);
    expect(await screen.findByTestId('pagamento-nada-a-pagar')).toHaveTextContent(
      /Esta mensalidade já está paga/,
    );
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('ALREADY_PAID ao gerar o Pix (pago no local): "Nada a pagar", não "Gerando o Pix…"', async () => {
    mockGetPayment.mockRejectedValue(notFound());
    mockPay.mockRejectedValue(new ApiError({ status: 409, code: 'ALREADY_PAID', message: 'x' }));
    await renderScreen();
    expect(await screen.findByTestId('pagamento-nada-a-pagar')).toBeTruthy();
    expect(screen.queryByText('Gerando o Pix…')).toBeNull();
  });

  it('ALREADY_PAID com a cobrança paga: mostra o confirmado', async () => {
    mockGetPayment
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(pixCharge({ status: 'PAID', paidAt: '2026-11-08T21:31:00.000Z' }));
    mockPay.mockRejectedValue(new ApiError({ status: 409, code: 'ALREADY_PAID', message: 'x' }));
    await renderScreen();
    expect(await screen.findByTestId('pagamento-confirmado')).toBeTruthy();
  });

  it('Pix cancelado depois de gerado (troca em outro aparelho): estado final com "Gerar novo Pix"', async () => {
    mockGetPayment
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue(pixCharge({ status: 'CANCELLED' }));
    mockPay.mockResolvedValue(pixCharge({ status: 'CANCELLED' }));
    await renderScreen();
    expect(await screen.findByTestId('pagamento-pix-cancelado')).toBeTruthy();
    expect(mockPay).toHaveBeenCalledTimes(1);
    mockPay.mockResolvedValue(pixCharge());
    mockGetPayment.mockResolvedValue(pixCharge());
    await fireEvent.press(screen.getByTestId('pagamento-gerar-pix'));
    expect(await screen.findByTestId('pix-copia-e-cola')).toBeTruthy();
    expect(mockPay).toHaveBeenCalledTimes(2);
  });

  it('cartão: ALREADY_PAID leva a "Nada a pagar"', async () => {
    mockParams = { forma: 'cartao' };
    mockGetPayment.mockRejectedValue(notFound());
    mockPay.mockRejectedValue(new ApiError({ status: 409, code: 'ALREADY_PAID', message: 'x' }));
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('cartao-teste-aprova'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    expect(await screen.findByTestId('pagamento-nada-a-pagar')).toBeTruthy();
  });

  it('cartão: tentativa cancelada sem cobrar mostra o aviso no formulário', async () => {
    mockParams = { forma: 'cartao' };
    const cancelled = cardCharge({ id: 'oc8', status: 'CANCELLED', paidAt: null });
    mockGetPayment.mockRejectedValueOnce(notFound()).mockResolvedValue(cancelled);
    mockPay.mockResolvedValue(cancelled);
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('cartao-teste-aprova'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    expect(
      await screen.findByText('O pagamento não foi concluído e nada foi cobrado. Tente de novo.'),
    ).toBeTruthy();
  });

  it('sem o tokenizador, o cartão não deixa digitar: oferece o Pix', async () => {
    mockParams = { forma: 'cartao' };
    mockSpace = space({
      onlinePayments: {
        rental: { mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] },
        classes: { mode: 'ON_SITE', options: ['ON_SITE'] },
      },
      paymentEnvironment: { provider: 'acme', enabled: true, sandbox: null },
    } as never);
    mockGetPayment.mockRejectedValue(notFound());
    await renderScreen();
    expect(await screen.findByTestId('cartao-indisponivel')).toBeTruthy();
    expect(screen.queryByTestId('cartao-numero')).toBeNull();
  });

  it('sem resposta: a cobrança que já existia antes da tentativa não conta como criada', async () => {
    mockParams = { forma: 'cartao' };
    // A recusa anterior (oc2) continua sendo a mais recente: nada foi criado nesta tentativa.
    const previous = cardCharge({ status: 'FAILED', paidAt: null, createdAt: NOW.toISOString() });
    mockGetPayment.mockResolvedValue(previous);
    mockPay.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('cartao-teste-aprova'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await tick(4_000);
    expect(
      await screen.findByText('Não conseguimos falar com o banco. Tente de novo.'),
    ).toBeTruthy();
    expect(screen.queryByTestId('cartao-recusado')).toBeNull();
  });
});

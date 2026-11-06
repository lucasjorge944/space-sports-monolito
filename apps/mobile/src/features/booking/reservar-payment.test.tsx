import { ApiError, type PublicSpace } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ReservarScreen from '@/app/espaco/[slug]/reservar';
import { pixCharge, SANDBOX_ENV } from '@/features/payments/test-fixtures';
import { booking, space } from './test-fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ slug: 'arena-7' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));

let mockSpace: PublicSpace;
const mockCreate = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  createBooking: (...args: unknown[]) => mockCreate(...args),
  useGetSpaceBySlug: () => ({
    data: mockSpace,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useGetSpaceAvailability: () => ({
    data: (require('./test-fixtures') as typeof import('./test-fixtures')).availability([
      '2099-11-02T13:00:00.000Z',
      '2099-11-02T14:00:00.000Z',
    ]),
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    refetch: jest.fn(),
  }),
}));

const withModes = (rental: PublicSpace['onlinePayments']['rental']) =>
  space({
    sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
    acceptedPaymentMethods: ['PIX', 'CASH'],
    onlinePayments: { rental, classes: { mode: 'ON_SITE', options: ['ON_SITE'] } },
    paymentEnvironment: SANDBOX_ENV,
  } as Partial<PublicSpace>);

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReservarScreen />
    </QueryClientProvider>,
  );
}

async function pickSlot() {
  await fireEvent.press(await screen.findByTestId('reservar-horario-10:00'));
}

const keyOf = (call: unknown[]) =>
  (call[1] as { headers: Record<string, string> }).headers['Idempotency-Key'];

beforeEach(() => {
  mockCreate.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.push.mockReset();
});

describe('etapa de pagamento da reserva (RF-ONPAY-03)', () => {
  it('modo "só no local": como hoje, sem a etapa nova', async () => {
    mockSpace = withModes({ mode: 'ON_SITE', options: ['ON_SITE'] });
    await renderScreen();
    await pickSlot();
    expect(screen.queryByTestId('reservar-forma-pix')).toBeNull();
    expect(screen.getByTestId('reservar-pagamento-CASH')).toBeTruthy();
    expect(screen.getByTestId('reservar-confirmar')).toHaveTextContent('Confirmar reserva');
  });

  it('opcional: Pix marcado, cartão e "No local"; o resumo diz "Sem taxa extra no app."', async () => {
    mockSpace = withModes({
      mode: 'ONLINE_OPTIONAL',
      options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'],
    });
    await renderScreen();
    await pickSlot();
    expect(screen.getByTestId('reservar-forma-pix').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId('reservar-forma-cartao')).toBeTruthy();
    expect(screen.getByTestId('reservar-forma-local')).toBeTruthy();
    expect(screen.getByText('Sem taxa extra no app.')).toBeTruthy();
    expect(screen.getByTestId('reservar-confirmar')).toHaveTextContent('Pagar com Pix');
    expect(screen.getByTestId('pagamento-selo-teste')).toBeTruthy();

    // "No local" abre os chips da forma pretendida e volta ao botão de hoje.
    await fireEvent.press(screen.getByTestId('reservar-forma-local'));
    expect(screen.getByTestId('reservar-pagamento-CASH')).toBeTruthy();
    expect(screen.queryByText('Sem taxa extra no app.')).toBeNull();
    expect(screen.getByTestId('reservar-confirmar')).toHaveTextContent('Confirmar reserva');
  });

  it('obrigatório: sem "No local", aviso dos 15 min e "Reservar e pagar com Pix"', async () => {
    mockSpace = withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] });
    await renderScreen();
    await pickSlot();
    expect(screen.queryByTestId('reservar-forma-local')).toBeNull();
    expect(screen.getByTestId('reservar-pagamento-obrigatorio')).toHaveTextContent(/15 min/);
    expect(screen.getByTestId('reservar-confirmar')).toHaveTextContent('Reservar e pagar com Pix');
    await fireEvent.press(screen.getByTestId('reservar-forma-cartao'));
    expect(screen.getByTestId('reservar-confirmar')).toHaveTextContent(
      'Reservar e pagar com cartão',
    );
  });

  it('Pix: cria a reserva com a forma e a chave e abre o pagamento por cima do detalhe', async () => {
    mockSpace = withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] });
    mockCreate.mockResolvedValue(
      booking({ id: 'b9', status: 'PENDING_PAYMENT', onlinePayment: pixCharge() } as never),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [data] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(data.paymentOption).toBe('ONLINE_PIX');
    expect(data.cardToken).toBeUndefined();
    expect(keyOf(mockCreate.mock.calls[0] as unknown[])).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/reserva/[id]',
      params: { id: 'b9', nova: '1', pagar: 'pix' },
    });
  });

  it('cartão: o formulário vem antes, e só o token vai junto da reserva', async () => {
    mockSpace = withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] });
    mockCreate.mockResolvedValue(
      booking({
        id: 'b9',
        status: 'PENDING_PAYMENT',
        onlinePayment: pixCharge({ id: 'oc7', method: 'CARD', pix: null, status: 'FAILED' }),
      } as never),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-forma-cartao'));
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('reservar-titulo')).toHaveTextContent('Pagar com cartão');
    await fireEvent.press(screen.getByTestId('cartao-teste-recusa'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const [data] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(data.paymentOption).toBe('ONLINE_CARD');
    expect(data.cardToken).toBe('tok_fake_decline_visa_0002');
    expect(JSON.stringify(data)).not.toContain('4000000000000002');
    // Recusado ou aprovado, a nova tentativa vai para a cobrança dessa reserva.
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/reserva/[id]',
      params: { id: 'b9', nova: '1', pagar: 'cartao', cobranca: 'oc7' },
    });
  });

  it('422 de horário em cima da hora: pede outro horário', async () => {
    mockSpace = withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX'] });
    mockCreate.mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'BOOKING_TOO_SOON_FOR_ONLINE_PAYMENT',
        message: 'x',
        details: { minLeadMin: 5 },
      }),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    expect(
      await screen.findByText(/começa em menos de 5 minutos e não dá tempo de pagar/),
    ).toBeTruthy();
  });

  it('o espaço desligou o online no meio do caminho: recarrega as opções', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    mockCreate.mockRejectedValue(
      new ApiError({ status: 422, code: 'ONLINE_PAYMENT_UNAVAILABLE', message: 'x' }),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    expect(
      await screen.findByText(
        'Este espaço não aceita mais pagamento pelo app. Escolha outra forma.',
      ),
    ).toBeTruthy();
  });

  it('sem resposta: a próxima tentativa repete a mesma chave (a reserva pode ter sido criada)', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    mockCreate.mockRejectedValue(new ApiError({ status: 503, code: 'HTTP_ERROR', message: 'x' }));
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3), { timeout: 6000 });
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(6), { timeout: 6000 });
    const keys = new Set(mockCreate.mock.calls.map((call) => keyOf(call)));
    expect(keys.size).toBe(1);
  }, 20_000);

  it('a chave segue o pedido: outro horário depois de um erro gera outra chave', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    mockCreate.mockRejectedValue(
      new ApiError({ status: 409, code: 'SLOT_UNAVAILABLE', message: 'x' }),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await fireEvent.press(await screen.findByTestId('reservar-horario-11:00'));
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const calls = mockCreate.mock.calls as unknown[][];
    expect(keyOf(calls[0] as unknown[])).not.toBe(keyOf(calls[1] as unknown[]));
  });

  it('sem resposta: "Tentar de novo" reenvia o mesmo pedido com a mesma chave', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    mockCreate.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    expect(
      await screen.findByTestId('reservar-tentar-de-novo', {}, { timeout: 6000 }),
    ).toBeTruthy();
    expect(screen.getByText(/A reserva pode ter sido criada/)).toBeTruthy();
    const first = mockCreate.mock.calls[0] as unknown[];
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(booking({ id: 'b9' }));
    await fireEvent.press(screen.getByTestId('reservar-tentar-de-novo'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const retry = mockCreate.mock.calls[0] as unknown[];
    expect(retry[0]).toEqual(first[0]);
    expect(keyOf(retry)).toBe(keyOf(first));
  }, 20_000);

  it('trocar o horário depois de ficar sem resposta zera a chave e o "Tentar de novo"', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    mockCreate.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await screen.findByTestId('reservar-tentar-de-novo', {}, { timeout: 6000 });
    // Escolher a data de novo passa pelo resetSlot.
    await fireEvent.press(screen.getByTestId('reservar-duracao-60'));
    expect(screen.queryByTestId('reservar-tentar-de-novo')).toBeNull();
    await fireEvent.press(await screen.findByTestId('reservar-horario-11:00'));
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    // Espera também as repetições automáticas, para nada vazar para o próximo teste.
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(6), { timeout: 8000 });
    const calls = mockCreate.mock.calls as unknown[][];
    expect(keyOf(calls[3] as unknown[])).not.toBe(keyOf(calls[0] as unknown[]));
  }, 20_000);

  it('422 IDEMPOTENCY_KEY_REUSED: pede para conferir Minhas reservas', async () => {
    mockSpace = withModes({ mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX'] });
    // O corpo e o status exatos da API (apps/api/src/payments/idempotency-key.ts), lidos pelo
    // mesmo caminho do cliente gerado.
    const body = {
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'Esta chave de idempotência já foi usada em outro pedido. Gere uma chave nova para cada tentativa diferente.',
      },
      requestId: 'req-1',
    };
    mockCreate.mockRejectedValue(
      ApiError.fromResponse(
        new Response(JSON.stringify(body), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
        body,
      ),
    );
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    expect(await screen.findByText(/Confira em Minhas reservas/)).toBeTruthy();
    // Nunca o texto cru da API, e a próxima tentativa sai com outra chave.
    expect(screen.queryByText(/chave de idempotência/)).toBeNull();
    expect(screen.queryByTestId('reservar-tentar-de-novo')).toBeNull();
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    const calls = mockCreate.mock.calls as unknown[][];
    expect(keyOf(calls[1] as unknown[])).not.toBe(keyOf(calls[0] as unknown[]));
  });

  it('sem o tokenizador do ambiente, o cartão não aparece entre as formas', async () => {
    mockSpace = {
      ...withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] }),
      paymentEnvironment: { provider: 'acme', enabled: true, sandbox: null },
    } as PublicSpace;
    await renderScreen();
    await pickSlot();
    expect(screen.getByTestId('reservar-forma-pix')).toBeTruthy();
    expect(screen.queryByTestId('reservar-forma-cartao')).toBeNull();
    expect(screen.queryByTestId('pagamento-selo-teste')).toBeNull();
  });

  it('o token do cartão não muda a chave (a API não o compara): outro cartão, mesma reserva', async () => {
    mockSpace = withModes({ mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] });
    mockCreate.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    await pickSlot();
    await fireEvent.press(screen.getByTestId('reservar-forma-cartao'));
    await fireEvent.press(screen.getByTestId('reservar-confirmar'));
    await fireEvent.press(screen.getByTestId('cartao-teste-recusa'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await screen.findByTestId('reservar-tentar-de-novo', {}, { timeout: 6000 });
    await fireEvent.press(screen.getByTestId('cartao-teste-aprova'));
    await fireEvent.press(screen.getByTestId('cartao-pagar'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(6), { timeout: 8000 });
    const calls = mockCreate.mock.calls as unknown[][];
    const tokens = calls.map((c) => (c[0] as { cardToken: string }).cardToken);
    expect(new Set(tokens)).toEqual(
      new Set(['tok_fake_decline_visa_0002', 'tok_fake_approve_visa_1111']),
    );
    expect(new Set(calls.map((c) => keyOf(c))).size).toBe(1);
  }, 20_000);
});

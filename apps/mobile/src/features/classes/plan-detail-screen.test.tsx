import { ApiError } from '@space-sports/api-client';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PlanDetailScreen } from './plan-detail-screen';
import { subscription } from './test-fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'sub1' }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));
// "Hoje" fixo: o cancelamento depende do mês corrente e do último dia de acesso.
jest.mock('@/lib/datetime', () => ({
  ...jest.requireActual('@/lib/datetime'),
  todayIn: () => mockToday,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockToday = '2026-10-29';
let mockSpaceData: unknown;
let mockSub: { data?: unknown; isPending: boolean; isError: boolean; error?: unknown };
type Options = { mutation: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void } };
const mockResumeCancel = jest.fn();
const mockCancel = jest.fn();
const mockSwap = jest.fn();
const mockPreference = jest.fn();
let resumeCancelOptions: Options;

jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMySubscription: () => ({ ...mockSub, refetch: jest.fn(), isRefetching: false }),
  // Espaço sem pagamento online: as mensalidades seguem pagas no local.
  useGetSpaceBySlug: () => ({ data: mockSpaceData, isPending: false }),
  useResumeMySubscriptionCancel: (options: Options) => {
    resumeCancelOptions = options;
    return { mutate: (...args: unknown[]) => mockResumeCancel(...args), isPending: false };
  },
  useCancelMySubscription: () => ({
    mutate: (...args: unknown[]) => mockCancel(...args),
    isPending: false,
  }),
  useSwapMyClassGroup: () => ({
    mutate: (...args: unknown[]) => mockSwap(...args),
    isPending: false,
  }),
  useUpdateMySubscription: () => ({
    mutate: (...args: unknown[]) => mockPreference(...args),
    isPending: false,
  }),
  useGetSpaceClasses: () => {
    const fixtures = require('./test-fixtures') as typeof import('./test-fixtures');
    return {
      data: fixtures.publicClasses(
        [],
        [fixtures.publicGroup('g1'), fixtures.publicGroup('g9', { name: 'Quarta', weekday: 3 })],
      ),
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    };
  },
}));

const load = (data: unknown) => {
  mockSub = { data, isPending: false, isError: false };
};

describe('Meu plano (RF-CLASS-04/06)', () => {
  beforeEach(() => {
    mockSpaceData = undefined;
    for (const fn of [mockResumeCancel, mockCancel, mockSwap, mockPreference]) fn.mockClear();
    mockToday = '2026-10-29';
  });

  it('mostra assinatura, turmas, próxima mensalidade e o histórico pago/pendente', async () => {
    load(subscription());
    await render(<PlanDetailScreen />);
    expect(screen.getByText('Plano 2x')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.getByTestId('plano-turma-g1')).toBeTruthy();
    expect(screen.getByTestId('plano-proxima-mensalidade')).toBeTruthy();
    expect(screen.getAllByText('Vence 10/11/2026').length).toBe(2);
    // Histórico: a de novembro pendente, a de outubro paga.
    expect(screen.getByTestId('plano-mensalidades-pendentes')).toBeTruthy();
    expect(screen.getByTestId('plano-mensalidades-historico')).toBeTruthy();
    expect(screen.getByText('Paga')).toBeTruthy();
    // Selo da próxima mensalidade e da linha do histórico.
    expect(screen.getAllByText('Pendente')).toHaveLength(2);
  });

  it('avisa a mensalidade em atraso', async () => {
    load(subscription({ status: 'PAST_DUE', overdueCents: 29_900 }));
    await render(<PlanDetailScreen />);
    expect(screen.getByTestId('plano-em-atraso')).toBeTruthy();
    expect(screen.getByText('Em atraso', { exact: true })).toBeTruthy();
  });

  describe('cancelamento (RN-CLASS-08, decisão 45)', () => {
    const alertSpy = () => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const pressCancel = async () => fireEvent.press(screen.getByTestId('plano-cancelar'));

    it('com o mês pago, explica até quando o plano fica ativo antes de confirmar', async () => {
      const alert = alertSpy();
      load(subscription({ accessUntilIfCancelled: '2026-10-31' }));
      await render(<PlanDetailScreen />);
      await pressCancel();
      const [title, message, buttons] = alert.mock.calls[0] ?? [];
      expect(title).toBe('Cancelar plano?');
      expect(message).toMatch(/Seu plano fica ativo até 31\/10\/2026/);
      expect(mockCancel).not.toHaveBeenCalled();
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      expect(mockCancel).toHaveBeenCalledWith({ subscriptionId: 'sub1', data: {} });
      alert.mockRestore();
    });

    it('sem o mês pago, avisa que o acesso termina agora e que a mensalidade é dispensada', async () => {
      const alert = alertSpy();
      const [pending] = subscription().charges;
      load(
        subscription({
          accessUntilIfCancelled: null,
          charges: pending
            ? [{ ...pending, periodStart: '2026-10-01', periodEnd: '2026-10-31' }]
            : [],
        }),
      );
      await render(<PlanDetailScreen />);
      await pressCancel();
      const message = String(alert.mock.calls[0]?.[1]);
      expect(message).toMatch(/^O acesso termina agora\./);
      expect(message).toMatch(/A mensalidade deste mês é dispensada/);
      alert.mockRestore();
    });

    it('com cancelamento pedido, mostra a data e permite desistir depois de confirmar', async () => {
      const alert = alertSpy();
      load(
        subscription({ cancelAtPeriodEnd: true, endsOn: '2026-10-31', accessUntil: '2026-10-31' }),
      );
      await render(<PlanDetailScreen />);
      expect(screen.getByTestId('plano-cancelamento-agendado')).toHaveTextContent(
        /Seu plano fica ativo até 31\/10\/2026/,
      );
      expect(screen.queryByTestId('plano-cancelar')).toBeNull();
      expect(screen.queryByTestId('plano-trocar-g1')).toBeNull();
      await fireEvent.press(screen.getByTestId('plano-desistir-cancelamento'));
      expect(mockResumeCancel).not.toHaveBeenCalled();
      const [title, message, buttons] = alert.mock.calls[0] ?? [];
      expect(title).toBe('Desistir do cancelamento?');
      expect(message).toMatch(/As aulas de que você saiu ao cancelar não voltam/);
      buttons?.find((b) => b.text === 'Desistir do cancelamento')?.onPress?.();
      expect(mockResumeCancel).toHaveBeenCalledWith({ subscriptionId: 'sub1' });
      alert.mockRestore();
    });

    it('o erro de desistir aparece junto do aviso', async () => {
      load(
        subscription({ cancelAtPeriodEnd: true, endsOn: '2026-10-31', accessUntil: '2026-10-31' }),
      );
      await render(<PlanDetailScreen />);
      await act(async () =>
        resumeCancelOptions.mutation.onError(
          new ApiError({ status: 409, code: 'INVALID_SUBSCRIPTION_STATUS', message: 'x' }),
        ),
      );
      expect(
        within(screen.getByTestId('plano-cancelamento-agendado')).getByRole('alert'),
      ).toHaveTextContent(/não está disponível para o estado atual/);
    });

    it('depois do último dia de acesso não oferece desistir', async () => {
      mockToday = '2026-11-01';
      load(
        subscription({ cancelAtPeriodEnd: true, endsOn: '2026-10-31', accessUntil: '2026-10-31' }),
      );
      await render(<PlanDetailScreen />);
      expect(screen.queryByTestId('plano-desistir-cancelamento')).toBeNull();
    });

    it('plano encerrado mostra quando o acesso terminou, sem ações', async () => {
      load(subscription({ status: 'CANCELLED', endsOn: '2026-10-29', accessUntil: '2026-10-29' }));
      await render(<PlanDetailScreen />);
      expect(screen.getByTestId('plano-acesso-encerrado')).toHaveTextContent(
        'O acesso terminou em 29/10/2026.',
      );
      expect(screen.queryByTestId('plano-cancelar')).toBeNull();
      expect(screen.queryByTestId('plano-desistir-cancelamento')).toBeNull();
    });

    it('mostra o aviso da mensalidade dispensada no histórico', async () => {
      const [charge] = subscription().charges;
      load(
        subscription({
          charges: charge
            ? [
                {
                  ...charge,
                  status: 'WAIVED',
                  waiveNotice: 'Dispensada pelo cancelamento do plano',
                },
              ]
            : [],
        }),
      );
      await render(<PlanDetailScreen />);
      expect(screen.getByText('Dispensada pelo cancelamento do plano')).toBeTruthy();
    });

    it('não sobrou nada de pausa na tela', async () => {
      load(subscription());
      await render(<PlanDetailScreen />);
      expect(screen.queryByText(/pausa|trancar/i)).toBeNull();
    });
  });

  it('troca de turma escolhe outra turma do esporte e envia de/para', async () => {
    load(subscription());
    await render(<PlanDetailScreen />);
    await fireEvent.press(screen.getByTestId('plano-trocar-g1'));
    // A turma atual (g1) não aparece como destino; a de quarta sim.
    expect(screen.queryByTestId('plano-troca-turma-g1')).toBeNull();
    // Escolher só seleciona: a troca libera a vaga atual e pede confirmação.
    await fireEvent.press(screen.getByTestId('plano-troca-turma-g9'));
    expect(mockSwap).not.toHaveBeenCalled();
    expect(screen.getByText('Trocar para Quarta')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('plano-troca-confirmar'));
    expect(mockSwap).toHaveBeenCalledWith({
      subscriptionId: 'sub1',
      data: { fromClassGroupId: 'g1', toClassGroupId: 'g9' },
    });
  });

  it('forma de pagamento preferida', async () => {
    load(subscription());
    await render(<PlanDetailScreen />);
    await fireEvent.press(screen.getByTestId('plano-pagamento-CASH'));
    expect(mockPreference).toHaveBeenCalledWith({
      subscriptionId: 'sub1',
      data: { intendedPaymentMethod: 'CASH' },
    });
    await fireEvent.press(screen.getByTestId('plano-pagamento-nenhum'));
    expect(mockPreference).toHaveBeenLastCalledWith({
      subscriptionId: 'sub1',
      data: { intendedPaymentMethod: null },
    });
  });

  it('pedido em análise: sem mensalidades, com opção de retirar', async () => {
    load(
      subscription({
        status: 'PENDING_APPROVAL',
        nextCharge: null,
        charges: [],
        enrollments: subscription().enrollments.map((e) => ({ ...e, status: 'PENDING' as const })),
      }),
    );
    await render(<PlanDetailScreen />);
    expect(screen.getByText('Aguardando aprovação')).toBeTruthy();
    expect(screen.queryByTestId('plano-proxima-mensalidade')).toBeNull();
    expect(screen.getByText('Retirar pedido')).toBeTruthy();
  });

  it('estados de carregamento e erro', async () => {
    mockSub = { isPending: true, isError: false };
    const { rerender } = await render(<PlanDetailScreen />);
    expect(screen.getByText('Carregando…')).toBeTruthy();
    mockSub = { isPending: false, isError: true, error: new TypeError('Network request failed') };
    await rerender(<PlanDetailScreen />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
    mockSub = {
      isPending: false,
      isError: true,
      error: new ApiError({ status: 404, code: 'SUBSCRIPTION_NOT_FOUND', message: 'x' }),
    };
    await rerender(<PlanDetailScreen />);
    expect(screen.getByText('Plano não encontrado')).toBeTruthy();
  });
});

describe('mensalidade: "Pagar agora" (RF-ONPAY-05)', () => {
  beforeEach(() => {
    mockSpaceData = undefined;
  });

  it('sem o modo de aulas online, nada de pagar pelo app', async () => {
    load(subscription());
    await render(<PlanDetailScreen />);
    expect(screen.queryByTestId('plano-mensalidade-ch2-pagar')).toBeNull();
  });

  it('com o modo opcional, a mensalidade em aberto ganha "Pagar" com o saldo', async () => {
    mockSpaceData = {
      onlinePayments: {
        rental: { mode: 'ON_SITE', options: ['ON_SITE'] },
        classes: { mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] },
      },
    };
    load(subscription());
    await render(<PlanDetailScreen />);
    expect(screen.getByTestId('plano-mensalidade-ch2-pagar')).toHaveTextContent(
      /Pagar R\$\s299,00/,
    );
    // A paga não tem botão.
    expect(screen.queryByTestId('plano-mensalidade-ch1-pagar')).toBeNull();
  });

  it('paga pelo app: "Paga com Pix em" e o comprovante', async () => {
    const base = subscription();
    load({
      ...base,
      charges: base.charges.map((c) =>
        c.id === 'ch1'
          ? {
              ...c,
              payments: c.payments.map((p) => ({ ...p, channel: 'ONLINE', onlineChargeId: 'oc5' })),
            }
          : c,
      ),
    });
    await render(<PlanDetailScreen />);
    expect(screen.getByText(/Paga com Pix em 09\/10/)).toBeTruthy();
    expect(screen.getByTestId('plano-mensalidade-ch1-comprovante')).toBeTruthy();
  });
});

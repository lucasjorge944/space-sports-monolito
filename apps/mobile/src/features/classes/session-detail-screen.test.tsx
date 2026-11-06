import { ApiError } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { attendanceNotice, SessionDetailScreen } from './session-detail-screen';
import { classSession } from './test-fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'ses1' }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));
jest.mock('@/features/auth/session', () => ({ useMe: () => ({ id: 'u1' }) }));

let mockSession: { data?: unknown; isPending: boolean; isError: boolean; error?: unknown };
type Options = { mutation: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void } };
const mockConfirm = jest.fn();
const mockWithdraw = jest.fn();
let confirmOptions: Options;
let withdrawOptions: Options;
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetMyClassSession: () => ({ ...mockSession, refetch: jest.fn(), isRefetching: false }),
  useConfirmMyClassSession: (options: Options) => {
    confirmOptions = options;
    return { mutate: mockConfirm, isPending: false };
  },
  useWithdrawMyClassSession: (options: Options) => {
    withdrawOptions = options;
    return { mutate: mockWithdraw, isPending: false };
  },
}));

const load = (extra: Parameters<typeof classSession>[0] = {}) => {
  mockSession = { data: classSession(extra), isPending: false, isError: false };
};
const apiError = (code: string, status = 403) => new ApiError({ status, code, message: 'English' });

describe('detalhe da aula (RF-CLASS-08)', () => {
  beforeEach(() => {
    mockConfirm.mockClear();
    mockWithdraw.mockClear();
  });

  it('mostra professor, horário no fuso do espaço, quadra, status da lista e a lista confirmada', async () => {
    load();
    await render(<SessionDetailScreen />);
    expect(screen.getByTestId('aula-professor').props.children.join('')).toContain('Ana');
    // 10:00Z = 07:00 em São Paulo.
    expect(screen.getByTestId('aula-quando').props.children).toBe(
      'Sáb, 07/11/2026 · 07:00 – 08:00',
    );
    expect(screen.getByText('Lista aberta')).toBeTruthy();
    expect(screen.getByText(/Arena 7 · Quadra A/)).toBeTruthy();
    expect(screen.getByTestId('aula-confirmado-u2')).toBeTruthy();
    expect(screen.getByText('2/10 confirmados')).toBeTruthy();
  });

  it('confirma presença enquanto a lista está aberta', async () => {
    load();
    await render(<SessionDetailScreen />);
    await fireEvent.press(screen.getByTestId('aula-confirmar'));
    expect(mockConfirm).toHaveBeenCalledWith({ sessionId: 'ses1' });
  });

  it('turma cheia: o botão vira entrada na lista de espera', async () => {
    load({ confirmedCount: 10 });
    await render(<SessionDetailScreen />);
    expect(screen.getByText('Entrar na lista de espera')).toBeTruthy();
  });

  it('na espera mostra a posição na fila e permite sair', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    load({
      canConfirm: false,
      canWithdraw: true,
      myAttendance: { status: 'WAITLIST', waitlistPosition: 2 },
      waitlistCount: 3,
    });
    await render(<SessionDetailScreen />);
    expect(screen.getByTestId('aula-minha-situacao').props.children).toMatch(/2º da fila/);
    expect(screen.getByTestId('aula-espera')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('aula-desistir'));
    const buttons = alert.mock.calls[0]?.[2];
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    expect(mockWithdraw).toHaveBeenCalledWith({ sessionId: 'ses1' });
    alert.mockRestore();
  });

  it('confirmado: mostra o prazo e a lista marca "você"', async () => {
    load({
      canConfirm: false,
      canWithdraw: true,
      myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
      confirmed: [{ userId: 'u1', name: 'Bruno', avatarUrl: null }],
      confirmedCount: 1,
    });
    await render(<SessionDetailScreen />);
    expect(screen.getByTestId('aula-prazo').props.children.join('')).toContain('07/11/2026, 05:00');
    expect(screen.getByText('Bruno (você)')).toBeTruthy();
  });

  it('mostra todos os professores da aula (decisão 47)', async () => {
    load({
      teachers: [
        { name: 'Ana', avatarUrl: null },
        { name: 'Bia', avatarUrl: null },
        { name: 'Caio', avatarUrl: null },
      ],
    });
    await render(<SessionDetailScreen />);
    expect(screen.getByTestId('aula-professor')).toHaveTextContent('Professores: Ana, Bia e Caio');
  });

  it('prazo de desistência vencido: sem botão e com orientação', async () => {
    load({
      canConfirm: false,
      canWithdraw: false,
      myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
    });
    await render(<SessionDetailScreen />);
    expect(screen.queryByTestId('aula-desistir')).toBeNull();
    expect(screen.getByTestId('aula-prazo-encerrado')).toBeTruthy();
  });

  it.each([
    ['SUBSCRIPTION_ACCESS_ENDED', /último dia do seu plano/],
    ['SUBSCRIPTION_PAST_DUE', /atraso/],
    ['LIST_NOT_OPEN', /ainda não está aberta/],
    ['NOT_ENROLLED', /das suas turmas/],
    ['SCHEDULE_OVERLAP', /outra aula neste mesmo horário/],
  ] as const)('bloqueio %s explica por que não dá para confirmar', async (reason, text) => {
    load({
      canConfirm: false,
      blockedReason: reason,
      status: reason === 'LIST_NOT_OPEN' ? 'SCHEDULED' : 'OPEN',
    });
    await render(<SessionDetailScreen />);
    expect(screen.queryByTestId('aula-confirmar')).toBeNull();
    expect(screen.getByTestId('aula-bloqueio').props.children).toMatch(text);
  });

  it.each([
    ['CLOSED', /foi encerrada/],
    ['DONE', /já aconteceu/],
    ['CANCELLED', /foi cancelada/],
  ] as const)(
    'LIST_NOT_OPEN com aula %s usa o texto do status, não "ainda não abriu"',
    async (status, text) => {
      load({ canConfirm: false, blockedReason: 'LIST_NOT_OPEN', status });
      await render(<SessionDetailScreen />);
      const reason = screen.getByTestId('aula-bloqueio').props.children;
      expect(reason).toMatch(text);
      expect(reason).not.toMatch(/ainda não está aberta/);
    },
  );

  it.each([
    ['SUBSCRIPTION_ACCESS_ENDED', 403, /último dia do seu plano/],
    ['SUBSCRIPTION_PAST_DUE', 403, /mensalidade em atraso/],
    ['ATTENDANCE_LIST_NOT_OPEN', 409, /não está aberta/],
    ['ALREADY_IN_SESSION', 409, /já está na lista/],
    ['CLASS_SESSION_OVERLAP', 409, /outra aula neste mesmo horário/],
  ] as const)('erro %s da confirmação aparece em português', async (code, status, text) => {
    load();
    await render(<SessionDetailScreen />);
    await act(async () => confirmOptions.mutation.onError(apiError(code, status)));
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('aula cancelada com presença confirmada diz que a aula foi cancelada', async () => {
    load({
      status: 'CANCELLED',
      canConfirm: false,
      canWithdraw: false,
      myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
    });
    await render(<SessionDetailScreen />);
    expect(screen.getByTestId('aula-minha-situacao').props.children).toMatch(/Aula cancelada/);
    expect(screen.queryByText(/presença está confirmada/)).toBeNull();
  });

  it('sair da aula sem estar na lista (NOT_IN_SESSION) aparece em português', async () => {
    load({
      canConfirm: false,
      canWithdraw: true,
      myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
    });
    await render(<SessionDetailScreen />);
    await act(async () => withdrawOptions.mutation.onError(apiError('NOT_IN_SESSION', 409)));
    expect(screen.getByRole('alert')).toHaveTextContent(/não está na lista/);
  });

  it('prazo de desistência por código de erro', async () => {
    load({
      canConfirm: false,
      canWithdraw: true,
      myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
    });
    await render(<SessionDetailScreen />);
    await act(async () =>
      withdrawOptions.mutation.onError(apiError('CANCEL_DEADLINE_PASSED', 409)),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/prazo para desistir/);
  });

  it('aula cancelada mostra o motivo e não oferece confirmar', async () => {
    load({
      status: 'CANCELLED',
      cancelReason: 'Chuva',
      canConfirm: false,
      blockedReason: 'LIST_NOT_OPEN',
    });
    await render(<SessionDetailScreen />);
    expect(screen.getByText('Cancelada')).toBeTruthy();
    expect(screen.getByTestId('aula-motivo').props.children.join('')).toContain('Chuva');
    expect(screen.queryByTestId('aula-confirmar')).toBeNull();
  });

  it('carregando, erro e aula inexistente', async () => {
    mockSession = { isPending: true, isError: false };
    const { rerender } = await render(<SessionDetailScreen />);
    expect(screen.getByText('Carregando…')).toBeTruthy();
    mockSession = {
      isPending: false,
      isError: true,
      error: apiError('CLASS_SESSION_NOT_FOUND', 404),
    };
    await rerender(<SessionDetailScreen />);
    expect(screen.getByText('Aula não encontrada')).toBeTruthy();
    mockSession = {
      isPending: false,
      isError: true,
      error: new TypeError('Network request failed'),
    };
    await rerender(<SessionDetailScreen />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
  });
});

describe('attendanceNotice', () => {
  it('descreve cada situação', () => {
    expect(attendanceNotice(classSession())).toBeNull();
    expect(
      attendanceNotice(
        classSession({ myAttendance: { status: 'PRESENT', waitlistPosition: null } }),
      ),
    ).toMatch(/presente/);
    expect(
      attendanceNotice(
        classSession({ myAttendance: { status: 'ABSENT', waitlistPosition: null } }),
      ),
    ).toMatch(/ausente/);
    expect(
      attendanceNotice(
        classSession({
          status: 'CANCELLED',
          myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
        }),
      ),
    ).toMatch(/cancelada/);
  });
});

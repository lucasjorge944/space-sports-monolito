import { fireEvent, render, screen } from '@testing-library/react-native';
import { MyClassesSection } from './my-classes-section';
import { classSession } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

let mockSessions: { data?: unknown; isPending: boolean; isError: boolean; error?: unknown };
const mockParams = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useListMyClassSessions: (params: unknown) => {
    mockParams(params);
    return { ...mockSessions, refetch: jest.fn(), isRefetching: false };
  },
}));

describe('Agenda → Aulas (RF-CLASS-08)', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockParams.mockClear();
  });

  it('agrupa por dia, mostra horário, situação e abre o detalhe', async () => {
    mockSessions = {
      isPending: false,
      isError: false,
      data: {
        items: [
          classSession({ id: 'a', myAttendance: { status: 'CONFIRMED', waitlistPosition: null } }),
          classSession({
            id: 'b',
            startsAt: '2026-11-08T10:00:00.000Z',
            endsAt: '2026-11-08T11:00:00.000Z',
            myAttendance: { status: 'WAITLIST', waitlistPosition: 3 },
          }),
        ],
      },
    };
    await render(<MyClassesSection />);
    expect(screen.getByText('Sábado, 07/11/2026')).toBeTruthy();
    expect(screen.getByText('Domingo, 08/11/2026')).toBeTruthy();
    expect(screen.getAllByText('07:00 – 08:00')).toHaveLength(2);
    expect(screen.getByText('Presença confirmada')).toBeTruthy();
    expect(screen.getByText('Na espera (3º)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('aula-item-a'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/aulas/[id]', params: { id: 'a' } });
  });

  it('aula cancelada mostra "Aula cancelada" e não "Presença confirmada"', async () => {
    mockSessions = {
      isPending: false,
      isError: false,
      data: {
        items: [
          classSession({
            id: 'c',
            status: 'CANCELLED',
            myAttendance: { status: 'CONFIRMED', waitlistPosition: null },
          }),
        ],
      },
    };
    await render(<MyClassesSection />);
    expect(screen.getByTestId('aula-minha-c').props.children).toBe('Aula cancelada');
    expect(screen.queryByText('Presença confirmada')).toBeNull();
  });

  it('navega entre semanas pedindo a janela de 7 dias', async () => {
    mockSessions = { isPending: false, isError: false, data: { items: [] } };
    await render(<MyClassesSection />);
    expect(screen.getByText('Nenhuma aula nesta semana')).toBeTruthy();
    const first = mockParams.mock.calls[0]?.[0] as { from: string; to: string };
    await fireEvent.press(screen.getByTestId('aulas-semana-proxima'));
    const next = mockParams.mock.calls.at(-1)?.[0] as { from: string; to: string };
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    expect(days(first.from, first.to)).toBe(6);
    expect(days(first.from, next.from)).toBe(7);
  });

  it('carregando e erro', async () => {
    mockSessions = { isPending: true, isError: false };
    const { rerender } = await render(<MyClassesSection />);
    expect(screen.getByText('Carregando aulas…')).toBeTruthy();
    mockSessions = {
      isPending: false,
      isError: true,
      error: new TypeError('Network request failed'),
    };
    await rerender(<MyClassesSection />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
  });
});

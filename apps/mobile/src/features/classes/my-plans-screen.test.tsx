import { fireEvent, render, screen } from '@testing-library/react-native';
import { MyPlansScreen, sortSubscriptions } from './my-plans-screen';
import { subscription } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
}));

let mockList: { data?: unknown; isPending: boolean; isError: boolean; error?: unknown };
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useListMySubscriptions: () => ({ ...mockList, refetch: jest.fn(), isRefetching: false }),
}));

describe('Meus planos', () => {
  it('lista os planos, em aberto primeiro, e abre o detalhe', async () => {
    mockList = {
      isPending: false,
      isError: false,
      data: {
        items: [
          subscription({ id: 'old', status: 'CANCELLED', nextCharge: null }),
          subscription({ id: 'new' }),
        ],
      },
    };
    await render(<MyPlansScreen />);
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.getByText('Cancelado')).toBeTruthy();
    expect(screen.getByText(/Próxima mensalidade: .*299,00 · vence 10\/11\/2026/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('planos-item-new'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/planos/[id]', params: { id: 'new' } });
  });

  it('sem plano mostra o caminho para contratar', async () => {
    mockList = { isPending: false, isError: false, data: { items: [] } };
    await render(<MyPlansScreen />);
    expect(screen.getByText('Você ainda não tem plano de aula')).toBeTruthy();
  });

  it('erro permite tentar de novo', async () => {
    mockList = { isPending: false, isError: true, error: new TypeError('Network request failed') };
    await render(<MyPlansScreen />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
  });
});

describe('sortSubscriptions', () => {
  it('em aberto antes dos cancelados; dentro do grupo, o mais recente primeiro', () => {
    const items = [
      { id: 'c', status: 'CANCELLED', createdAt: '2026-10-05T00:00:00Z' },
      { id: 'a', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'PAST_DUE', createdAt: '2026-10-01T00:00:00Z' },
    ];
    expect(sortSubscriptions(items).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

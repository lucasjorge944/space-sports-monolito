import type { PublicSpace } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ClassesTab } from './classes-tab';
import { publicClasses, publicGroup, publicPlan } from './test-fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

let mockClasses: { data?: unknown; isPending: boolean; isError: boolean; error?: unknown };
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceClasses: () => ({ ...mockClasses, refetch: jest.fn() }),
}));

const space = { slug: 'arena-7' } as PublicSpace;

describe('aba Aulas da página do espaço (RF-CLASS-04)', () => {
  beforeEach(() => mockPush.mockClear());

  it('lista planos com preço e turmas com vagas', async () => {
    mockClasses = {
      isPending: false,
      isError: false,
      data: publicClasses(
        [publicPlan('p1', { name: 'Plano 2x', priceCents: 29_900, weeklyFrequency: 2 })],
        [
          publicGroup('g1', { name: 'Iniciante', availableSpots: 6 }),
          publicGroup('g2', { name: 'Avançado', availableSpots: 0, level: 'ADVANCED' }),
        ],
      ),
    };
    await render(<ClassesTab space={space} />);
    expect(screen.getByText('Plano 2x')).toBeTruthy();
    expect(screen.getByText(/R\$\s*299,00/)).toBeTruthy();
    expect(screen.getByText('Futevôlei · 2x por semana')).toBeTruthy();
    expect(screen.getByText('6 vagas')).toBeTruthy();
    expect(screen.getByText('Lotada')).toBeTruthy();
    expect(screen.getByText('Avançado · Avançado')).toBeTruthy();
  });

  it('contratar abre a escolha de turmas do plano', async () => {
    mockClasses = {
      isPending: false,
      isError: false,
      data: publicClasses([publicPlan('p1')], [publicGroup('g1')]),
    };
    await render(<ClassesTab space={space} />);
    await fireEvent.press(screen.getByTestId('aulas-contratar-p1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]/contratar',
      params: { slug: 'arena-7', planId: 'p1' },
    });
  });

  it('espaço sem planos nem turmas mostra o estado vazio', async () => {
    mockClasses = { isPending: false, isError: false, data: publicClasses([], []) };
    await render(<ClassesTab space={space} />);
    expect(screen.getByText('Sem aulas por enquanto')).toBeTruthy();
    expect(screen.queryByTestId('aulas-contratar-p1')).toBeNull();
  });

  it('mostra carregamento e erro com nova tentativa', async () => {
    mockClasses = { isPending: true, isError: false };
    const { rerender } = await render(<ClassesTab space={space} />);
    expect(screen.getByText('Carregando aulas…')).toBeTruthy();
    mockClasses = {
      isPending: false,
      isError: true,
      error: new TypeError('Network request failed'),
    };
    await rerender(<ClassesTab space={space} />);
    expect(screen.getByText('Tentar novamente')).toBeTruthy();
  });
});

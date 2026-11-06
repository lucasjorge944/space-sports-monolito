import { ApiError } from '@space-sports/api-client';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SubscribeScreen } from './subscribe-screen';
import { publicClasses, publicGroup, publicPlan } from './test-fixtures';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ slug: 'arena-7', planId: 'p2' }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

let mockClasses: unknown;
const mockMutate = jest.fn();
let mockMutationOptions: {
  mutation: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void };
};
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useGetSpaceClasses: () => ({
    data: mockClasses,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useRequestSubscription: (options: typeof mockMutationOptions) => {
    mockMutationOptions = options;
    return { mutate: mockMutate, isPending: false };
  },
}));

const groups = [
  publicGroup('g1', { name: 'Terça', weekday: 2 }),
  publicGroup('g2', { name: 'Quinta', weekday: 4 }),
  publicGroup('g3', { name: 'Sábado', weekday: 6 }),
  publicGroup('g4', { name: 'Sábado cedo', weekday: 6, startTime: '07:30' }),
  publicGroup('g5', { name: 'Segunda lotada', weekday: 1, availableSpots: 0 }),
  publicGroup('gx', {
    name: 'Vôlei',
    sport: { id: 'sp9', name: 'Vôlei', slug: 'volei' },
  }),
];

describe('contratar plano escolhendo as turmas (RN-CLASS-01)', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockReplace.mockClear();
    mockClasses = publicClasses(
      [
        publicPlan('p1', { weeklyFrequency: 1 }),
        publicPlan('p2', { weeklyFrequency: 2, name: 'Plano 2x' }),
        publicPlan('p3', { weeklyFrequency: null, name: 'Livre' }),
      ],
      groups,
    );
  });

  it('plano do link que não existe mais cai no único plano do espaço', async () => {
    mockClasses = publicClasses([publicPlan('p9', { name: 'Plano único' })], groups);
    await render(<SubscribeScreen />);
    expect(screen.getByTestId('contratar-turma-g1')).toBeTruthy();
    expect(screen.getByText(/Plano único/)).toBeTruthy();
  });

  it('plano do link inexistente com vários planos não escolhe nenhum sozinho', async () => {
    mockClasses = publicClasses([publicPlan('p8'), publicPlan('p9')], groups);
    await render(<SubscribeScreen />);
    expect(screen.queryByTestId('contratar-turma-g1')).toBeNull();
  });

  it('Nx/semana só envia com exatamente N turmas e só lista turmas do esporte do plano', async () => {
    await render(<SubscribeScreen />);
    expect(screen.queryByText('Vôlei')).toBeNull();
    const send = screen.getByTestId('contratar-enviar');
    expect(send.props.accessibilityState?.disabled ?? send.props['aria-disabled']).toBeTruthy();

    await fireEvent.press(screen.getByTestId('contratar-turma-g1'));
    expect(screen.getByText('1 de 2 turmas escolhidas')).toBeTruthy();
    await fireEvent.press(send);
    expect(mockMutate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('contratar-turma-g2'));
    expect(screen.getByText('2 de 2 turmas escolhidas')).toBeTruthy();
    // Completo: as outras ficam travadas.
    await fireEvent.press(screen.getByTestId('contratar-turma-g3'));
    expect(screen.getByText('2 de 2 turmas escolhidas')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('contratar-pagamento-PIX'));
    await fireEvent.press(send);
    expect(mockMutate).toHaveBeenCalledWith({
      data: { planId: 'p2', classGroupIds: ['g1', 'g2'], intendedPaymentMethod: 'PIX' },
    });
  });

  it('turma lotada e turma no mesmo horário não podem ser marcadas', async () => {
    await render(<SubscribeScreen />);
    await fireEvent.press(screen.getByTestId('contratar-turma-g5'));
    expect(screen.getByText('0 de 2 turmas escolhidas')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('contratar-turma-g3'));
    await fireEvent.press(screen.getByTestId('contratar-turma-g4'));
    expect(screen.getByText('1 de 2 turmas escolhidas')).toBeTruthy();
    expect(screen.getByText('Mesmo horário de outra turma escolhida')).toBeTruthy();
  });

  it('sem forma de pagamento não envia a preferência', async () => {
    await render(<SubscribeScreen />);
    await fireEvent.press(screen.getByTestId('contratar-turma-g1'));
    await fireEvent.press(screen.getByTestId('contratar-turma-g2'));
    await fireEvent.press(screen.getByTestId('contratar-enviar'));
    expect(mockMutate).toHaveBeenCalledWith({
      data: { planId: 'p2', classGroupIds: ['g1', 'g2'] },
    });
  });

  it('plano ilimitado aceita as turmas escolhidas, sem número fixo', async () => {
    await render(<SubscribeScreen />);
    await fireEvent.press(screen.getByTestId('contratar-plano-p3'));
    await fireEvent.press(screen.getByTestId('contratar-turma-g1'));
    expect(screen.getByText('1 turma escolhida')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('contratar-enviar'));
    expect(mockMutate).toHaveBeenCalledWith({ data: { planId: 'p3', classGroupIds: ['g1'] } });
  });

  it('abre o plano contratado e mostra o erro do servidor em português', async () => {
    await render(<SubscribeScreen />);
    await act(async () => mockMutationOptions.mutation.onSuccess({ id: 'sub9' }));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/planos/[id]',
      params: { id: 'sub9', nova: '1' },
    });

    await act(async () =>
      mockMutationOptions.mutation.onError(
        new ApiError({ status: 409, code: 'CLASS_GROUP_FULL', message: 'Full' }),
      ),
    );
    expect(screen.getByText('Esta turma está lotada. Escolha outra turma.')).toBeTruthy();
  });

  it('CLASS_SCHEDULE_OVERLAP mostra a turma que conflita, mesmo de outro espaço (decisão 37)', async () => {
    await render(<SubscribeScreen />);
    await act(async () =>
      mockMutationOptions.mutation.onError(
        new ApiError({
          status: 409,
          code: 'CLASS_SCHEDULE_OVERLAP',
          message: 'English',
          details: {
            classGroupId: 'g1',
            conflict: {
              classGroupName: 'Vôlei adulto',
              spaceName: 'Arena Sol',
              weekday: 2,
              startTime: '19:00',
              durationMin: 60,
              timeZone: 'America/Sao_Paulo',
            },
          },
        }),
      ),
    );
    expect(
      screen.getByText(
        /mesmo horário de outra turma sua: Vôlei adulto \(Arena Sol\), Terça, 19:00 às 20:00/,
      ),
    ).toBeTruthy();
  });

  it('não oferece reposição de aula (decisão 24)', async () => {
    await render(<SubscribeScreen />);
    expect(screen.queryByText(/reposi/i)).toBeNull();
  });
});

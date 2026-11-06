import type { SpaceCard as SpaceCardData } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SpaceCard } from './space-card';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));

const HIDDEN = { includeHiddenElements: true };

const space: SpaceCardData = {
  id: 's1',
  slug: 'duna-sports',
  name: 'Duna Sports',
  logoUrl: null,
  neighborhood: 'Savassi',
  city: 'Belo Horizonte',
  location: null,
  distanceMeters: 1500,
  cover: null,
  sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
  pricePerHourCents: 12000,
  rating: { count: 0, average: null },
  services: ['RENTAL', 'CLASSES'],
};

describe('SpaceCard (RF-SPACE-05, RF-SPACE-11)', () => {
  beforeEach(() => mockPush.mockClear());

  it('mostra nome, local, esporte, preço por hora e serviços', async () => {
    await render(<SpaceCard space={space} />);
    expect(screen.getByText('Duna Sports')).toBeTruthy();
    expect(screen.getByText('Savassi · Belo Horizonte · 1,5 km')).toBeTruthy();
    expect(screen.getByText('Futevôlei')).toBeTruthy();
    expect(screen.getByText('R$ 120,00')).toBeTruthy();
    expect(screen.getByText('Aluguel · Aulas')).toBeTruthy();
  });

  it('usa raio 24 no card e rótulo acessível com o preço', async () => {
    await render(<SpaceCard space={space} />);
    const card = screen.getByTestId('espaco-card-duna-sports');
    expect(card.props.className).toContain('rounded-xl');
    expect(card.props.accessibilityLabel.replace(/\s/g, ' ')).toContain('R$ 120,00 por hora');
  });

  it('sem logo, mostra as iniciais; com logo, a imagem', async () => {
    await render(<SpaceCard space={space} />);
    expect(screen.getByTestId('space-avatar-initials', HIDDEN)).toHaveTextContent('DS');

    await render(<SpaceCard space={{ ...space, logoUrl: 'https://cdn.test/duna.jpg' }} />);
    expect(screen.getByTestId('space-avatar-image', HIDDEN)).toBeTruthy();
  });

  it('abre a página do espaço', async () => {
    await render(<SpaceCard space={space} />);
    await fireEvent.press(screen.getByTestId('espaco-card-duna-sports'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/espaco/[slug]',
      params: { slug: 'duna-sports' },
    });
  });

  it('com 5 ou mais avaliações, o selo "★ 4,8 (23)" antes do local (RF-REVIEW-03)', async () => {
    await render(<SpaceCard space={{ ...space, rating: { count: 23, average: 4.8 } }} />);
    expect(screen.getByTestId('selo-avaliacao')).toHaveTextContent('4,8 (23)');
    expect(screen.queryByTestId('selo-novo')).toBeNull();
    const label = screen.getByTestId('espaco-card-duna-sports').props.accessibilityLabel;
    expect(label).toContain('Duna Sports, nota 4,8 de 5, 23 avaliações, Savassi');
  });

  it('abaixo de 5, o badge "Novo", sem estrela nem média', async () => {
    await render(<SpaceCard space={{ ...space, rating: { count: 4, average: null } }} />);
    expect(screen.getByTestId('selo-novo')).toHaveTextContent('Novo');
    expect(screen.queryByTestId('selo-avaliacao')).toBeNull();
    expect(screen.getByTestId('espaco-card-duna-sports').props.accessibilityLabel).toContain(
      'novo, ainda poucas avaliações',
    );
  });
});

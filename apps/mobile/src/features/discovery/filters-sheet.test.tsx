import { fireEvent, render, screen } from '@testing-library/react-native';
import { FiltersSheet } from './filters-sheet';
import { DEFAULT_FILTERS, getFilters, resetFilters, setFilters, useFilters } from './filters-store';
import { SearchHeader } from './search-header';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
let mockCoords: { lat: number; lng: number } | null = null;
jest.mock('@/features/location/location-provider', () => ({
  useLocation: () => ({ coords: mockCoords }),
}));
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  useListSports: () => ({ data: { items: [] }, isError: false }),
  useListAmenities: () => ({ data: { items: [] }, isError: false }),
}));

/** A folha lê o store como as telas: o `filters` atualiza a cada toque. */
function Sheet({ context }: { context?: 'list' | 'map' }) {
  const filters = useFilters();
  return <FiltersSheet visible onClose={() => undefined} filters={filters} context={context} />;
}

function Header({ context }: { context?: 'list' | 'map' }) {
  const filters = useFilters();
  return <SearchHeader filters={filters} context={context} />;
}

beforeEach(() => {
  mockCoords = { lat: -19.92, lng: -43.94 };
  setFilters({ ...DEFAULT_FILTERS });
});
afterEach(() => resetFilters());

describe('folha de filtros: nota e ordem (decisão 109, RF-REVIEW-10)', () => {
  it('"Mais perto" vem marcado; "Melhor avaliados" troca a ordem', async () => {
    await render(<Sheet />);
    expect(screen.getByTestId('filtros-ordem-distancia')).toBeChecked();
    expect(screen.getByTestId('filtros-ordem-distancia')).toHaveTextContent('Mais perto');
    expect(screen.getByTestId('filtros-ordem-nota')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('filtros-ordem-nota'));
    expect(getFilters().sort).toBe('rating');
    expect(screen.getByTestId('filtros-ordem-nota')).toBeChecked();
    await fireEvent.press(screen.getByTestId('filtros-ordem-distancia'));
    expect(getFilters().sort).toBe('distance');
  });

  it('sem localização, a ordem padrão diz "Por nome"', async () => {
    mockCoords = null;
    await render(<Sheet />);
    expect(screen.getByTestId('filtros-ordem-distancia')).toHaveTextContent('Por nome');
  });

  it('"4+ estrelas" liga e desliga (caixa de seleção)', async () => {
    await render(<Sheet />);
    const chip = screen.getByTestId('filtros-nota-4');
    expect(chip).toHaveTextContent('4+ estrelas');
    expect(chip).not.toBeChecked();
    await fireEvent.press(chip);
    expect(getFilters().minRating).toBe(4);
    expect(screen.getByRole('checkbox', { name: /4\+ estrelas/ })).toBeChecked();
    await fireEvent.press(screen.getByTestId('filtros-nota-4'));
    expect(getFilters().minRating).toBeNull();
  });

  it('"Limpar" tira o "4+ estrelas" e volta a "Mais perto", mantendo a busca', async () => {
    setFilters({ q: 'arena', minRating: 4, sort: 'rating' });
    await render(<Sheet />);
    await fireEvent.press(screen.getByTestId('filtros-limpar'));
    expect(getFilters()).toEqual({ ...DEFAULT_FILTERS, q: 'arena' });
  });

  it('no mapa, sem "Ordenar por"; o "4+ estrelas" continua, e "Limpar" não mexe na ordem', async () => {
    setFilters({ minRating: 4, sort: 'rating' });
    await render(<Sheet context="map" />);
    expect(screen.queryByTestId('filtros-ordem-distancia')).toBeNull();
    expect(screen.queryByTestId('filtros-ordem-nota')).toBeNull();
    expect(screen.getByTestId('filtros-nota-4')).toBeChecked();
    await fireEvent.press(screen.getByTestId('filtros-limpar'));
    expect(getFilters()).toEqual({ ...DEFAULT_FILTERS, sort: 'rating' });
  });
});

describe('selo do botão de filtros', () => {
  it('na lista, conta o "4+ estrelas" e o "Melhor avaliados"', async () => {
    setFilters({ minRating: 4, sort: 'rating' });
    await render(<Header />);
    expect(screen.getByTestId('busca-filtros')).toHaveAccessibleName('Filtros, 2 ativos');
  });

  it('no mapa, só o "4+ estrelas"', async () => {
    setFilters({ minRating: 4, sort: 'rating' });
    await render(<Header context="map" />);
    expect(screen.getByTestId('busca-filtros')).toHaveAccessibleName('Filtros, 1 ativo');
  });
});

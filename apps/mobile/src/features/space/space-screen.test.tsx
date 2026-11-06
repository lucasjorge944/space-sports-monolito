import type { PublicSpace } from '@space-sports/api-client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QuickInfo } from './quick-info';
import { cancellationLabel, RentTab } from './rent-tab';
import { SpaceInfo } from './space-info';

jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View, Marker: View };
});

const sports = [{ sportId: 'f', slug: 'f', name: 'Futevôlei', maxPlayers: 20 }];

const filled = {
  id: 's1',
  slug: 'arena',
  name: 'Arena Sol',
  description: 'Quadras de areia.',
  address: {
    street: 'Rua A',
    number: '10',
    neighborhood: 'Savassi',
    postalCode: null,
    city: { id: 'c1', name: 'Belo Horizonte', state: 'MG' },
  },
  location: { lat: -19.9, lng: -43.9 },
  phone: '+553132221234',
  whatsapp: '+5531999998888',
  instagram: '@arenasol',
  logoUrl: null,
  photos: [],
  amenities: [{ id: 'a1', slug: 'wi-fi', name: 'Wi-Fi', icon: null }],
  openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opensAt: '08:00',
    closesAt: '22:00',
  })),
  acceptedPaymentMethods: ['PIX'],
  sports: [{ slug: 'futevolei', name: 'Futevôlei' }],
  services: ['RENTAL'],
  rating: { count: 0, average: null },
  courts: [
    { id: 'q1', name: 'Quadra 1', covered: true, sports },
    { id: 'q2', name: 'Quadra 2', covered: false, sports },
  ],
  rental: {
    pricePerHourCents: 10_000,
    minDurationMin: 60,
    maxDurationMin: 180,
    minAdvanceMin: 0,
    windowDays: 30,
    cancellationDeadlineMin: 120,
  },
  onlinePayments: {
    rental: { mode: 'ON_SITE', options: ['ON_SITE'] },
    classes: { mode: 'ON_SITE', options: ['ON_SITE'] },
  },
  paymentEnvironment: { provider: 'none', enabled: false, sandbox: null },
} as PublicSpace;

const bare = {
  ...filled,
  description: null,
  location: null,
  phone: null,
  whatsapp: null,
  instagram: null,
  amenities: [],
  openingHours: [],
  acceptedPaymentMethods: [],
  courts: [],
  services: [],
} as PublicSpace;

describe('página do espaço (RF-SPACE-08)', () => {
  it('informações rápidas em grade', async () => {
    await render(<QuickInfo space={filled} />);
    expect(screen.getByTestId('espaco-preco-hora').props.children).toMatch(/R\$\s*100,00/);
    expect(screen.getByText('2 quadras')).toBeTruthy();
    expect(screen.getByText('1 coberta')).toBeTruthy();
    expect(screen.getByText('08:00–22:00')).toBeTruthy();
    expect(screen.getByText('1h a 3h')).toBeTruthy();
  });

  it('sem dados, a grade fica vazia: não inventa preço, quadra nem horário', async () => {
    await render(<QuickInfo space={bare} />);
    expect(screen.queryByTestId('espaco-preco-hora')).toBeNull();
    expect(screen.queryByText(/quadra/)).toBeNull();
    expect(screen.queryByText('hoje')).toBeNull();
  });

  it('regras em lista, sem a palavra "grátis"', async () => {
    await render(<RentTab space={filled} />);
    expect(screen.getByText('Cancelamento')).toBeTruthy();
    expect(screen.getByTestId('espaco-cancelamento-prazo').props.children).toBe('até 2h antes');
    expect(screen.queryByText(/grátis/i)).toBeNull();
    expect(screen.queryByText('Antecedência mínima')).toBeNull();
  });

  it('quadra descoberta não ganha rótulo', async () => {
    await render(<RentTab space={filled} />);
    expect(screen.getByText('Coberta · Futevôlei')).toBeTruthy();
    expect(screen.queryByText(/descoberta/i)).toBeNull();
  });

  it('prazo zero é até o início', () => {
    expect(cancellationLabel(0)).toBe('até o início');
    expect(cancellationLabel(1440)).toBe('até 24h antes');
  });

  it('mostra as seções preenchidas, com telefone mascarado e WhatsApp', async () => {
    await render(<SpaceInfo space={filled} />);
    for (const title of ['Sobre', 'Comodidades', 'Pagamento no espaço', 'Contato', 'Localização']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByTestId('espaco-whatsapp')).toBeTruthy();
    expect(screen.getByText('(31) 3222-1234')).toBeTruthy();
    expect(screen.getByTestId('espaco-mapa')).toBeTruthy();
  });

  it('horários abrem e fecham', async () => {
    await render(<SpaceInfo space={filled} />);
    expect(screen.queryByTestId('espaco-horarios-lista')).toBeNull();
    expect(screen.getByText('Hoje: 08:00–22:00')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('espaco-horarios'));
    expect(screen.getByText('Dom a Sáb')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('espaco-horarios'));
    expect(screen.queryByTestId('espaco-horarios-lista')).toBeNull();
  });

  it('sem dados, só o endereço fica: nada de seção vazia', async () => {
    await render(<SpaceInfo space={bare} />);
    for (const title of ['Sobre', 'Comodidades', 'Pagamento no espaço', 'Contato']) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.queryByTestId('espaco-horarios')).toBeNull();
    expect(screen.queryByTestId('espaco-mapa')).toBeNull();
    expect(screen.getByText(/Rua A, 10/)).toBeTruthy();
  });
});

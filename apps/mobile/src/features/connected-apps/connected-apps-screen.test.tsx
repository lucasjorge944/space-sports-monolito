import { MCP_OAUTH_SCOPE_LABELS } from '@space-sports/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ConnectedAppsScreen } from './connected-apps-screen';
import { MCP_CONNECT_URL } from './labels';
import { connectedApp } from './test-fixtures';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: jest.requireActual('react-native').View,
}));
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));
let mockIsManager = false;
jest.mock('@/features/auth/session', () => ({ useIsManager: () => mockIsManager }));
const mockCopy = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (v: string) => mockCopy(v) }));

const mockList = jest.fn();
const mockDisconnect = jest.fn();
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  listConnectedApps: (...args: unknown[]) => mockList(...args),
  disconnectConnectedApp: (...args: unknown[]) => mockDisconnect(...args),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConnectedAppsScreen />
    </QueryClientProvider>,
  );
}

/** Aperta o botão do alerta nativo aberto por `Alert.alert`. */
async function pressAlertButton(alert: jest.SpyInstance, text: string) {
  const buttons = alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === text)?.onPress?.());
}

const app = connectedApp();

beforeEach(() => {
  jest.clearAllMocks();
  mockIsManager = false;
});
afterEach(() => jest.restoreAllMocks());

describe('Apps conectados (RF-MCP-05)', () => {
  it('lista o nome, os escopos em português, "Conectado em" e "Último uso"', async () => {
    mockList.mockResolvedValue({ items: [app] });
    await renderScreen();
    expect(await screen.findByText('Claude')).toBeTruthy();
    expect(screen.getByTestId(`apps-conectados-host-${app.id}`)).toHaveTextContent('claude.ai');
    expect(screen.getByText('• Ver espaços, quadras, horários e aulas')).toBeTruthy();
    expect(screen.getByText('• Ver suas reservas')).toBeTruthy();
    expect(screen.getByText('• Reservar e cancelar quadras em seu nome')).toBeTruthy();
    expect(screen.getByTestId(`apps-conectados-conectado-${app.id}`)).toHaveTextContent(
      'Conectado em 10/11/2026',
    );
    expect(screen.getByTestId(`apps-conectados-ultimo-uso-${app.id}`)).toHaveTextContent(
      'Último uso: 11/11/2026',
    );
  });

  it('cliente sem domínio verificado mostra "Domínio não verificado"', async () => {
    mockList.mockResolvedValue({ items: [connectedApp({ host: null })] });
    await renderScreen();
    expect(await screen.findByText('Domínio não verificado')).toBeTruthy();
    expect(screen.queryByTestId(`apps-conectados-host-${app.id}`)).toBeNull();
  });

  it('com domínio, não mostra "Domínio não verificado"', async () => {
    mockList.mockResolvedValue({ items: [app] });
    await renderScreen();
    await screen.findByText('Claude');
    expect(screen.queryByText('Domínio não verificado')).toBeNull();
  });

  it('app nunca usado mostra "Ainda não usado"', async () => {
    mockList.mockResolvedValue({ items: [connectedApp({ lastUsedAt: null })] });
    await renderScreen();
    expect(await screen.findByText('Ainda não usado')).toBeTruthy();
  });

  it('desconectar pede confirmação e só chama a API ao confirmar, com o id da conexão', async () => {
    mockList.mockResolvedValue({ items: [app] });
    mockDisconnect.mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await fireEvent.press(await screen.findByTestId(`apps-conectados-desconectar-${app.id}`));
    expect(alert).toHaveBeenCalledWith(
      'Desconectar Claude?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockDisconnect).not.toHaveBeenCalled();

    // Depois de desconectar, a lista é buscada de novo e vem vazia.
    mockList.mockResolvedValue({ items: [] });
    await pressAlertButton(alert, 'Desconectar');
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1));
    expect(mockDisconnect.mock.calls[0][0]).toBe(app.id);
    expect(await screen.findByTestId('apps-conectados-vazio')).toBeTruthy();
    expect(screen.queryByTestId(`apps-conectados-item-${app.id}`)).toBeNull();
  });

  it('cancelar a confirmação não desconecta', async () => {
    mockList.mockResolvedValue({ items: [app] });
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await fireEvent.press(await screen.findByTestId(`apps-conectados-desconectar-${app.id}`));
    await pressAlertButton(alert, 'Cancelar');
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(screen.getByTestId(`apps-conectados-item-${app.id}`)).toBeTruthy();
  });

  it('falha ao desconectar mantém o app na lista e avisa', async () => {
    mockList.mockResolvedValue({ items: [app] });
    mockDisconnect.mockRejectedValue(new Error('boom'));
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await fireEvent.press(await screen.findByTestId(`apps-conectados-desconectar-${app.id}`));
    await pressAlertButton(alert, 'Desconectar');
    expect(
      await screen.findByText('Não foi possível desconectar agora. Tente de novo.'),
    ).toBeTruthy();
    expect(screen.getByTestId(`apps-conectados-item-${app.id}`)).toBeTruthy();
  });

  it('puxar para atualizar limpa o erro de desconexão', async () => {
    mockList.mockResolvedValue({ items: [app] });
    mockDisconnect.mockRejectedValue(new Error('boom'));
    const alert = jest.spyOn(Alert, 'alert');
    await renderScreen();
    await fireEvent.press(await screen.findByTestId(`apps-conectados-desconectar-${app.id}`));
    await pressAlertButton(alert, 'Desconectar');
    await screen.findByText('Não foi possível desconectar agora. Tente de novo.');

    await act(async () =>
      screen.getByTestId('apps-conectados-lista').props.refreshControl.props.onRefresh(),
    );
    await waitFor(() =>
      expect(screen.queryByText('Não foi possível desconectar agora. Tente de novo.')).toBeNull(),
    );
  });

  it('vazio explica o uso pelo assistente e mostra o link do conector, que copia', async () => {
    mockList.mockResolvedValue({ items: [] });
    await renderScreen();
    expect(await screen.findByTestId('apps-conectados-vazio')).toBeTruthy();
    expect(screen.getByText(/Claude e por outros assistentes/)).toBeTruthy();
    expect(screen.getByTestId('apps-conectados-link')).toHaveTextContent(MCP_CONNECT_URL);
    await fireEvent.press(screen.getByTestId('apps-conectados-copiar'));
    expect(mockCopy).toHaveBeenCalledWith(MCP_CONNECT_URL);
    expect(await screen.findByText('Copiado!')).toBeTruthy();
  });

  it('vazio, para quem é da equipe de um espaço, cita a consulta dos dados do espaço', async () => {
    mockIsManager = true;
    mockList.mockResolvedValue({ items: [] });
    await renderScreen();
    expect(await screen.findByTestId('apps-conectados-vazio-equipe')).toHaveTextContent(
      /mesmo conector também dá para consultar os dados do espaço/,
    );
  });

  it('vazio, para quem não é da equipe, não cita os dados do espaço', async () => {
    mockList.mockResolvedValue({ items: [] });
    await renderScreen();
    await screen.findByTestId('apps-conectados-vazio');
    expect(screen.queryByTestId('apps-conectados-vazio-equipe')).toBeNull();
  });

  it('indica o conector de cada app', async () => {
    const admin = connectedApp({
      id: 'admin-1',
      resource: { kind: 'ADMIN', name: 'Space Sports · Plataforma' },
      scopes: ['super:read'],
      expiresAt: '2099-11-13T22:00:00.000Z',
    });
    mockList.mockResolvedValue({ items: [app, admin] });
    await renderScreen();
    await screen.findByTestId(`apps-conectados-item-${app.id}`);
    expect(screen.getByTestId(`apps-conectados-conector-${app.id}`)).toHaveTextContent(
      'Conector: Space Sports',
    );
    expect(screen.getByTestId('apps-conectados-conector-admin-1')).toHaveTextContent(
      'Conector: Space Sports · Plataforma',
    );
  });

  it('mostra os escopos de gestão agrupados, com os textos do shared', async () => {
    const manager = connectedApp({
      scopes: ['spaces:read', 'bookings:read', 'manage:read', 'manage:finance:read'],
    });
    mockList.mockResolvedValue({ items: [manager] });
    await renderScreen();
    await screen.findByTestId(`apps-conectados-item-${manager.id}`);
    expect(screen.getByText('Como jogador')).toBeTruthy();
    expect(screen.getByText('Gestão dos seus espaços')).toBeTruthy();
    expect(screen.getByText(`• ${MCP_OAUTH_SCOPE_LABELS['manage:read']}`)).toBeTruthy();
    expect(screen.getByText(`• ${MCP_OAUTH_SCOPE_LABELS['manage:finance:read']}`)).toBeTruthy();
  });

  it('só jogador: sem títulos de grupo e sem prazo de expiração', async () => {
    mockList.mockResolvedValue({ items: [app] });
    await renderScreen();
    await screen.findByTestId(`apps-conectados-item-${app.id}`);
    expect(screen.queryByText('Como jogador')).toBeNull();
    expect(screen.queryByTestId(`apps-conectados-expira-${app.id}`)).toBeNull();
  });

  it('conector da plataforma mostra o escopo do Super e quando a conexão expira', async () => {
    const admin = connectedApp({
      id: 'admin-1',
      resource: { kind: 'ADMIN', name: 'Space Sports · Plataforma' },
      scopes: ['super:read'],
      expiresAt: '2099-11-13T22:00:00.000Z',
    });
    mockList.mockResolvedValue({ items: [admin] });
    await renderScreen();
    await screen.findByTestId('apps-conectados-item-admin-1');
    expect(screen.getByText('Painel da plataforma')).toBeTruthy();
    expect(screen.getByText(`• ${MCP_OAUTH_SCOPE_LABELS['super:read']}`)).toBeTruthy();
    expect(screen.getByTestId('apps-conectados-expira-admin-1')).toHaveTextContent(
      'Esta conexão expira em 13/11/2099, 19:00',
    );
  });

  it('conexão do Super vencida avisa que expirou e manda conectar de novo', async () => {
    const admin = connectedApp({
      id: 'admin-1',
      resource: { kind: 'ADMIN', name: 'Space Sports · Plataforma' },
      scopes: ['super:read'],
      expiresAt: '2026-11-11T22:00:00.000Z',
    });
    mockList.mockResolvedValue({ items: [admin] });
    await renderScreen();
    expect(await screen.findByTestId('apps-conectados-expira-admin-1')).toHaveTextContent(
      'Conexão expirada em 11/11/2026, 19:00. Conecte de novo no assistente.',
    );
    expect(screen.queryByText(/Esta conexão expira/)).toBeNull();
  });

  it('erro de carregamento oferece tentar de novo', async () => {
    mockList.mockRejectedValueOnce(new Error('offline'));
    await renderScreen();
    mockList.mockResolvedValue({ items: [app] });
    await fireEvent.press(await screen.findByText('Tentar novamente'));
    expect(await screen.findByText('Claude')).toBeTruthy();
  });
});

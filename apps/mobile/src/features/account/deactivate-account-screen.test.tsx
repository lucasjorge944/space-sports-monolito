import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { DeactivateAccountScreen } from './deactivate-account-screen';

const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ signOut: mockSignOut }) }));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));
const mockDeactivate = jest.fn(async () => undefined);
jest.mock('@space-sports/api-client', () => ({
  ...jest.requireActual('@space-sports/api-client'),
  deactivateMe: () => mockDeactivate(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('Inativar conta (RF-AUTH-03)', () => {
  it('depois de inativar, sai da conta (o que também apaga os espaços recentes do aparelho)', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await render(<DeactivateAccountScreen />, { wrapper });
    await fireEvent.press(screen.getByText('Inativar minha conta'));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockDeactivate).toHaveBeenCalledTimes(1);
  });
});

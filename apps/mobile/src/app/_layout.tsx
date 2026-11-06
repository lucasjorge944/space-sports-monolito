import '../global.css';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { isApiError } from '@space-sports/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setupApiClient } from '@/features/auth/api';
import { OfflineScreen } from '@/features/auth/components/offline-screen';
import { ProtectedStack } from '@/features/auth/protected-stack';
import { getRouteAccess } from '@/features/auth/route-access';
import { SessionProvider, useSession } from '@/features/auth/session';
import { LocationProvider } from '@/features/location/location-provider';
import { PushRegistrar } from '@/features/notifications/push-registrar';
import { ThemeProvider, useThemeName } from '@/theme/theme-provider';

void SplashScreen.preventAutoHideAsync();
setupApiClient();

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Erro do cliente (4xx) não melhora repetindo; rede e 5xx tentam de novo.
      queries: { retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 3 },
    },
  });
}

export { ErrorBoundary } from 'expo-router';

function RootStack() {
  const name = useThemeName();
  const { state } = useSession();

  // Este componente só monta com as fontes prontas; a splash sai quando a sessão também estiver.
  useEffect(() => {
    if (state.status !== 'loading') void SplashScreen.hideAsync();
  }, [state.status]);

  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      {state.status === 'offline' || state.status === 'error' ? (
        <OfflineScreen kind={state.status} />
      ) : state.status === 'loading' ? null : (
        <ProtectedStack access={getRouteAccess(state)} />
      )}
      {state.status === 'signed-in' ? <PushRegistrar userId={state.me.id} /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter: Inter_400Regular,
    InterMedium: Inter_500Medium,
    InterSemiBold: Inter_600SemiBold,
    InterBold: Inter_700Bold,
    // `font-display` (400) e as variações `font-display-*` do tailwind.config.
    'Space Grotesk': SpaceGrotesk_400Regular,
    SpaceGroteskMedium: SpaceGrotesk_500Medium,
    SpaceGroteskSemiBold: SpaceGrotesk_600SemiBold,
    SpaceGroteskBold: SpaceGrotesk_700Bold,
  });

  const [queryClient] = useState(createQueryClient);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <LocationProvider>
              <RootStack />
            </LocationProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

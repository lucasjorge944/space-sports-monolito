import { Stack } from 'expo-router';

// `entrar` primeiro: é para onde a guarda de sessão leva quem não está logado.
export const unstable_settings = { initialRouteName: 'entrar' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="entrar" />
      <Stack.Screen name="cadastro" />
      <Stack.Screen name="esqueci-senha" />
    </Stack>
  );
}

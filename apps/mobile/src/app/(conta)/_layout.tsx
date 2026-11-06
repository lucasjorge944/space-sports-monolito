import { Stack } from 'expo-router';

/** Telas empilhadas da conta do jogador (reserva, favoritos, notificações, perfil). */
export default function ContaLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

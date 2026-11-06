import { Stack } from 'expo-router';
import type { RouteAccess } from './route-access';

/**
 * Navegador raiz com as rotas protegidas por sessão (`Stack.Protected`): quem perde o acesso a
 * um grupo é redirecionado para uma tela disponível, então quem precisa informar o nome só tem
 * `completar-perfil` liberada (destino único). `redefinir-senha` e `verificar-email` ficam fora
 * da guarda de login porque os links dos e-mails abrem logado ou não (o mesmo vale para o
 * convite de reserva, `convite/[token]`). Os deep links `convite/[token]`, `espacos/[slug]` (link
 * da página pública do espaço) e `espacos/[slug]/avaliar` (RF-REVIEW-02) ficam fora de toda
 * guarda: sem acesso ao app, a própria tela guarda o destino e leva ao login ou a completar o
 * perfil; o `EntryGate` retoma o destino depois.
 */
export function ProtectedStack({ access }: { access: RouteAccess }) {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Deslogado ou sem nome, guardam o destino; com acesso ao app, abrem o convite/espaço. */}
      <Stack.Screen name="convite/[token]" />
      <Stack.Screen name="espacos/[slug]" />
      <Stack.Screen name="espacos/[slug]/avaliar" />
      <Stack.Protected guard={!access.completeProfile}>
        <Stack.Screen name="redefinir-senha" />
        <Stack.Screen name="verificar-email" />
      </Stack.Protected>
      <Stack.Protected guard={access.auth}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={access.completeProfile}>
        <Stack.Screen name="completar-perfil" />
      </Stack.Protected>
      <Stack.Protected guard={access.app}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="localizacao" />
        <Stack.Screen name="espaco" />
        <Stack.Screen name="reserva" />
        <Stack.Screen name="mensalistas" />
        <Stack.Screen name="planos" />
        <Stack.Screen name="aulas" />
        <Stack.Screen name="(conta)" />
      </Stack.Protected>
    </Stack>
  );
}

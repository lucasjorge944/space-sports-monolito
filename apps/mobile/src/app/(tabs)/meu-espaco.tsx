import { Redirect } from 'expo-router';
import { useIsManager } from '@/features/auth/session';
import { StaffViewScreen } from '@/features/staff/staff-view-screen';

export default function MeuEspacoScreen() {
  // `href: null` só esconde a aba; quem abrir a rota por link sem vínculo volta para o início.
  // A autorização de verdade dos dados é da API.
  if (!useIsManager()) return <Redirect href="/" />;
  return <StaffViewScreen />;
}

import { Redirect } from 'expo-router';
import { Screen } from '@/components/screen';
import { FEATURES } from '@/lib/features';

export default function TorneiosScreen() {
  // `href: null` só esconde a aba; quem abrir a rota por link volta para o início.
  if (!FEATURES.tournaments) return <Redirect href="/" />;
  return <Screen />;
}

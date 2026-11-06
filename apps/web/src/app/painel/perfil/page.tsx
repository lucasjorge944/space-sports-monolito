import type { Metadata } from 'next';
import { ProfileView } from '@/components/account/profile-view';

export const metadata: Metadata = { title: 'Meu perfil' };

export default function PainelPerfilPage() {
  return <ProfileView />;
}

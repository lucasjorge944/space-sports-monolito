import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/auth-card';
import { SignOutButton } from '@/components/auth/sign-out-button';

export const metadata: Metadata = { title: 'Sem acesso' };

export default function SemAcessoPage() {
  return (
    <AuthCard
      title="Sem acesso ao painel"
      description="Esta conta não está vinculada a nenhum espaço nem à equipe da plataforma. Peça um convite ao responsável pelo espaço ou entre com outra conta."
    >
      <SignOutButton />
    </AuthCard>
  );
}

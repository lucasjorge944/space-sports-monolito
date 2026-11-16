import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Button } from '@/components/ui/button';
import { CONNECTED_APPS_PATH } from '@/lib/auth/oauth';

export const metadata: Metadata = { title: 'Sem acesso' };

export default function SemAcessoPage() {
  return (
    <AuthCard
      title="Sem acesso ao painel"
      description="Esta conta não está vinculada a nenhum espaço nem à equipe da plataforma. Peça um convite ao responsável pelo espaço ou entre com outra conta."
    >
      <Button asChild variant="outline" size="xl">
        <Link href={CONNECTED_APPS_PATH}>Apps conectados</Link>
      </Button>
      <SignOutButton />
    </AuthCard>
  );
}

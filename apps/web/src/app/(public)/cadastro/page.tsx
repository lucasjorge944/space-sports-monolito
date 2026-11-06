import type { Metadata } from 'next';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { safeNextPath } from '@/lib/auth/navigation';
import { parseSocialProviders } from '@/lib/auth/providers';
import { firstParam, type SearchParams } from '@/lib/auth/search-params';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <SignUpForm
      providers={parseSocialProviders(process.env.AUTH_PROVIDERS)}
      next={safeNextPath(firstParam(params.next))}
    />
  );
}

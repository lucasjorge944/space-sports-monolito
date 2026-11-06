import { notFound } from 'next/navigation';
import { findNavItem, painelNav } from '@/components/shell/nav';
import { PageStub } from '@/components/shell/page-stub';

// Páginas vazias: o título vem do menu. Rotas fora do menu retornam 404.
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const item = findNavItem(painelNav, `/painel/${slug.join('/')}`);
  if (!item) notFound();
  return <PageStub title={item.title} />;
}

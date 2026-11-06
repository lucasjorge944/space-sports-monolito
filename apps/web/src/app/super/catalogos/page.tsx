import type { Metadata } from 'next';
import { CatalogView } from '@/components/super/catalog/catalog-view';

export const metadata: Metadata = { title: 'Catálogos' };

export default function CatalogPage() {
  return <CatalogView />;
}

import type { Metadata } from 'next';
import { PageHeader } from '@/components/super/page-header';
import { SpaceForm } from '@/components/super/spaces/space-form';

export const metadata: Metadata = { title: 'Novo espaço' };

export default function NewSpacePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: '/super/espacos', label: 'Espaços' }}
        title="Novo espaço"
        description="Implantação assistida: o espaço já nasce ativo e aparece na vitrine quando tiver quadra ativa e preço por hora."
      />
      <SpaceForm mode="create" />
    </div>
  );
}

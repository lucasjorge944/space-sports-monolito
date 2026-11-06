'use client';

import { useSuperGetSpace } from '@space-sports/api-client';
import { PageHeader } from '../page-header';
import { ErrorBlock, LoadingBlock } from '../query-states';
import { SpaceForm } from './space-form';

export function EditSpace({ spaceId }: { spaceId: string }) {
  const query = useSuperGetSpace(spaceId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/super/espacos/${spaceId}`, label: 'Voltar ao espaço' }}
        title={query.data ? `Editar ${query.data.name}` : 'Editar espaço'}
      />
      {query.isPending ? (
        <LoadingBlock />
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <SpaceForm mode="edit" space={query.data} />
      )}
    </div>
  );
}

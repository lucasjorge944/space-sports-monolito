'use client';

import {
  useSuperCreateAmenity,
  useSuperCreateCity,
  useSuperCreateSport,
  useSuperDeleteAmenity,
  useSuperDeleteCity,
  useSuperDeleteSport,
  useSuperListAmenities,
  useSuperListCities,
  useSuperListLevels,
  useSuperListSports,
  useSuperUpdateAmenity,
  useSuperUpdateCity,
  useSuperUpdateSport,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  toAmenityInput,
  toCityInput,
  toSportInput,
  validateAmenity,
  validateCity,
  validateSport,
} from '@/lib/super/catalog-forms';
import { invalidateSuper } from '@/lib/super/invalidate';
import { levelLabel } from '@/lib/super/labels';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { CatalogPanel } from './catalog-panel';

function SportsPanel() {
  const queryClient = useQueryClient();
  const query = useSuperListSports();
  const create = useSuperCreateSport();
  const update = useSuperUpdateSport();
  const remove = useSuperDeleteSport();
  const refresh = () => invalidateSuper(queryClient);
  return (
    <CatalogPanel
      noun="esporte"
      query={query}
      items={query.data?.items}
      itemName={(item) => item.name}
      fields={[
        { name: 'name', label: 'Nome', maxLength: 80 },
        { name: 'slug', label: 'Identificador (slug)', maxLength: 80 },
        { name: 'icon', label: 'Ícone', optional: true, maxLength: 60 },
        {
          name: 'defaultMaxPlayers',
          label: 'Máximo de jogadores padrão',
          optional: true,
          type: 'number',
        },
      ]}
      columns={[
        { header: 'Nome', cell: (item) => item.name },
        { header: 'Slug', cell: (item) => item.slug },
        { header: 'Ícone', cell: (item) => item.icon },
        { header: 'Máx. jogadores', cell: (item) => item.defaultMaxPlayers },
      ]}
      initialValues={(item) => ({
        name: item?.name ?? '',
        slug: item?.slug ?? '',
        icon: item?.icon ?? '',
        defaultMaxPlayers: item ? String(item.defaultMaxPlayers) : '',
      })}
      validate={validateSport}
      onSave={async (values, item) => {
        const data = toSportInput(values);
        if (item) await update.mutateAsync({ sportId: item.id, data });
        else await create.mutateAsync({ data });
        await refresh();
      }}
      onDelete={async (item) => {
        await remove.mutateAsync({ sportId: item.id });
        await refresh();
      }}
    />
  );
}

function AmenitiesPanel() {
  const queryClient = useQueryClient();
  const query = useSuperListAmenities();
  const create = useSuperCreateAmenity();
  const update = useSuperUpdateAmenity();
  const remove = useSuperDeleteAmenity();
  const refresh = () => invalidateSuper(queryClient);
  return (
    <CatalogPanel
      noun="item de infraestrutura"
      query={query}
      items={query.data?.items}
      itemName={(item) => item.name}
      fields={[
        { name: 'name', label: 'Nome', maxLength: 80 },
        { name: 'slug', label: 'Identificador (slug)', maxLength: 80 },
        { name: 'icon', label: 'Ícone', optional: true, maxLength: 60 },
      ]}
      columns={[
        { header: 'Nome', cell: (item) => item.name },
        { header: 'Slug', cell: (item) => item.slug },
        { header: 'Ícone', cell: (item) => item.icon },
      ]}
      initialValues={(item) => ({
        name: item?.name ?? '',
        slug: item?.slug ?? '',
        icon: item?.icon ?? '',
      })}
      validate={validateAmenity}
      onSave={async (values, item) => {
        const data = toAmenityInput(values);
        if (item) await update.mutateAsync({ amenityId: item.id, data });
        else await create.mutateAsync({ data });
        await refresh();
      }}
      onDelete={async (item) => {
        await remove.mutateAsync({ amenityId: item.id });
        await refresh();
      }}
    />
  );
}

function CitiesPanel() {
  const queryClient = useQueryClient();
  const query = useSuperListCities();
  const create = useSuperCreateCity();
  const update = useSuperUpdateCity();
  const remove = useSuperDeleteCity();
  const refresh = () => invalidateSuper(queryClient);
  return (
    <CatalogPanel
      noun="cidade"
      query={query}
      items={query.data?.items}
      itemName={(item) => item.name}
      fields={[
        { name: 'name', label: 'Nome', maxLength: 120 },
        { name: 'state', label: 'UF', maxLength: 2 },
        { name: 'timezone', label: 'Fuso horário', optional: true, hint: 'America/Sao_Paulo' },
        { name: 'active', label: 'Cidade ativa', type: 'checkbox' },
      ]}
      columns={[
        { header: 'Cidade', cell: (item) => `${item.name} - ${item.state}` },
        { header: 'Fuso', cell: (item) => item.timezone },
        {
          header: 'Status',
          cell: (item) => (
            <Badge variant={item.active ? 'success' : 'muted'}>
              {item.active ? 'Ativa' : 'Inativa'}
            </Badge>
          ),
        },
      ]}
      initialValues={(item) => ({
        name: item?.name ?? '',
        state: item?.state ?? '',
        timezone: item?.timezone ?? '',
        active: item?.active ?? true,
      })}
      validate={validateCity}
      onSave={async (values, item) => {
        const data = toCityInput(values);
        if (item) await update.mutateAsync({ cityId: item.id, data });
        else await create.mutateAsync({ data });
        await refresh();
      }}
      onDelete={async (item) => {
        await remove.mutateAsync({ cityId: item.id });
        await refresh();
      }}
    />
  );
}

function LevelsPanel() {
  const query = useSuperListLevels();
  if (query.isPending) return <LoadingBlock rows={4} />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.items.length === 0) return <EmptyBlock>Nenhum nível.</EmptyBlock>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Os níveis são fixos por enquanto (somente leitura).
      </p>
      <ul className="grid gap-2">
        {query.data.items.map((level) => (
          <li key={level.value} className="flex items-center gap-2 text-sm">
            <Badge variant="outline">{level.value}</Badge>
            {levelLabel[level.value] ?? level.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CatalogView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catálogos"
        description="Esportes, infraestrutura, cidades e níveis usados em toda a plataforma."
      />
      <Tabs defaultValue="sports">
        <TabsList>
          <TabsTrigger value="sports">Esportes</TabsTrigger>
          <TabsTrigger value="amenities">Infraestrutura</TabsTrigger>
          <TabsTrigger value="cities">Cidades</TabsTrigger>
          <TabsTrigger value="levels">Níveis</TabsTrigger>
        </TabsList>
        <TabsContent value="sports">
          <SportsPanel />
        </TabsContent>
        <TabsContent value="amenities">
          <AmenitiesPanel />
        </TabsContent>
        <TabsContent value="cities">
          <CitiesPanel />
        </TabsContent>
        <TabsContent value="levels">
          <LevelsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

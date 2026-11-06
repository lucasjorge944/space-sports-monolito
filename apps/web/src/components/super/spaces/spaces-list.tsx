'use client';

import {
  type SuperListSpacesParams,
  useSuperListCities,
  useSuperListSpaces,
  useSuperListSports,
} from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SpaceAvatar } from '@/components/space-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDate } from '@/lib/format';
import { textLink } from '@/lib/utils';
import { SpaceStatusBadge } from '../badges';
import { PageHeader } from '../page-header';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

const PAGE_SIZE = 20;

export function SpacesList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cityId, setCityId] = useState('');
  const [sport, setSport] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim());

  const params: SuperListSpacesParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(status ? { status: status as NonNullable<SuperListSpacesParams['status']> } : {}),
    ...(cityId ? { cityId } : {}),
    ...(sport ? { sports: sport } : {}),
  };
  const spaces = useSuperListSpaces(params, { query: { placeholderData: keepPreviousData } });
  const cities = useSuperListCities();
  const sports = useSuperListSports();

  // Qualquer filtro novo volta para a primeira página.
  const onFilter =
    (set: (value: string) => void) =>
    (event: React.ChangeEvent<HTMLElement & { value: string }>) => {
      set(event.target.value);
      setPage(1);
    };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Espaços"
        description="Espaços cadastrados na plataforma."
        actions={
          <Button asChild>
            <Link href="/super/espacos/novo">
              <Plus aria-hidden="true" />
              Novo espaço
            </Link>
          </Button>
        }
      />

      <form
        aria-label="Filtros de espaços"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Buscar por nome"
            placeholder="Buscar por nome"
            className="pl-8"
            value={q}
            onChange={onFilter(setQ)}
          />
        </div>
        <Select aria-label="Status" value={status} onChange={onFilter(setStatus)}>
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativos</option>
          <option value="SUSPENDED">Suspensos</option>
          <option value="CLOSED">Encerrados</option>
        </Select>
        <Select aria-label="Cidade" value={cityId} onChange={onFilter(setCityId)}>
          <option value="">Todas as cidades</option>
          {cities.data?.items.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name} - {city.state}
            </option>
          ))}
        </Select>
        <Select aria-label="Esporte" value={sport} onChange={onFilter(setSport)}>
          <option value="">Todos os esportes</option>
          {sports.data?.items.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </Select>
      </form>

      {spaces.isPending ? (
        <LoadingBlock />
      ) : spaces.isError ? (
        <ErrorBlock error={spaces.error} onRetry={() => void spaces.refetch()} />
      ) : spaces.data.items.length === 0 ? (
        <EmptyBlock>Nenhum espaço encontrado com esses filtros.</EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={spaces.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Espaço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Esportes</TableHead>
                  <TableHead className="text-right">Quadras</TableHead>
                  <TableHead>Dono</TableHead>
                  <TableHead>Implantação</TableHead>
                  <TableHead>Criado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spaces.data.items.map((space) => (
                  <TableRow key={space.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <div className="flex items-center gap-3">
                        <SpaceAvatar
                          name={space.name}
                          logoUrl={space.logoUrl}
                          size={32}
                          decorative
                        />
                        <div>
                          <Link href={`/super/espacos/${space.id}`} className={textLink}>
                            {space.name}
                          </Link>
                          {space.status === 'ACTIVE' && !space.showcaseVisible ? (
                            <span className="text-muted-foreground block text-xs font-normal">
                              Fora da vitrine
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SpaceStatusBadge status={space.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {space.city.name} - {space.city.state}
                      <span className="text-muted-foreground block text-xs">
                        {space.neighborhood}
                      </span>
                    </TableCell>
                    <TableCell>
                      {space.sports.length > 0 ? (
                        <span
                          className="line-clamp-2"
                          title={space.sports.map((s) => s.name).join(', ')}
                        >
                          {space.sports.map((s) => s.name).join(', ')}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{space.courtsCount}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {space.owners.length > 0 ? (
                        space.owners.map((owner) => owner.name).join(', ')
                      ) : (
                        <span className="text-muted-foreground">Sem Dono</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          space.onboarding.doneCount === space.onboarding.total
                            ? 'success'
                            : 'outline'
                        }
                      >
                        {space.onboarding.doneCount}/{space.onboarding.total}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(space.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={spaces.data.page}
            pageSize={spaces.data.pageSize}
            total={spaces.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

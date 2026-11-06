'use client';

import {
  type Advertiser,
  type SuperListAdvertisersParams,
  useSuperListAdvertisers,
  useSuperUpdateAdvertiser,
} from '@space-sports/api-client';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
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
import { formatPhone } from '@/lib/format';
import {
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  adErrorMessage,
  advertiserKindLabel,
} from '@/lib/super/ads';
import { invalidateSuper } from '@/lib/super/invalidate';
import { cn, textLink } from '@/lib/utils';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { AdvertiserDialog } from './advertiser-dialog';

const PAGE_SIZE = 20;

/** Anunciantes (RF-ADS-01): busca, filtros, criar/editar e ativar/desativar. */
export function AdvertisersList() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ advertiser: Advertiser | undefined }>();
  const [toggling, setToggling] = useState<Advertiser>();
  const search = useDebouncedValue(q.trim());
  const update = useSuperUpdateAdvertiser();

  const params: SuperListAdvertisersParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(kind ? { kind: kind as NonNullable<SuperListAdvertisersParams['kind']> } : {}),
    ...(category
      ? { category: category as NonNullable<SuperListAdvertisersParams['category']> }
      : {}),
    ...(active ? { active } : {}),
  };
  const advertisers = useSuperListAdvertisers(params, {
    query: { placeholderData: keepPreviousData },
  });

  function filter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function toggle(advertiser: Advertiser) {
    update.mutate(
      { advertiserId: advertiser.id, data: { active: !advertiser.active } },
      {
        onSuccess: async () => {
          setToggling(undefined);
          toast.success(advertiser.active ? 'Anunciante desativado.' : 'Anunciante reativado.');
          await invalidateSuper(queryClient);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          aria-label="Filtros de anunciantes"
          className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              aria-label="Buscar anunciante pelo nome"
              placeholder="Nome do anunciante"
              className="pl-8"
              value={q}
              onChange={(event) => filter(setQ)(event.target.value)}
            />
          </div>
          <Select
            aria-label="Tipo"
            value={kind}
            onChange={(event) => filter(setKind)(event.target.value)}
          >
            <option value="">Todos os tipos</option>
            <option value="COMPANY">Empresas</option>
            <option value="SPACE">Espaços</option>
          </Select>
          <Select
            aria-label="Categoria"
            value={category}
            onChange={(event) => filter(setCategory)(event.target.value)}
          >
            <option value="">Todas as categorias</option>
            {AD_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {AD_CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Situação do anunciante"
            value={active}
            onChange={(event) => filter(setActive)(event.target.value)}
          >
            <option value="">Ativos e inativos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </Select>
        </form>
        <Button onClick={() => setEditing({ advertiser: undefined })}>
          <Plus aria-hidden="true" />
          Novo anunciante
        </Button>
      </div>

      {advertisers.isPending ? (
        <LoadingBlock />
      ) : advertisers.isError ? (
        <ErrorBlock error={advertisers.error} onRetry={() => void advertisers.refetch()} />
      ) : advertisers.data.items.length === 0 ? (
        <EmptyBlock>
          {search || kind || category || active
            ? 'Nenhum anunciante com esses filtros.'
            : 'Nenhum anunciante cadastrado. Comece pelo botão "Novo anunciante".'}
        </EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={advertisers.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anunciante</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="text-right">Campanhas</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advertisers.data.items.map((advertiser) => (
                  <TableRow key={advertiser.id}>
                    <TableCell>
                      <span className="font-medium">{advertiser.name}</span>
                      {advertiser.space ? (
                        <Link
                          href={`/super/espacos/${advertiser.space.id}`}
                          className={cn(textLink, 'block text-xs')}
                        >
                          {advertiser.space.name}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell>{advertiserKindLabel[advertiser.kind]}</TableCell>
                    <TableCell>{AD_CATEGORY_LABELS[advertiser.category]}</TableCell>
                    <TableCell>
                      {advertiser.contactName ||
                      advertiser.contactEmail ||
                      advertiser.contactPhone ? (
                        <span className="grid text-xs">
                          {advertiser.contactName ? (
                            <span className="text-sm">{advertiser.contactName}</span>
                          ) : null}
                          {advertiser.contactEmail ? (
                            <span className="text-muted-foreground">{advertiser.contactEmail}</span>
                          ) : null}
                          {advertiser.contactPhone ? (
                            <span className="text-muted-foreground">
                              {formatPhone(advertiser.contactPhone)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Link
                        href={`/super/anuncios?anunciante=${advertiser.id}`}
                        className={textLink}
                        aria-label={`${advertiser.campaignsCount} campanhas de ${advertiser.name}`}
                      >
                        {advertiser.campaignsCount}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={advertiser.active ? 'success' : 'muted'}>
                        {advertiser.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Editar ${advertiser.name}`}
                          onClick={() => setEditing({ advertiser })}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${advertiser.active ? 'Desativar' : 'Reativar'} ${advertiser.name}`}
                          onClick={() => {
                            update.reset();
                            setToggling(advertiser);
                          }}
                        >
                          {advertiser.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={advertisers.data.page}
            pageSize={advertisers.data.pageSize}
            total={advertisers.data.total}
            onPageChange={setPage}
          />
        </>
      )}

      <AdvertiserDialog
        open={editing !== undefined}
        advertiser={editing?.advertiser}
        onClose={() => setEditing(undefined)}
      />

      <ConfirmDialog
        open={toggling !== undefined}
        onOpenChange={(open) => !open && setToggling(undefined)}
        title={toggling?.active ? 'Desativar anunciante' : 'Reativar anunciante'}
        description={
          toggling?.active
            ? `As campanhas de ${toggling.name} saem do ar até o anunciante ser reativado.`
            : `As campanhas ativas de ${toggling?.name ?? ''} voltam ao ar dentro do período. Anunciante de espaço exige o espaço ativo.`
        }
        confirmLabel={toggling?.active ? 'Desativar' : 'Reativar'}
        destructive={toggling?.active ?? false}
        pending={update.isPending}
        error={update.error}
        formatError={adErrorMessage}
        onConfirm={() => toggling && toggle(toggling)}
      />
    </div>
  );
}

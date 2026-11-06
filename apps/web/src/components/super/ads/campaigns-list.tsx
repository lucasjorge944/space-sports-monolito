'use client';

import {
  type SuperListAdCampaignsParams,
  useSuperListAdCampaigns,
  useSuperListAdvertisers,
} from '@space-sports/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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
import { formatDateTime } from '@/lib/format';
import { AD_CAMPAIGN_STATUS_LABELS, AD_PLACEMENT_LABELS, AD_PLACEMENTS } from '@/lib/super/ads';
import { cn, textLink } from '@/lib/utils';
import { Pagination } from '../pagination';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import { CampaignSituationBadge, DuplicateCampaignButton } from './campaign-parts';

const PAGE_SIZE = 20;
const STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;

/** Campanhas (RF-ADS-02): filtros por anunciante, vaga, status e "no ar agora", com o selo de situação. */
export function CampaignsList({
  advertiserId,
  onAdvertiserChange,
}: {
  /** Filtro de anunciante, vindo da URL (`?anunciante=`); vazio = todos. */
  advertiserId: string;
  onAdvertiserChange: (advertiserId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [placement, setPlacement] = useState('');
  const [status, setStatus] = useState('');
  const [onAir, setOnAir] = useState('');
  const [page, setPage] = useState(1);
  // O anunciante muda pela URL (link do nº de campanhas, voltar/avançar): volta à 1ª página.
  const [pageAdvertiser, setPageAdvertiser] = useState(advertiserId);
  if (pageAdvertiser !== advertiserId) {
    setPageAdvertiser(advertiserId);
    setPage(1);
  }
  const search = useDebouncedValue(q.trim());

  const advertisers = useSuperListAdvertisers({ pageSize: 100 });
  const params: SuperListAdCampaignsParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { q: search } : {}),
    ...(advertiserId ? { advertiserId } : {}),
    ...(placement
      ? { placement: placement as NonNullable<SuperListAdCampaignsParams['placement']> }
      : {}),
    ...(status ? { status: status as NonNullable<SuperListAdCampaignsParams['status']> } : {}),
    ...(onAir ? { onAir } : {}),
  };
  const campaigns = useSuperListAdCampaigns(params, {
    query: { placeholderData: keepPreviousData },
  });

  function filter(setter: (value: string) => void) {
    return (event: { target: { value: string } }) => {
      setter(event.target.value);
      setPage(1);
    };
  }

  const filtered = Boolean(search || advertiserId || placement || status || onAir);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          aria-label="Filtros de campanhas"
          className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              aria-label="Buscar campanha ou anunciante"
              placeholder="Campanha ou anunciante"
              className="pl-8"
              value={q}
              onChange={filter(setQ)}
            />
          </div>
          <Select
            aria-label="Anunciante"
            value={advertiserId}
            onChange={filter(onAdvertiserChange)}
          >
            <option value="">Todos os anunciantes</option>
            {advertisers.data?.items.map((advertiser) => (
              <option key={advertiser.id} value={advertiser.id}>
                {advertiser.name}
                {advertiser.active ? '' : ' (inativo)'}
              </option>
            ))}
          </Select>
          <Select aria-label="Vaga" value={placement} onChange={filter(setPlacement)}>
            <option value="">Todas as vagas</option>
            {AD_PLACEMENTS.map((value) => (
              <option key={value} value={value}>
                {AD_PLACEMENT_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={filter(setStatus)}>
            <option value="">Todos os status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {AD_CAMPAIGN_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select aria-label="No ar agora" value={onAir} onChange={filter(setOnAir)}>
            <option value="">No ar ou não</option>
            <option value="true">No ar agora</option>
            <option value="false">Fora do ar</option>
          </Select>
        </form>
        <Button asChild>
          <Link
            href={
              advertiserId
                ? `/super/anuncios/campanhas/nova?anunciante=${advertiserId}`
                : '/super/anuncios/campanhas/nova'
            }
          >
            <Plus aria-hidden="true" />
            Nova campanha
          </Link>
        </Button>
      </div>

      {campaigns.isPending ? (
        <LoadingBlock />
      ) : campaigns.isError ? (
        <ErrorBlock error={campaigns.error} onRetry={() => void campaigns.refetch()} />
      ) : campaigns.data.items.length === 0 ? (
        <EmptyBlock>
          {filtered
            ? 'Nenhuma campanha com esses filtros.'
            : 'Nenhuma campanha cadastrada. Cadastre o anunciante e depois a campanha.'}
        </EmptyBlock>
      ) : (
        <>
          <div className="rounded-lg border" aria-busy={campaigns.isPlaceholderData}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Vaga</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Peças ativas</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.data.items.map((campaign) => (
                  <TableRow key={campaign.id} data-testid="campaign-row">
                    <TableCell>
                      <Link
                        href={`/super/anuncios/campanhas/${campaign.id}`}
                        className={cn(textLink, 'font-medium')}
                      >
                        {campaign.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {campaign.advertiser.name}
                      </span>
                    </TableCell>
                    <TableCell>{AD_PLACEMENT_LABELS[campaign.placement]}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {formatDateTime(campaign.startsAt)}
                      <span className="text-muted-foreground block">
                        até {formatDateTime(campaign.endsAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.activeCreativesCount} de {campaign.creativesCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{campaign.weight}</TableCell>
                    <TableCell>
                      <CampaignSituationBadge campaign={campaign} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DuplicateCampaignButton campaign={campaign} size="sm" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={campaigns.data.page}
            pageSize={campaigns.data.pageSize}
            total={campaigns.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

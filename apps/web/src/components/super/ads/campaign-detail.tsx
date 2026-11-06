'use client';

import {
  isApiError,
  useListCities,
  useListSports,
  useSuperGetAdCampaign,
} from '@space-sports/api-client';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';
import {
  AD_CAMPAIGN_STATUS_LABELS,
  AD_PLACEMENT_LABELS,
  advertiserKindLabel,
  offAirText,
  placementFormatText,
} from '@/lib/super/ads';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import {
  CampaignSituationBadge,
  CampaignStatusActions,
  DuplicateCampaignButton,
} from './campaign-parts';
import { CampaignReport } from './campaign-report';
import { CreativesPanel } from './creatives-panel';

export type CampaignTab = 'pecas' | 'relatorio';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Campanha: dados, status, peças (RF-ADS-03) e relatório (RF-ADS-09). */
export function CampaignDetail({
  campaignId,
  initialTab = 'pecas',
}: {
  campaignId: string;
  initialTab?: CampaignTab;
}) {
  const query = useSuperGetAdCampaign(campaignId);
  const cities = useListCities();
  const sports = useListSports();
  const [tab, setTab] = useState<CampaignTab>(initialTab);
  const router = useRouter();
  const pathname = usePathname();
  const back = { href: '/super/anuncios', label: 'Anúncios' };

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Campanha" back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Campanha" back={back} />
        {notFound ? (
          <EmptyBlock>Campanha não encontrada.</EmptyBlock>
        ) : (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const campaign = query.data;
  const cityNames = campaign.cityIds.map(
    (id) => cities.data?.items.find((city) => city.id === id)?.name ?? '…',
  );
  const sportNames = campaign.sportIds.map(
    (id) => sports.data?.items.find((sport) => sport.id === id)?.name ?? '…',
  );
  const why = offAirText(campaign.delivery.reasons);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {campaign.name}
            <CampaignSituationBadge campaign={campaign} />
          </span>
        }
        description={why ?? 'No ar: a campanha está sendo entregue no app.'}
        actions={
          <>
            <CampaignStatusActions campaign={campaign} />
            {campaign.status === 'ARCHIVED' ? null : (
              <Button variant="outline" asChild>
                <Link href={`/super/anuncios/campanhas/${campaign.id}/editar`}>
                  <Pencil aria-hidden="true" />
                  Editar
                </Link>
              </Button>
            )}
            <DuplicateCampaignButton campaign={campaign} />
          </>
        }
      />

      <Card>
        <CardContent>
          <dl className="grid gap-3">
            <Row label="Anunciante">
              {campaign.advertiser.name} · {advertiserKindLabel[campaign.advertiser.kind]}
              {campaign.advertiser.active ? '' : ' (inativo)'}
            </Row>
            <Row label="Vaga">
              {AD_PLACEMENT_LABELS[campaign.placement]}
              <span className="text-muted-foreground block text-xs">
                {placementFormatText(campaign.placement)}
              </span>
            </Row>
            <Row label="Período">
              {formatDateTime(campaign.startsAt)} até {formatDateTime(campaign.endsAt)}
            </Row>
            <Row label="Cidades">{cityNames.length === 0 ? 'Todas' : cityNames.join(', ')}</Row>
            <Row label="Esportes">{sportNames.length === 0 ? 'Todos' : sportNames.join(', ')}</Row>
            <Row label="Peso">{campaign.weight}</Row>
            <Row label="Status">{AD_CAMPAIGN_STATUS_LABELS[campaign.status]}</Row>
          </dl>
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as CampaignTab);
          router.replace(value === 'relatorio' ? `${pathname}?aba=relatorio` : pathname, {
            scroll: false,
          });
        }}
      >
        <TabsList>
          <TabsTrigger value="pecas">Peças ({campaign.creatives.length})</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório</TabsTrigger>
        </TabsList>
        <TabsContent value="pecas">
          <CreativesPanel campaign={campaign} />
        </TabsContent>
        <TabsContent value="relatorio">
          <CampaignReport campaign={campaign} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

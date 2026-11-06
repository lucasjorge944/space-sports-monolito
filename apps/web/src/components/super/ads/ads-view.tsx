'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adsSearchFrom, adsUrlState } from '@/lib/super/ads';
import { PageHeader } from '../page-header';
import { AdvertisersList } from './advertisers-list';
import { CampaignsList } from './campaigns-list';

/**
 * Anúncios do Explorar (RF-ADS-01, 02 e 09): campanhas e anunciantes, só no /super (decisão 76).
 * A URL é a fonte única da aba (`?aba=anunciantes`) e do filtro de anunciante (`?anunciante=`):
 * o link do nº de campanhas, o voltar/avançar do navegador e o "voltar" das telas internas
 * caem na mesma tela.
 */
export function AdsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { tab, advertiserId } = adsUrlState(params);

  function go(next: { tab?: typeof tab; advertiserId?: string }, mode: 'push' | 'replace') {
    const search = adsSearchFrom(params, next);
    router[mode](search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Anúncios"
        description="Venda direta de anúncios no Explorar do app: carrossel do topo e card na lista. Apostas e bebidas alcoólicas não anunciam."
      />
      <Tabs value={tab} onValueChange={(value) => go({ tab: value as typeof tab }, 'push')}>
        <TabsList>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="anunciantes">Anunciantes</TabsTrigger>
        </TabsList>
        <TabsContent value="campanhas">
          <CampaignsList
            advertiserId={advertiserId}
            // Trocar o filtro não empilha histórico (como os demais filtros da lista).
            onAdvertiserChange={(id) => go({ advertiserId: id }, 'replace')}
          />
        </TabsContent>
        <TabsContent value="anunciantes">
          <AdvertisersList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

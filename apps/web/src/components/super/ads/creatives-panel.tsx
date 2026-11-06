'use client';

import {
  type AdCampaignDetail,
  type AdCreative,
  useSuperReorderAdCreatives,
  useSuperUpdateAdCreative,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImageIcon, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPhone } from '@/lib/format';
import { adErrorMessage, moveId, placementAspect } from '@/lib/super/ads';
import { invalidateSuper } from '@/lib/super/invalidate';
import { cn } from '@/lib/utils';
import { EmptyBlock } from '../query-states';

function destinationText(creative: AdCreative): React.ReactNode {
  const d = creative.destination;
  if (d.type === 'URL') return d.url;
  if (d.type === 'WHATSAPP') return `WhatsApp ${formatPhone(d.phone)}`;
  return (
    <>
      Página do espaço {d.space.name}
      {d.space.showcaseVisible ? null : (
        <Badge variant="warning" className="ml-2">
          Fora da vitrine: não é entregue
        </Badge>
      )}
    </>
  );
}

/**
 * Peças da campanha (RF-ADS-03): lista na ordem do /super (a entrega sorteia uma peça por campanha),
 * com subir/descer, editar e ativar/desativar.
 */
export function CreativesPanel({ campaign }: { campaign: AdCampaignDetail }) {
  const queryClient = useQueryClient();
  const reorder = useSuperReorderAdCreatives();
  const update = useSuperUpdateAdCreative();
  const creatives = [...campaign.creatives].sort((a, b) => a.position - b.position);
  const ids = creatives.map((creative) => creative.id);
  const archived = campaign.status === 'ARCHIVED';
  const busy = reorder.isPending || update.isPending;

  function move(index: number, delta: -1 | 1) {
    reorder.mutate(
      { campaignId: campaign.id, data: { creativeIds: moveId(ids, index, delta) } },
      {
        onSuccess: () => invalidateSuper(queryClient),
        onError: (error) => toast.error(adErrorMessage(error)),
      },
    );
  }

  function toggle(creative: AdCreative) {
    update.mutate(
      { campaignId: campaign.id, creativeId: creative.id, data: { active: !creative.active } },
      {
        onSuccess: async () => {
          toast.success(creative.active ? 'Peça desativada.' : 'Peça ativada.');
          await invalidateSuper(queryClient);
        },
        onError: (error) => toast.error(adErrorMessage(error)),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          A cada exibição o app sorteia uma peça ativa da campanha. A ordem só organiza esta lista.
        </p>
        {archived ? null : (
          <Button asChild>
            <Link href={`/super/anuncios/campanhas/${campaign.id}/pecas/nova`}>
              <Plus aria-hidden="true" />
              Nova peça
            </Link>
          </Button>
        )}
      </div>

      {creatives.length === 0 ? (
        <EmptyBlock>Nenhuma peça. Sem peça ativa a campanha não vai ao ar.</EmptyBlock>
      ) : (
        <ol aria-label="Peças da campanha" className="flex flex-col gap-3" aria-busy={busy}>
          {creatives.map((creative, index) => (
            <li
              key={creative.id}
              data-testid="creative-item"
              className="bg-card flex flex-wrap items-center gap-4 rounded-lg border p-3"
            >
              <div
                className={cn(
                  'bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-md',
                  campaign.placement === 'EXPLORE_HERO' ? 'w-32' : 'w-20',
                )}
                style={{ aspectRatio: placementAspect(campaign.placement) }}
              >
                {creative.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: miniatura do storage, sem otimização do Next
                  <img src={creative.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-muted-foreground flex flex-col items-center gap-1 p-1 text-center text-xs">
                    <ImageIcon className="size-4" aria-hidden />
                    Capa do espaço
                  </span>
                )}
              </div>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{creative.title}</span>
                  <Badge variant={creative.active ? 'success' : 'muted'}>
                    {creative.active ? 'Ativa' : 'Inativa'}
                  </Badge>
                </span>
                {creative.body ? (
                  <span className="text-muted-foreground text-sm">{creative.body}</span>
                ) : null}
                <span className="text-muted-foreground text-xs break-all">
                  Botão "{creative.ctaLabel}" → {destinationText(creative)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Subir ${creative.title}`}
                  disabled={archived || busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Descer ${creative.title}`}
                  disabled={archived || busy || index === creatives.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                {archived ? null : (
                  <>
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        href={`/super/anuncios/campanhas/${campaign.id}/pecas/${creative.id}`}
                        aria-label={`Editar ${creative.title}`}
                      >
                        Editar
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`${creative.active ? 'Desativar' : 'Ativar'} ${creative.title}`}
                      onClick={() => toggle(creative)}
                    >
                      {creative.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

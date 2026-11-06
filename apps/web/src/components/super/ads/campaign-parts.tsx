'use client';

import {
  type AdCampaign,
  type AdCampaignStatus,
  useSuperChangeAdCampaignStatus,
  useSuperDuplicateAdCampaign,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AD_CAMPAIGN_STATUS_TRANSITIONS,
  adErrorMessage,
  campaignSituation,
  campaignSituationLabel,
  campaignSituationVariant,
  offAirText,
} from '@/lib/super/ads';
import { invalidateSuper } from '@/lib/super/invalidate';

type CampaignLike = Pick<AdCampaign, 'id' | 'name' | 'status' | 'delivery'>;

/** "No ar", "Agendada", "Encerrada", "Pausada", "Sem peças", "Anunciante inativo" (RF-ADS-02). */
export function CampaignSituationBadge({ campaign }: { campaign: CampaignLike }) {
  const situation = campaignSituation(campaign);
  const why = offAirText(campaign.delivery.reasons);
  return (
    <Badge
      variant={campaignSituationVariant[situation]}
      title={why ?? 'Entregue no app agora.'}
      data-testid="campaign-situation"
    >
      {campaignSituationLabel[situation]}
    </Badge>
  );
}

/** Duplicar: cópia em rascunho, com " (cópia)" no nome, as peças e as imagens. */
export function DuplicateCampaignButton({
  campaign,
  size,
}: {
  campaign: CampaignLike;
  size?: 'sm' | 'default';
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const duplicate = useSuperDuplicateAdCampaign();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant="outline"
        aria-label={`Duplicar ${campaign.name}`}
        onClick={() => {
          duplicate.reset();
          setOpen(true);
        }}
      >
        <Copy aria-hidden="true" />
        Duplicar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Duplicar campanha"
        description={`Cria "${campaign.name} (cópia)" em rascunho, com as mesmas peças e imagens. Ajuste o período e ative quando estiver pronta.`}
        confirmLabel="Duplicar"
        destructive={false}
        pending={duplicate.isPending}
        error={duplicate.error}
        formatError={adErrorMessage}
        onConfirm={() =>
          duplicate.mutate(
            { campaignId: campaign.id },
            {
              onSuccess: async (copy) => {
                setOpen(false);
                toast.success('Campanha duplicada.');
                await invalidateSuper(queryClient);
                router.push(`/super/anuncios/campanhas/${copy.id}`);
              },
            },
          )
        }
      />
    </>
  );
}

const ACTION_LABEL: Record<AdCampaignStatus, string> = {
  DRAFT: 'Voltar a rascunho',
  ACTIVE: 'Ativar',
  PAUSED: 'Pausar',
  ARCHIVED: 'Arquivar',
};

const ACTION_DESCRIPTION: Record<AdCampaignStatus, string> = {
  DRAFT: '',
  ACTIVE:
    'A campanha entra no ar dentro do período, se o anunciante estiver ativo e houver peça ativa.',
  PAUSED: 'A campanha sai do ar até ser ativada de novo. O relatório continua disponível.',
  ARCHIVED:
    'Arquivar é definitivo: a campanha sai do ar e não volta. Para repetir, duplique a campanha.',
};

/** Mudanças de status permitidas a partir do atual (`DRAFT` → ativa/arquivada; ativa ↔ pausada). */
export function CampaignStatusActions({ campaign }: { campaign: CampaignLike }) {
  const queryClient = useQueryClient();
  const change = useSuperChangeAdCampaignStatus();
  const [target, setTarget] = useState<AdCampaignStatus>();
  const options = AD_CAMPAIGN_STATUS_TRANSITIONS[campaign.status];
  return (
    <>
      {options.map((status) => (
        <Button
          key={status}
          variant={status === 'ACTIVE' ? 'default' : 'outline'}
          onClick={() => {
            change.reset();
            setTarget(status);
          }}
        >
          {ACTION_LABEL[status]}
        </Button>
      ))}
      <ConfirmDialog
        open={target !== undefined}
        onOpenChange={(open) => !open && setTarget(undefined)}
        title={target ? `${ACTION_LABEL[target]} campanha` : ''}
        description={target ? ACTION_DESCRIPTION[target] : ''}
        confirmLabel={target ? ACTION_LABEL[target] : ''}
        destructive={target === 'ARCHIVED'}
        pending={change.isPending}
        error={change.error}
        formatError={adErrorMessage}
        onConfirm={() =>
          target &&
          change.mutate(
            { campaignId: campaign.id, data: { status: target } },
            {
              onSuccess: async () => {
                setTarget(undefined);
                toast.success('Status da campanha atualizado.');
                await invalidateSuper(queryClient);
              },
            },
          )
        }
      />
    </>
  );
}

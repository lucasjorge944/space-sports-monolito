'use client';

import {
  type AdCampaignDetail,
  isApiError,
  useListCities,
  useListSports,
  useSuperCreateAdCampaign,
  useSuperGetAdCampaign,
  useSuperListAdvertisers,
  useSuperUpdateAdCampaign,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { GalleryHorizontal, LayoutList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { Field } from '@/components/painel/field';
import { OptionCards } from '@/components/painel/option-cards';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChipButton } from '@/components/ui/chip';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import {
  AD_CAMPAIGN_STATUS_LABELS,
  AD_PLACEMENT_LABELS,
  adErrorField,
  adErrorMessage,
  advertiserKindLabel,
  type CampaignFormValues,
  campaignFormFrom,
  campaignPayload,
  emptyCampaignForm,
  placementDescription,
  placementFormatText,
  validateCampaign,
} from '@/lib/super/ads';
import { fieldErrorsFrom } from '@/lib/super/api-errors';
import { invalidateSuper } from '@/lib/super/invalidate';
import { focusFirstInvalid } from '@/lib/utils';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';

/** Nova campanha (`advertiserId` pré-escolhido opcional) ou edição (`campaignId`). RF-ADS-02. */
export function CampaignFormPage({
  campaignId,
  advertiserId,
}: {
  campaignId?: string;
  advertiserId?: string | undefined;
}) {
  const campaign = useSuperGetAdCampaign(campaignId ?? '', { query: { enabled: !!campaignId } });
  const back = campaignId
    ? { href: `/super/anuncios/campanhas/${campaignId}`, label: 'Campanha' }
    : { href: '/super/anuncios', label: 'Anúncios' };
  const title = campaignId ? 'Editar campanha' : 'Nova campanha';

  if (campaignId && campaign.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (campaignId && campaign.isError) {
    const notFound = isApiError(campaign.error) && campaign.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        {notFound ? (
          <EmptyBlock>Campanha não encontrada.</EmptyBlock>
        ) : (
          <ErrorBlock error={campaign.error} onRetry={() => void campaign.refetch()} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        back={back}
        description="Período em horário de Brasília. Sem cidade ou esporte marcado, a campanha vale para todos."
      />
      <CampaignForm campaign={campaign.data} advertiserId={advertiserId} />
    </div>
  );
}

function CampaignForm({
  campaign,
  advertiserId,
}: {
  campaign: AdCampaignDetail | undefined;
  advertiserId: string | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const advertisers = useSuperListAdvertisers({ pageSize: 100 }, { query: { enabled: !campaign } });
  const cities = useListCities();
  const sports = useListSports();
  const create = useSuperCreateAdCampaign();
  const update = useSuperUpdateAdCampaign();
  const [values, setValues] = useState<CampaignFormValues>(() =>
    campaign ? campaignFormFrom(campaign) : emptyCampaignForm(advertiserId ?? ''),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const pending = create.isPending || update.isPending;
  const placementLocked = (campaign?.creativesCount ?? 0) > 0;

  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const toggle = (key: 'cityIds' | 'sportIds', id: string) =>
    setValues((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((item) => item !== id)
        : [...current[key], id],
    }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const found = validateCampaign(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(event.currentTarget);
    const payload = campaignPayload(values);
    try {
      if (campaign) {
        const { placement, ...rest } = payload;
        await update.mutateAsync({
          campaignId: campaign.id,
          // A vaga só vai quando muda: com peças, a API recusa qualquer valor (`AD_PLACEMENT_LOCKED`).
          data: placement === campaign.placement ? rest : payload,
        });
        toast.success('Campanha atualizada.');
        await invalidateSuper(queryClient);
        router.push(`/super/anuncios/campanhas/${campaign.id}`);
      } else {
        const created = await create.mutateAsync({
          data: { ...payload, advertiserId: values.advertiserId, status: values.status },
        });
        toast.success('Campanha criada. Agora cadastre as peças.');
        await invalidateSuper(queryClient);
        router.push(`/super/anuncios/campanhas/${created.id}`);
      }
    } catch (error) {
      const fields = fieldErrorsFrom(error);
      const field = adErrorField(error);
      const message = adErrorMessage(error);
      if (field) fields[field] = message;
      setErrors(fields);
      setFormError(
        field || Object.keys(fields).length > 0 ? 'Confira os campos destacados.' : message,
      );
    }
  }

  const advertiserOptions = advertisers.data?.items ?? [];
  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid max-w-3xl gap-5">
          {campaign ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Anunciante: </span>
              {campaign.advertiser.name} · {advertiserKindLabel[campaign.advertiser.kind]}
              <span className="text-muted-foreground block text-xs">
                O anunciante não muda; para outro anunciante, crie outra campanha.
              </span>
            </p>
          ) : (
            <Field label="Anunciante" htmlFor="campaign-advertiser" error={errors.advertiserId}>
              <Select
                name="advertiserId"
                value={values.advertiserId}
                onChange={(event) => set('advertiserId', event.target.value)}
              >
                <option value="">
                  {advertisers.isPending
                    ? 'Carregando anunciantes…'
                    : advertiserOptions.length === 0
                      ? 'Cadastre um anunciante antes'
                      : 'Escolha o anunciante'}
                </option>
                {advertiserOptions.map((advertiser) => (
                  <option key={advertiser.id} value={advertiser.id}>
                    {advertiser.name} · {advertiserKindLabel[advertiser.kind]}
                    {advertiser.active ? '' : ' (inativo)'}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Nome da campanha" htmlFor="campaign-name" error={errors.name}>
            <Input
              name="name"
              maxLength={120}
              value={values.name}
              onChange={(event) => set('name', event.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Vaga"
            group
            error={errors.placement}
            hint={
              placementLocked
                ? 'A vaga não muda depois que a campanha tem peças (as imagens são do formato da vaga).'
                : undefined
            }
          >
            <OptionCards
              label="Vaga"
              name="campaign-placement"
              value={values.placement as 'EXPLORE_HERO' | 'EXPLORE_FEED'}
              disabled={placementLocked}
              onChange={(placement) => set('placement', placement)}
              options={[
                {
                  value: 'EXPLORE_HERO',
                  label: AD_PLACEMENT_LABELS.EXPLORE_HERO,
                  description: `${placementDescription.EXPLORE_HERO} ${placementFormatText('EXPLORE_HERO')}.`,
                  icon: GalleryHorizontal,
                },
                {
                  value: 'EXPLORE_FEED',
                  label: AD_PLACEMENT_LABELS.EXPLORE_FEED,
                  description: `${placementDescription.EXPLORE_FEED} ${placementFormatText('EXPLORE_FEED')}.`,
                  icon: LayoutList,
                },
              ]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Início" group error={errors.startsAt} hint="Horário de Brasília">
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <DatePicker
                  aria-label="Data de início"
                  value={values.startDate}
                  onValueChange={(date) => set('startDate', date)}
                />
                <TimeInput
                  aria-label="Hora de início"
                  value={values.startTime}
                  onValueChange={(time) => set('startTime', time)}
                />
              </div>
            </Field>
            <Field label="Fim" group error={errors.endsAt} hint="Horário de Brasília">
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <DatePicker
                  aria-label="Data de fim"
                  value={values.endDate}
                  min={values.startDate || undefined}
                  onValueChange={(date) => set('endDate', date)}
                />
                <TimeInput
                  aria-label="Hora de fim"
                  value={values.endTime}
                  onValueChange={(time) => set('endTime', time)}
                />
              </div>
            </Field>
          </div>

          <Field
            label="Cidades"
            group
            error={errors.cityIds}
            hint={
              values.cityIds.length === 0
                ? 'Nenhuma marcada: a campanha aparece em todas as cidades.'
                : `${values.cityIds.length} marcada(s).`
            }
          >
            {cities.isPending ? (
              <p className="text-muted-foreground text-sm">Carregando cidades…</p>
            ) : cities.isError ? (
              <ErrorBlock error={cities.error} onRetry={() => void cities.refetch()} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {cities.data.items.map((city) => (
                  <ChipButton
                    key={city.id}
                    selected={values.cityIds.includes(city.id)}
                    onClick={() => toggle('cityIds', city.id)}
                  >
                    {city.name} - {city.state}
                  </ChipButton>
                ))}
              </div>
            )}
          </Field>

          <Field
            label="Esportes"
            group
            error={errors.sportIds}
            hint={
              values.sportIds.length === 0
                ? 'Nenhum marcado: a campanha aparece com ou sem filtro de esporte.'
                : 'A campanha aparece para quem filtra por um destes esportes.'
            }
          >
            {sports.isPending ? (
              <p className="text-muted-foreground text-sm">Carregando esportes…</p>
            ) : sports.isError ? (
              <ErrorBlock error={sports.error} onRetry={() => void sports.refetch()} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {sports.data.items.map((sport) => (
                  <ChipButton
                    key={sport.id}
                    selected={values.sportIds.includes(sport.id)}
                    onClick={() => toggle('sportIds', sport.id)}
                  >
                    {sport.name}
                  </ChipButton>
                ))}
              </div>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Peso"
              htmlFor="campaign-weight"
              error={errors.weight}
              hint="De 1 a 10. No sorteio, peso 10 aparece até 10 vezes mais que peso 1."
            >
              <Select
                name="weight"
                value={values.weight}
                onChange={(event) => set('weight', event.target.value)}
              >
                {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((weight) => (
                  <option key={weight} value={weight}>
                    {weight}
                  </option>
                ))}
              </Select>
            </Field>
            {campaign ? (
              <div className="grid content-start gap-1.5 text-sm">
                <span className="font-medium">Status</span>
                <span>{AD_CAMPAIGN_STATUS_LABELS[campaign.status]}</span>
                <span className="text-muted-foreground text-helper">
                  Mude o status pelos botões da campanha.
                </span>
              </div>
            ) : (
              <Field
                label="Status"
                htmlFor="campaign-status"
                hint="Rascunho não vai ao ar. Ativa entra no ar no período, com peça ativa."
              >
                <Select
                  name="status"
                  value={values.status}
                  onChange={(event) =>
                    set('status', event.target.value as CampaignFormValues['status'])
                  }
                >
                  <option value="DRAFT">{AD_CAMPAIGN_STATUS_LABELS.DRAFT}</option>
                  <option value="ACTIVE">{AD_CAMPAIGN_STATUS_LABELS.ACTIVE}</option>
                  <option value="PAUSED">{AD_CAMPAIGN_STATUS_LABELS.PAUSED}</option>
                </Select>
              </Field>
            )}
          </div>

          <FormError message={formError} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pending={pending} pendingLabel="Salvando…">
              {campaign ? 'Salvar campanha' : 'Criar campanha'}
            </SubmitButton>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => router.back()}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import {
  type AdCampaignDetail,
  type AdCreative,
  type Advertiser,
  isApiError,
  type SuperSpaceShowcase,
  useGetSpaceBySlug,
  useSuperCreateAdCreative,
  useSuperCreateAdImageUpload,
  useSuperGetAdCampaign,
  useSuperGetAdvertiser,
  useSuperGetSpace,
  useSuperUpdateAdCreative,
} from '@space-sports/api-client';
import { AD_IMAGE_CONTENT_TYPES, AD_IMAGE_MAX_BYTES, type AdPlacement } from '@space-sports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ImagePlus, Link2, MessageCircle, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormNotice } from '@/components/auth/form-alert';
import { SubmitButton } from '@/components/auth/submit-button';
import { ImageCropDialog } from '@/components/image-crop-dialog';
import { Field } from '@/components/painel/field';
import { OptionCards } from '@/components/painel/option-cards';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MaskedInput } from '@/components/ui/masked-input';
import { Textarea } from '@/components/ui/textarea';
import { validateAvatarSource } from '@/lib/account/avatar';
import type { CropBox } from '@/lib/image-crop';
import {
  AD_CROP_TOO_LARGE,
  AD_PLACEMENT_LABELS,
  AD_STORAGE_PUT_FAILED,
  AD_TEXT_LIMITS,
  adCropProblem,
  adCropRenderMessage,
  adErrorField,
  adErrorMessage,
  adOutputSize,
  type CreativeFormValues,
  canSkipImage,
  creativeFormFrom,
  creativePayload,
  destinationCaption,
  emptyCreativeForm,
  isImageResendError,
  placementAspect,
  placementFormatText,
  showcaseWarning,
  validateCreative,
} from '@/lib/super/ads';
import { fieldErrorsFrom } from '@/lib/super/api-errors';
import { invalidateSuper } from '@/lib/super/invalidate';
import { focusFirstInvalid } from '@/lib/utils';
import { PageHeader } from '../page-header';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../query-states';
import type { PreviewContent, PreviewSpace } from './ad-preview';
import { CreativePreviewPanel } from './creative-preview-panel';
import { SpacePicker } from './space-picker';

type ImageState =
  | { kind: 'saved'; url: string }
  | { kind: 'uploaded'; key: string; previewUrl: string }
  | { kind: 'none' };

type AdImageType = (typeof AD_IMAGE_CONTENT_TYPES)[number];

/**
 * Gera o arquivo da peça a partir do recorte: proporção exata da vaga, sem ampliar. Se passar de
 * 2 MB, tenta de novo em JPEG com menos qualidade (fundo branco no lugar da transparência).
 */
async function renderAdCrop(
  image: HTMLImageElement,
  box: CropBox,
  sourceType: string,
  placement: AdPlacement,
): Promise<File> {
  const out = adOutputSize(box, placement);
  const keepsType = sourceType === 'image/png' || sourceType === 'image/webp';
  const attempts: [AdImageType, number][] = [
    [keepsType ? (sourceType as AdImageType) : 'image/jpeg', 0.9],
    ['image/jpeg', 0.85],
    ['image/jpeg', 0.72],
  ];
  for (const [type, quality] of attempts) {
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, out.width, out.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error('canvas');
    const produced = (AD_IMAGE_CONTENT_TYPES as readonly string[]).includes(blob.type)
      ? (blob.type as AdImageType)
      : type;
    if (blob.size <= AD_IMAGE_MAX_BYTES) {
      const ext = produced === 'image/png' ? 'png' : produced === 'image/webp' ? 'webp' : 'jpg';
      return new File([blob], `peca.${ext}`, { type: produced });
    }
  }
  throw new Error(AD_CROP_TOO_LARGE);
}

/** Criar ou editar peça (RF-ADS-03), com a pré-visualização no app nos dois temas. */
export function CreativeEditor({
  campaignId,
  creativeId,
}: {
  campaignId: string;
  creativeId?: string;
}) {
  const campaign = useSuperGetAdCampaign(campaignId);
  const advertiser = useSuperGetAdvertiser(campaign.data?.advertiser.id ?? '', {
    query: { enabled: !!campaign.data },
  });
  const back = { href: `/super/anuncios/campanhas/${campaignId}`, label: 'Campanha' };
  const title = creativeId ? 'Editar peça' : 'Nova peça';

  const error = campaign.error ?? advertiser.error;
  if (campaign.isPending || (campaign.data && advertiser.isPending)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        <LoadingBlock />
      </div>
    );
  }
  if (error || !campaign.data || !advertiser.data) {
    const notFound = isApiError(error) && error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        {notFound ? (
          <EmptyBlock>Campanha não encontrada.</EmptyBlock>
        ) : (
          <ErrorBlock
            error={error}
            onRetry={() => {
              void campaign.refetch();
              void advertiser.refetch();
            }}
          />
        )}
      </div>
    );
  }
  const creative = creativeId
    ? campaign.data.creatives.find((item) => item.id === creativeId)
    : undefined;
  if (creativeId && !creative) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        <EmptyBlock>Peça não encontrada.</EmptyBlock>
      </div>
    );
  }
  if (campaign.data.status === 'ARCHIVED') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={title} back={back} />
        <EmptyBlock>
          Campanha arquivada não recebe nem altera peças. Duplique a campanha.
        </EmptyBlock>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        back={back}
        description={`${campaign.data.name} · ${AD_PLACEMENT_LABELS[campaign.data.placement]} · ${advertiser.data.name}`}
      />
      <CreativeForm
        key={creative?.id ?? 'new'}
        campaign={campaign.data}
        advertiser={advertiser.data}
        creative={creative}
        onPlacementMaybeChanged={() => void campaign.refetch()}
      />
    </div>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <span className="tabular-nums">
      {value.trim().length}/{max} caracteres
    </span>
  );
}

function CreativeForm({
  campaign,
  advertiser,
  creative,
  onPlacementMaybeChanged,
}: {
  campaign: AdCampaignDetail;
  advertiser: Advertiser;
  creative: AdCreative | undefined;
  onPlacementMaybeChanged: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const placement = campaign.placement;
  const ownSpace = advertiser.kind === 'SPACE' ? advertiser.space : null;
  const initialImage: ImageState = creative?.imageUrl
    ? { kind: 'saved', url: creative.imageUrl }
    : { kind: 'none' };

  const [values, setValues] = useState<CreativeFormValues>(() =>
    creative ? creativeFormFrom(creative) : emptyCreativeForm(ownSpace?.id ?? ''),
  );
  const [spaceName, setSpaceName] = useState<string | undefined>(
    creative?.destination.type === 'SPACE' ? creative.destination.space.name : ownSpace?.name,
  );
  const [image, setImage] = useState<ImageState>(initialImage);
  const [source, setSource] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const requestUpload = useSuperCreateAdImageUpload();
  const create = useSuperCreateAdCreative();
  const update = useSuperUpdateAdCreative();
  const saving = create.isPending || update.isPending;

  // O recorte local vira URL `blob:` para a prévia; libera ao trocar ou sair.
  useEffect(() => {
    if (image.kind !== 'uploaded') return;
    const url = image.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const set = <K extends keyof CreativeFormValues>(key: K, value: CreativeFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const skipAllowed = canSkipImage(
    { kind: advertiser.kind, spaceId: ownSpace?.id ?? null },
    values,
  );
  const imageUrl =
    image.kind === 'saved' ? image.url : image.kind === 'uploaded' ? image.previewUrl : null;

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    const invalid = validateAvatarSource(file);
    setErrors((current) => {
      const { image: _, ...rest } = current;
      return invalid ? { ...rest, image: invalid } : rest;
    });
    setUploadError(undefined);
    if (!invalid) setSource(file);
  }

  async function upload(cropped: File) {
    setUploading(true);
    setUploadError(undefined);
    try {
      const target = await requestUpload.mutateAsync({
        data: { placement, contentType: cropped.type as AdImageType, size: cropped.size },
      });
      // Envio direto ao storage (URL pré-assinada), fora da API.
      const put = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: cropped,
      });
      if (!put.ok) throw new Error(AD_STORAGE_PUT_FAILED);
      setImage({ kind: 'uploaded', key: target.key, previewUrl: URL.createObjectURL(cropped) });
      setErrors(({ image: _, ...rest }) => rest);
      setSource(null);
    } catch (error) {
      setUploadError(adErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const found = validateCreative(values);
    if (image.kind === 'none' && !skipAllowed) {
      found.image = `Envie a imagem da peça (${placementFormatText(placement)}).`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirstInvalid(event.currentTarget);

    const payload = creativePayload(values);
    // Só manda `imageKey` quando a imagem muda: novo envio, ou `null` para tirar a imagem.
    const imageKey =
      image.kind === 'uploaded'
        ? image.key
        : image.kind === 'none' && initialImage.kind === 'saved'
          ? null
          : undefined;
    try {
      if (creative) {
        await update.mutateAsync({
          campaignId: campaign.id,
          creativeId: creative.id,
          data: { ...payload, ...(imageKey !== undefined ? { imageKey } : {}) },
        });
        toast.success('Peça salva.');
      } else {
        await create.mutateAsync({
          campaignId: campaign.id,
          data: { ...payload, ...(imageKey ? { imageKey } : {}) },
        });
        toast.success('Peça criada.');
      }
      await invalidateSuper(queryClient);
      router.push(`/super/anuncios/campanhas/${campaign.id}`);
    } catch (error) {
      const message = adErrorMessage(error);
      if (isImageResendError(error)) {
        // A imagem enviada não vale mais (ex.: a vaga mudou): volta à anterior e pede outra.
        setImage(initialImage);
        onPlacementMaybeChanged();
      }
      const fields = fieldErrorsFrom(error);
      const field = adErrorField(error);
      if (field) fields[field] = message;
      // `destination.url`, `destination.phone`… da validação da API → campos do formulário.
      const mapped: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        const name =
          {
            'destination.url': 'url',
            'destination.phone': 'whatsappPhone',
            'destination.message': 'whatsappMessage',
            'destination.spaceId': 'spaceId',
          }[key] ?? key;
        mapped[name] = value;
      }
      setErrors(mapped);
      setFormError(Object.keys(mapped).length > 0 ? 'Confira os campos destacados.' : message);
    }
  }

  // Dados do espaço para a prévia: o do destino, ou o do próprio anunciante.
  const previewSpaceId =
    values.destinationType === 'SPACE' && values.spaceId ? values.spaceId : (ownSpace?.id ?? '');
  const { space: previewSpace, showcase } = usePreviewSpace(previewSpaceId);
  // Destino num espaço fora da vitrine: a API não entrega a peça (RN-ADS-05).
  const destinationHidden =
    values.destinationType === 'SPACE' && !!values.spaceId && showcase?.visible === false;
  const usesSpaceCover = skipAllowed && imageUrl === null;
  const content: PreviewContent = {
    title: values.title,
    body: values.body,
    ctaLabel: values.ctaLabel,
    destinationType: values.destinationType,
    destinationCaption: destinationCaption(
      values,
      values.destinationType === 'SPACE' ? (previewSpace?.location ?? null) : null,
    ),
    imageUrl,
    usesSpaceCover,
    advertiserName: advertiser.name,
    space: previewSpace,
  };
  const otherActive = campaign.creatives.filter(
    (item) => item.active && item.id !== creative?.id,
  ).length;

  return (
    <div className="grid items-start gap-6 min-[1600px]:grid-cols-[30rem_1fr]">
      <Card>
        <CardContent>
          <form onSubmit={submit} noValidate className="grid gap-5">
            <section aria-labelledby="creative-image" className="grid gap-3">
              <h2 id="creative-image" className="font-display text-lg font-semibold">
                Imagem
              </h2>
              <p className="text-muted-foreground text-sm">
                {placementFormatText(placement)}. Você recorta no formato da vaga antes do envio.
                Sem texto na imagem (o app escreve o texto); deixe o assunto na metade de cima ou à
                direita e nada importante perto dos cantos.
              </p>
              {skipAllowed ? (
                <FormNotice>
                  Anunciante Espaço com destino na própria página: a peça pode ficar sem imagem e
                  usa a capa e a logo do espaço.
                </FormNotice>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="bg-muted relative w-40 shrink-0 overflow-hidden rounded-md border"
                  style={{ aspectRatio: placementAspect(placement) }}
                >
                  {imageUrl ? (
                    // biome-ignore lint/performance/noImgElement: storage ou recorte local (blob:)
                    <img
                      src={imageUrl}
                      alt="Imagem da peça"
                      className="size-full object-cover"
                      data-testid="creative-image"
                    />
                  ) : null}
                </div>
                <input
                  ref={input}
                  type="file"
                  accept={AD_IMAGE_CONTENT_TYPES.join(',')}
                  hidden
                  data-testid="creative-image-input"
                  onChange={(event) => choose(event.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-invalid={errors.image ? true : undefined}
                    onClick={() => input.current?.click()}
                  >
                    <ImagePlus aria-hidden />
                    {imageUrl ? 'Trocar imagem' : 'Enviar imagem'}
                  </Button>
                  {imageUrl && skipAllowed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setImage({ kind: 'none' })}
                    >
                      <Trash2 aria-hidden />
                      Usar a capa do espaço
                    </Button>
                  ) : null}
                </div>
              </div>
              {errors.image ? (
                <p className="text-input-error-foreground text-helper font-medium" role="alert">
                  {errors.image}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="creative-texts" className="grid gap-4">
              <h2 id="creative-texts" className="font-display text-lg font-semibold">
                Textos
              </h2>
              <Field
                label="Título"
                htmlFor="creative-title"
                error={errors.title}
                hint={<CharCount value={values.title} max={AD_TEXT_LIMITS.title} />}
              >
                <Input
                  name="title"
                  maxLength={AD_TEXT_LIMITS.title}
                  value={values.title}
                  onChange={(event) => set('title', event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Texto"
                htmlFor="creative-body"
                optional
                error={errors.body}
                hint={
                  <>
                    <CharCount value={values.body} max={AD_TEXT_LIMITS.body} />
                    {placement === 'EXPLORE_HERO'
                      ? '. No banner aparece em 1 linha, só quando cabe.'
                      : null}
                  </>
                }
              >
                <Textarea
                  name="body"
                  rows={2}
                  maxLength={AD_TEXT_LIMITS.body}
                  value={values.body}
                  onChange={(event) => set('body', event.target.value)}
                />
              </Field>
              <Field
                label="Botão"
                htmlFor="creative-cta"
                error={errors.ctaLabel}
                hint={<CharCount value={values.ctaLabel} max={AD_TEXT_LIMITS.ctaLabel} />}
              >
                <Input
                  name="ctaLabel"
                  maxLength={AD_TEXT_LIMITS.ctaLabel}
                  placeholder="Ex.: Ver ofertas"
                  value={values.ctaLabel}
                  onChange={(event) => set('ctaLabel', event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </section>

            <section aria-labelledby="creative-destination" className="grid gap-4">
              <h2 id="creative-destination" className="font-display text-lg font-semibold">
                Destino
              </h2>
              <OptionCards
                label="Destino do toque"
                name="creative-destination-type"
                value={values.destinationType}
                onChange={(type) => set('destinationType', type)}
                options={[
                  {
                    value: 'URL',
                    label: 'Site',
                    description: 'Abre uma página do anunciante (só https).',
                    icon: Link2,
                  },
                  {
                    value: 'WHATSAPP',
                    label: 'WhatsApp',
                    description: 'Abre a conversa com a mensagem pronta.',
                    icon: MessageCircle,
                  },
                  {
                    value: 'SPACE',
                    label: 'Espaço',
                    description: 'Abre a página de um espaço da plataforma.',
                    icon: Building2,
                  },
                ]}
              />
              {values.destinationType === 'URL' ? (
                <Field
                  label="URL de destino"
                  htmlFor="creative-url"
                  error={errors.url}
                  hint="Comece com https://, sem espaços."
                >
                  <Input
                    name="url"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    maxLength={2000}
                    value={values.url}
                    onChange={(event) => set('url', event.target.value)}
                    autoComplete="off"
                  />
                </Field>
              ) : null}
              {values.destinationType === 'WHATSAPP' ? (
                <>
                  <Field label="WhatsApp" htmlFor="creative-whatsapp" error={errors.whatsappPhone}>
                    <MaskedInput
                      mask="phone"
                      name="whatsappPhone"
                      value={values.whatsappPhone}
                      onValueChange={(value) => set('whatsappPhone', value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label="Mensagem pronta"
                    htmlFor="creative-whatsapp-message"
                    error={errors.whatsappMessage}
                    hint={
                      <CharCount
                        value={values.whatsappMessage}
                        max={AD_TEXT_LIMITS.whatsappMessage}
                      />
                    }
                  >
                    <Textarea
                      name="whatsappMessage"
                      rows={3}
                      maxLength={AD_TEXT_LIMITS.whatsappMessage}
                      placeholder="Olá! Vi o anúncio no Space Sports e…"
                      value={values.whatsappMessage}
                      onChange={(event) => set('whatsappMessage', event.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              {values.destinationType === 'SPACE' ? (
                <SpacePicker
                  label="Espaço de destino"
                  value={values.spaceId}
                  selectedName={spaceName}
                  error={errors.spaceId}
                  hint="Fora da vitrine (sem preço ou quadra ativa), a peça não é entregue."
                  onChange={(spaceId, space) => {
                    set('spaceId', spaceId);
                    setSpaceName(space?.name);
                  }}
                />
              ) : null}
              {destinationHidden && showcase ? (
                <Alert variant="warning" role="status">
                  {showcaseWarning(showcase.missing)}
                </Alert>
              ) : null}
            </section>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={values.active}
                onChange={(event) => set('active', event.target.checked)}
              />
              Peça ativa (entra no sorteio da campanha)
            </label>

            <FormError message={formError} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton pending={saving} pendingLabel="Salvando…" disabled={uploading}>
                {creative ? 'Salvar peça' : 'Criar peça'}
              </SubmitButton>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => router.push(`/super/anuncios/campanhas/${campaign.id}`)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="min-[1600px]:sticky min-[1600px]:top-4">
        <CardHeader>
          <CardTitle>Pré-visualização</CardTitle>
          <CardDescription>
            Como a peça aparece no Explorar do app, em escala 1:1. O texto é desenhado pelo app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreativePreviewPanel
            placement={placement}
            content={content}
            segments={otherActive + (values.active ? 1 : 0)}
          />
        </CardContent>
      </Card>

      <ImageCropDialog
        file={source}
        pending={uploading}
        error={uploadError}
        onCancel={() => {
          setSource(null);
          setUploadError(undefined);
        }}
        onConfirm={(cropped) => void upload(cropped)}
        aspect={placementAspect(placement)}
        frame="rect"
        idPrefix="ad-image"
        title="Recortar imagem da peça"
        description={`Ajuste o enquadramento no formato da vaga (${placementFormatText(placement)}).`}
        confirmLabel="Enviar imagem"
        render={(img, box, type) => renderAdCrop(img, box, type, placement)}
        checkCrop={(box) => adCropProblem(box, placement)}
        renderErrorMessage={(failure) => adCropRenderMessage(failure, placement)}
        footnote={(box) => {
          const out = adOutputSize(box, placement);
          return `Arquivo final: ${out.width} × ${out.height} px.`;
        }}
      />
    </div>
  );
}

/**
 * Capa, logo, local, esportes e preço do espaço para a prévia (esportes e preço só na vitrine), e
 * a situação dele na vitrine (fora dela, a peça com destino no espaço não é entregue).
 */
function usePreviewSpace(spaceId: string): {
  space: PreviewSpace | null;
  showcase: SuperSpaceShowcase | null;
} {
  const space = useSuperGetSpace(spaceId, { query: { enabled: !!spaceId } });
  const visible = space.data?.showcase.visible ?? false;
  const publicSpace = useGetSpaceBySlug(space.data?.slug ?? '', {
    query: { enabled: visible && !!space.data?.slug, retry: false },
  });
  if (!spaceId || !space.data) return { space: null, showcase: null };
  const data = space.data;
  const cover = [...data.photos].sort((a, b) => a.position - b.position)[0];
  const preview = {
    name: data.name,
    logoUrl: data.logoUrl,
    coverUrl: cover?.url ?? null,
    location:
      [data.address.neighborhood, data.address.city.name].filter(Boolean).join(' · ') || null,
    sports: publicSpace.data?.sports.map((sport) => sport.name) ?? [],
    pricePerHourCents: publicSpace.data?.rental.pricePerHourCents ?? null,
  };
  return { space: preview, showcase: data.showcase };
}

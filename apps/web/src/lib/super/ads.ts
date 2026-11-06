import { isApiError } from '@space-sports/api-client';
import {
  AD_PLACEMENT_FORMATS,
  AD_TEXT_LIMITS,
  type AdCampaignStatus,
  type AdCategory,
  type AdOffAirReason,
  type AdPlacement,
  maskPhone,
  normalizePhone,
  timeToMinutes,
  utcToZoned,
  zonedToUtc,
} from '@space-sports/shared';
import { DISPLAY_TIME_ZONE } from '@/lib/format';
import type { CropBox } from '@/lib/image-crop';
import { showcaseMissingLabel } from '@/lib/super/labels';

// Anúncios no /super (RF-ADS-01, 02, 03 e 09; decisões 73 a 76; docs/12-anuncios.md).

export {
  AD_CAMPAIGN_STATUS_LABELS,
  AD_CAMPAIGN_STATUS_TRANSITIONS,
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  AD_PLACEMENT_FORMATS,
  AD_PLACEMENT_LABELS,
  AD_PLACEMENTS,
  AD_TEXT_LIMITS,
} from '@space-sports/shared';

export const advertiserKindLabel = { COMPANY: 'Empresa', SPACE: 'Espaço' } as const;
export type AdvertiserKindValue = keyof typeof advertiserKindLabel;

/** Explicação de cada vaga no formulário da campanha. */
export const placementDescription: Record<AdPlacement, string> = {
  EXPLORE_HERO:
    'Banner largo no topo do Explorar do app, em carrossel com até 5 anúncios que trocam a cada 5 s.',
  EXPLORE_FEED:
    'Card no meio da lista de espaços do Explorar (3ª posição e depois a cada 8 espaços), no formato do card de espaço.',
};

/** "2:1, mínimo 960 × 480, até 2 MB". */
export function placementFormatText(placement: AdPlacement): string {
  const f = AD_PLACEMENT_FORMATS[placement];
  return `Imagem ${f.aspectWidth}:${f.aspectHeight}, mínimo ${f.minWidth} × ${f.minHeight} px, até ${Math.round(f.maxBytes / 1024 / 1024)} MB`;
}

/** Proporção (largura ÷ altura) da imagem da vaga. */
export function placementAspect(placement: AdPlacement): number {
  const f = AD_PLACEMENT_FORMATS[placement];
  return f.aspectWidth / f.aspectHeight;
}

// ---------------------------------------------------------------------------
// URL da tela de anúncios: `?aba=anunciantes` e `?anunciante=<id>` (fonte única da aba e do filtro)

export type AdsTab = 'campanhas' | 'anunciantes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

type SearchLike = { get(name: string): string | null; toString(): string };

/** Aba e anunciante da URL; `?anunciante=` que não é UUID é ignorado (não vai à API). */
export function adsUrlState(params: SearchLike): { tab: AdsTab; advertiserId: string } {
  const advertiser = params.get('anunciante');
  return {
    tab: params.get('aba') === 'anunciantes' ? 'anunciantes' : 'campanhas',
    advertiserId: isUuid(advertiser) ? advertiser : '',
  };
}

/** Query string depois de trocar a aba e/ou o anunciante, mantendo o resto da URL. */
export function adsSearchFrom(
  params: SearchLike,
  next: { tab?: AdsTab; advertiserId?: string },
): string {
  const search = new URLSearchParams(params.toString());
  if (next.tab === 'anunciantes') search.set('aba', 'anunciantes');
  else if (next.tab === 'campanhas') search.delete('aba');
  if (next.advertiserId !== undefined) search.set('anunciante', next.advertiserId);
  if (!isUuid(search.get('anunciante'))) search.delete('anunciante');
  return search.toString();
}

// ---------------------------------------------------------------------------
// Situação da campanha (selo da lista)

export type CampaignSituation =
  | 'ON_AIR'
  | 'SCHEDULED'
  | 'ENDED'
  | 'PAUSED'
  | 'NO_CREATIVES'
  | 'ADVERTISER_INACTIVE'
  | 'DRAFT'
  | 'ARCHIVED'
  | 'OFF_AIR';

export const campaignSituationLabel: Record<CampaignSituation, string> = {
  ON_AIR: 'No ar',
  SCHEDULED: 'Agendada',
  ENDED: 'Encerrada',
  PAUSED: 'Pausada',
  NO_CREATIVES: 'Sem peças',
  ADVERTISER_INACTIVE: 'Anunciante inativo',
  DRAFT: 'Rascunho',
  ARCHIVED: 'Arquivada',
  OFF_AIR: 'Fora do ar',
};

export const campaignSituationVariant = {
  ON_AIR: 'success',
  SCHEDULED: 'info',
  ENDED: 'muted',
  PAUSED: 'warning',
  NO_CREATIVES: 'warning',
  ADVERTISER_INACTIVE: 'destructive',
  DRAFT: 'muted',
  ARCHIVED: 'muted',
  OFF_AIR: 'muted',
} as const satisfies Record<CampaignSituation, string>;

/**
 * Selo de situação a partir do status e dos motivos que a API devolve em `delivery` (a regra de
 * "no ar" é da API). Ordem: arquivada; no ar; o status que o Super escolheu (pausada, rascunho);
 * o período encerrado; o que o Super precisa resolver (anunciante inativo, sem peças); o
 * agendamento. Ativa fora do ar sem motivo conhecido cai no selo neutro "Fora do ar".
 */
export function campaignSituation(campaign: {
  status: AdCampaignStatus;
  delivery: { onAir: boolean; reasons: readonly AdOffAirReason[] };
}): CampaignSituation {
  const { status, delivery } = campaign;
  if (status === 'ARCHIVED') return 'ARCHIVED';
  if (delivery.onAir) return 'ON_AIR';
  if (status === 'PAUSED') return 'PAUSED';
  if (status === 'DRAFT') return 'DRAFT';
  const has = (reason: AdOffAirReason) => delivery.reasons.includes(reason);
  if (has('ENDED')) return 'ENDED';
  if (has('ADVERTISER_INACTIVE')) return 'ADVERTISER_INACTIVE';
  if (has('NO_CREATIVES')) return 'NO_CREATIVES';
  if (has('NOT_STARTED')) return 'SCHEDULED';
  return 'OFF_AIR';
}

export const offAirReasonLabel: Record<AdOffAirReason, string> = {
  NOT_ACTIVE: 'a campanha não está ativa',
  NOT_STARTED: 'o período ainda não começou',
  ENDED: 'o período terminou',
  ADVERTISER_INACTIVE: 'o anunciante está inativo',
  NO_CREATIVES: 'nenhuma peça ativa pode ser entregue',
};

/** "Fora do ar: o período ainda não começou e nenhuma peça ativa pode ser entregue." */
export function offAirText(reasons: readonly AdOffAirReason[]): string | null {
  if (reasons.length === 0) return null;
  const parts = reasons.map((reason) => offAirReasonLabel[reason]);
  const last = parts.pop();
  return `Fora do ar: ${parts.length > 0 ? `${parts.join(', ')} e ${last}` : last}.`;
}

// ---------------------------------------------------------------------------
// Datas: o formulário usa dia e hora de America/Sao_Paulo; a API recebe UTC.

/** `2026-11-10` + `08:00` em São Paulo → `2026-11-10T11:00:00.000Z`. */
export function localToUtcIso(date: string, time: string): string {
  return zonedToUtc(date, timeToMinutes(time), DISPLAY_TIME_ZONE).toISOString();
}

/** Instante UTC → dia e hora em São Paulo, para os campos. */
export function utcIsoToLocal(iso: string): { date: string; time: string } {
  const zoned = utcToZoned(new Date(iso), DISPLAY_TIME_ZONE);
  const hours = String(Math.floor(zoned.minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(zoned.minuteOfDay % 60).padStart(2, '0');
  return { date: zoned.date, time: `${hours}:${minutes}` };
}

// ---------------------------------------------------------------------------
// Formulários

type Errors = Record<string, string>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AdvertiserFormValues = {
  kind: AdvertiserKindValue;
  name: string;
  category: AdCategory | '';
  spaceId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
};

export function emptyAdvertiserForm(): AdvertiserFormValues {
  return {
    kind: 'COMPANY',
    name: '',
    category: '',
    spaceId: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    notes: '',
  };
}

export function advertiserFormFrom(advertiser: {
  kind: AdvertiserKindValue;
  name: string;
  category: AdCategory;
  space: { id: string } | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}): AdvertiserFormValues {
  return {
    kind: advertiser.kind,
    name: advertiser.name,
    category: advertiser.category,
    spaceId: advertiser.space?.id ?? '',
    contactName: advertiser.contactName ?? '',
    contactEmail: advertiser.contactEmail ?? '',
    contactPhone: advertiser.contactPhone ? maskPhone(advertiser.contactPhone) : '',
    notes: advertiser.notes ?? '',
  };
}

export function validateAdvertiser(values: AdvertiserFormValues, editing: boolean): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = 'Informe o nome do anunciante.';
  else if (values.name.trim().length > 120) errors.name = 'Use até 120 caracteres.';
  if (!values.category) errors.category = 'Escolha a categoria.';
  if (!editing && values.kind === 'SPACE' && !values.spaceId) {
    errors.spaceId = 'Escolha o espaço anunciante.';
  }
  if (values.contactEmail.trim() && !EMAIL.test(values.contactEmail.trim())) {
    errors.contactEmail = 'Informe um e-mail válido.';
  }
  if (values.contactPhone.trim() && !normalizePhone(values.contactPhone)) {
    errors.contactPhone = 'Informe o telefone com DDD.';
  }
  if (values.notes.length > 2000) errors.notes = 'Use até 2000 caracteres.';
  return errors;
}

/** Campos comuns de criar e editar; vazio vira `null` (apaga o contato). */
export function advertiserPayload(values: AdvertiserFormValues) {
  const email = values.contactEmail.trim().toLowerCase();
  return {
    name: values.name.trim(),
    category: values.category as AdCategory,
    contactName: values.contactName.trim() || null,
    contactEmail: email || null,
    contactPhone: values.contactPhone.trim() ? normalizePhone(values.contactPhone) : null,
    notes: values.notes.trim() || null,
  };
}

export type CampaignFormValues = {
  advertiserId: string;
  name: string;
  placement: AdPlacement | '';
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  cityIds: string[];
  sportIds: string[];
  weight: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
};

export function emptyCampaignForm(advertiserId = ''): CampaignFormValues {
  return {
    advertiserId,
    name: '',
    placement: '',
    startDate: '',
    startTime: '00:00',
    endDate: '',
    endTime: '23:59',
    cityIds: [],
    sportIds: [],
    weight: '5',
    status: 'DRAFT',
  };
}

export function campaignFormFrom(campaign: {
  advertiser: { id: string };
  name: string;
  placement: AdPlacement;
  startsAt: string;
  endsAt: string;
  cityIds: string[];
  sportIds: string[];
  weight: number;
}): CampaignFormValues {
  const start = utcIsoToLocal(campaign.startsAt);
  const end = utcIsoToLocal(campaign.endsAt);
  return {
    advertiserId: campaign.advertiser.id,
    name: campaign.name,
    placement: campaign.placement,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    cityIds: [...campaign.cityIds],
    sportIds: [...campaign.sportIds],
    weight: String(campaign.weight),
    status: 'DRAFT',
  };
}

export function validateCampaign(values: CampaignFormValues): Errors {
  const errors: Errors = {};
  if (!values.advertiserId) errors.advertiserId = 'Escolha o anunciante.';
  if (!values.name.trim()) errors.name = 'Informe o nome da campanha.';
  else if (values.name.trim().length > 120) errors.name = 'Use até 120 caracteres.';
  if (!values.placement) errors.placement = 'Escolha a vaga.';
  if (!values.startDate || !values.startTime) errors.startsAt = 'Informe o início.';
  if (!values.endDate || !values.endTime) errors.endsAt = 'Informe o fim.';
  if (!errors.startsAt && !errors.endsAt) {
    const start = localToUtcIso(values.startDate, values.startTime);
    const end = localToUtcIso(values.endDate, values.endTime);
    if (end <= start) errors.endsAt = 'O fim precisa ser depois do início.';
  }
  const weight = Number(values.weight);
  if (!Number.isInteger(weight) || weight < 1 || weight > 10) {
    errors.weight = 'Use um peso de 1 a 10.';
  }
  return errors;
}

/** Corpo comum de criar e editar a campanha (datas já em UTC). */
export function campaignPayload(values: CampaignFormValues) {
  return {
    name: values.name.trim(),
    placement: values.placement as AdPlacement,
    startsAt: localToUtcIso(values.startDate, values.startTime),
    endsAt: localToUtcIso(values.endDate, values.endTime),
    cityIds: values.cityIds,
    sportIds: values.sportIds,
    weight: Number(values.weight),
  };
}

export type DestinationType = 'URL' | 'WHATSAPP' | 'SPACE';
export const destinationTypeLabel: Record<DestinationType, string> = {
  URL: 'Site (URL)',
  WHATSAPP: 'WhatsApp',
  SPACE: 'Página de um espaço',
};

export type CreativeFormValues = {
  title: string;
  body: string;
  ctaLabel: string;
  destinationType: DestinationType;
  url: string;
  whatsappPhone: string;
  whatsappMessage: string;
  spaceId: string;
  active: boolean;
};

export function emptyCreativeForm(defaultSpaceId = ''): CreativeFormValues {
  return {
    title: '',
    body: '',
    ctaLabel: '',
    destinationType: defaultSpaceId ? 'SPACE' : 'URL',
    url: '',
    whatsappPhone: '',
    whatsappMessage: '',
    spaceId: defaultSpaceId,
    active: true,
  };
}

type CreativeDestinationView =
  | { type: 'URL'; url: string }
  | { type: 'WHATSAPP'; phone: string; message: string }
  | { type: 'SPACE'; space: { id: string } };

export function creativeFormFrom(creative: {
  title: string;
  body: string | null;
  ctaLabel: string;
  destination: CreativeDestinationView;
  active: boolean;
}): CreativeFormValues {
  const d = creative.destination;
  return {
    title: creative.title,
    body: creative.body ?? '',
    ctaLabel: creative.ctaLabel,
    destinationType: d.type,
    url: d.type === 'URL' ? d.url : '',
    whatsappPhone: d.type === 'WHATSAPP' ? maskPhone(d.phone) : '',
    whatsappMessage: d.type === 'WHATSAPP' ? d.message : '',
    spaceId: d.type === 'SPACE' ? d.space.id : '',
    active: creative.active,
  };
}

/** URL externa aceita pela API: `https://` minúsculo e sem espaços (RN-ADS-05, check do banco). */
export function isValidAdUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/.test(value) || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function validateCreative(values: CreativeFormValues): Errors {
  const errors: Errors = {};
  const { title, body, ctaLabel, whatsappMessage } = AD_TEXT_LIMITS;
  if (!values.title.trim()) errors.title = 'Informe o título.';
  else if (values.title.trim().length > title) errors.title = `Use até ${title} caracteres.`;
  if (values.body.trim().length > body) errors.body = `Use até ${body} caracteres.`;
  if (!values.ctaLabel.trim()) errors.ctaLabel = 'Informe o texto do botão.';
  else if (values.ctaLabel.trim().length > ctaLabel) {
    errors.ctaLabel = `Use até ${ctaLabel} caracteres.`;
  }
  if (values.destinationType === 'URL') {
    const url = values.url.trim();
    if (!url) errors.url = 'Informe a URL de destino.';
    else if (!isValidAdUrl(url)) {
      errors.url =
        'Use uma URL que comece com https://, sem espaços (ex.: https://exemplo.com.br).';
    }
  }
  if (values.destinationType === 'WHATSAPP') {
    if (!normalizePhone(values.whatsappPhone)) errors.whatsappPhone = 'Informe o WhatsApp com DDD.';
    if (!values.whatsappMessage.trim()) errors.whatsappMessage = 'Escreva a mensagem pronta.';
    else if (values.whatsappMessage.trim().length > whatsappMessage) {
      errors.whatsappMessage = `Use até ${whatsappMessage} caracteres.`;
    }
  }
  if (values.destinationType === 'SPACE' && !values.spaceId) {
    errors.spaceId = 'Escolha o espaço de destino.';
  }
  return errors;
}

export function creativeDestination(values: CreativeFormValues) {
  switch (values.destinationType) {
    case 'URL':
      return { type: 'URL' as const, url: values.url.trim() };
    case 'WHATSAPP':
      return {
        type: 'WHATSAPP' as const,
        phone: normalizePhone(values.whatsappPhone) ?? '',
        message: values.whatsappMessage.trim(),
      };
    case 'SPACE':
      return { type: 'SPACE' as const, spaceId: values.spaceId };
  }
}

/** Corpo comum de criar e editar a peça (sem a imagem). */
export function creativePayload(values: CreativeFormValues) {
  return {
    title: values.title.trim(),
    body: values.body.trim() || null,
    ctaLabel: values.ctaLabel.trim(),
    destination: creativeDestination(values),
    active: values.active,
  };
}

/**
 * Peça sem imagem só de anunciante Espaço com destino no próprio espaço (usa a capa e a logo do
 * espaço). Mesma regra da API (`AD_IMAGE_REQUIRED`).
 */
export function canSkipImage(
  advertiser: { kind: AdvertiserKindValue; spaceId: string | null },
  values: Pick<CreativeFormValues, 'destinationType' | 'spaceId'>,
): boolean {
  return (
    advertiser.kind === 'SPACE' &&
    advertiser.spaceId !== null &&
    values.destinationType === 'SPACE' &&
    values.spaceId === advertiser.spaceId
  );
}

/** Rodapé do card patrocinado: domínio sem `www.`, "WhatsApp" ou bairro · cidade do espaço. */
export function destinationCaption(
  values: Pick<CreativeFormValues, 'destinationType' | 'url'>,
  spaceLocation: string | null,
): string {
  if (values.destinationType === 'WHATSAPP') return 'WhatsApp';
  if (values.destinationType === 'SPACE') return spaceLocation ?? 'Página do espaço';
  try {
    return new URL(values.url.trim()).hostname.replace(/^www\./, '');
  } catch {
    return 'Site do anunciante';
  }
}

// ---------------------------------------------------------------------------
// Imagem da peça: recorte e arquivo final

/** Maior arquivo gerado no navegador por vaga (sobra para telas de alta densidade, cabe em 2 MB). */
export const AD_OUTPUT_MAX_WIDTH: Record<AdPlacement, number> = {
  EXPLORE_HERO: 1600,
  EXPLORE_FEED: 1080,
};

/**
 * Tamanho do arquivo final: a largura do recorte (sem ampliar), até o máximo da vaga, arredondada
 * para baixo a um múltiplo da proporção, para a altura sair exata (2:1 e 4:5 sem sobra).
 */
export function adOutputSize(
  box: Pick<CropBox, 'width'>,
  placement: AdPlacement,
): { width: number; height: number } {
  const f = AD_PLACEMENT_FORMATS[placement];
  const target = Math.min(AD_OUTPUT_MAX_WIDTH[placement], Math.floor(box.width));
  const units = Math.max(1, Math.floor(target / f.aspectWidth));
  return { width: units * f.aspectWidth, height: units * f.aspectHeight };
}

/** O recorte tem o tamanho mínimo da vaga? (Mesmo limite da API: `AD_IMAGE_TOO_SMALL`.) */
export function adCropProblem(box: CropBox, placement: AdPlacement): string | null {
  const f = AD_PLACEMENT_FORMATS[placement];
  const out = adOutputSize(box, placement);
  if (out.width >= f.minWidth && out.height >= f.minHeight) return null;
  return `O recorte tem ${out.width} × ${out.height} px e a vaga pede no mínimo ${f.minWidth} × ${f.minHeight}. Diminua o zoom ou use uma imagem maior.`;
}

// ---------------------------------------------------------------------------
// Ordem das peças

/** Move o item `index` uma posição para cima (-1) ou para baixo (+1); fora dos limites, não muda. */
export function moveId(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as string);
  return next;
}

// ---------------------------------------------------------------------------
// Relatório

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('pt-BR');

/** CTR de 0 a 1 → "2,35%". */
export function formatCtr(ctr: number): string {
  return percent.format(ctr);
}

export function formatCount(value: number): string {
  return integer.format(value);
}

/** "anuncio-rede-quadra-verao-2026-11-01_2026-11-30.csv". */
export function reportCsvFilename(campaignName: string, from: string, to: string): string {
  const slug = campaignName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `anuncio-${slug || 'campanha'}-${from}_${to}.csv`;
}

// ---------------------------------------------------------------------------
// Erros da API

/** Aviso do editor quando o espaço de destino está fora da vitrine (RN-ADS-05). */
export function showcaseWarning(missing: readonly (keyof typeof showcaseMissingLabel)[]): string {
  const base = 'Este espaço está fora da vitrine: a peça não é entregue enquanto ele não voltar.';
  if (missing.length === 0) return base;
  return `${base} Falta: ${missing.map((item) => showcaseMissingLabel[item]).join(', ')}.`;
}

/** Falha no PUT direto ao storage (fora da API). */
export const AD_STORAGE_PUT_FAILED = 'ad-storage-put-failed';

/** O recorte não coube no limite da vaga nem em JPEG com menos qualidade (gerado no navegador). */
export const AD_CROP_TOO_LARGE = 'ad-crop-too-large';

/** Mensagem da falha ao gerar o arquivo do recorte, no diálogo de recorte. */
export function adCropRenderMessage(error: unknown, placement: AdPlacement): string {
  if (error instanceof Error && error.message === AD_CROP_TOO_LARGE) {
    const mb = Math.round(AD_PLACEMENT_FORMATS[placement].maxBytes / 1024 / 1024);
    return `A imagem recortada passou de ${mb} MB mesmo comprimida. Use uma imagem com menos detalhes ou ruído.`;
  }
  return 'Não foi possível gerar a imagem recortada. Tente de novo ou use outro arquivo.';
}

const STORAGE_UNAVAILABLE =
  'O envio de imagens está indisponível no momento. Tente de novo em alguns minutos.';

const AD_ERROR_MESSAGES: Record<string, string> = {
  AD_CATEGORY_FORBIDDEN:
    'Apostas (bets) e bebidas alcoólicas não podem anunciar no Space Sports. Escolha outra categoria.',
  ADVERTISER_SPACE_TAKEN:
    'Esse espaço já tem um anunciante ativo. Edite o anunciante existente ou desative-o antes.',
  AD_SPACE_NOT_FOUND:
    'O espaço não existe ou não está ativo (suspenso ou encerrado). Reative o espaço antes de criar ou reativar o anunciante.',
  ADVERTISER_NOT_FOUND: 'Anunciante não encontrado. Recarregue a página.',
  AD_CAMPAIGN_NOT_FOUND: 'Campanha não encontrada. Recarregue a página.',
  AD_CREATIVE_NOT_FOUND: 'Peça não encontrada. Recarregue a página.',
  AD_CITY_NOT_FOUND: 'Alguma das cidades escolhidas não existe mais. Recarregue e escolha de novo.',
  AD_SPORT_NOT_FOUND:
    'Algum dos esportes escolhidos não existe mais. Recarregue e escolha de novo.',
  AD_INVALID_PERIOD: 'O fim da campanha precisa ser depois do início.',
  AD_PLACEMENT_LOCKED:
    'A vaga não muda depois que a campanha tem peças (as imagens são do formato da vaga). Crie outra campanha para a outra vaga.',
  AD_INVALID_STATUS_TRANSITION:
    'Essa mudança de status não é permitida agora. Recarregue a página para ver o status atual.',
  AD_DESTINATION_SPACE_NOT_FOUND:
    'O espaço do destino não existe ou não está ativo. Escolha outro espaço.',
  AD_IMAGE_REQUIRED:
    'A peça precisa de imagem. Só anunciante do tipo Espaço, com destino no próprio espaço, pode publicar sem imagem.',
  AD_CREATIVE_INVALID:
    'A peça tem dados inválidos. Confira o destino (a URL precisa começar com https:// e não ter espaços; o WhatsApp precisa de DDD e mensagem) e o tamanho dos textos.',
  AD_PLACEMENT_CHANGED:
    'A vaga da campanha mudou enquanto a imagem era conferida. Envie a imagem de novo, recortada no formato da vaga atual.',
  AD_IMAGE_KEY_INVALID:
    'O envio da imagem não vale para esta campanha (a vaga pode ter mudado). Envie a imagem de novo.',
  AD_IMAGE_NOT_UPLOADED: 'A imagem não chegou ao armazenamento ou o envio expirou. Envie de novo.',
  AD_IMAGE_TOO_LARGE: 'A imagem passa de 2 MB. Use uma imagem menor.',
  AD_IMAGE_INVALID: 'O arquivo não é uma imagem JPEG, PNG ou WebP válida.',
  AD_INVALID_CREATIVE_ORDER: 'A lista de peças mudou. Recarregue a página e ordene de novo.',
  AD_REPORT_RANGE_TOO_LARGE: 'O relatório vai até um ano por consulta. Diminua o período.',
  STORAGE_UNAVAILABLE,
  TOO_MANY_REQUESTS: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
};

function formatDetails(details: unknown) {
  const format = (details as { format?: Record<string, unknown> } | undefined)?.format;
  const n = (key: string) => (typeof format?.[key] === 'number' ? (format[key] as number) : null);
  return {
    aspect:
      n('aspectWidth') && n('aspectHeight') ? `${n('aspectWidth')}:${n('aspectHeight')}` : null,
    min: n('minWidth') && n('minHeight') ? `${n('minWidth')} × ${n('minHeight')}` : null,
  };
}

/** Mensagem clara para os erros dos anúncios; o resto cai no texto da API ou no genérico. */
export function adErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === AD_STORAGE_PUT_FAILED) {
    return 'O envio da imagem ao armazenamento falhou. Tente de novo.';
  }
  if (isApiError(error)) {
    if (error.code === 'AD_IMAGE_WRONG_ASPECT') {
      const { aspect } = formatDetails(error.details);
      return `A imagem precisa ter a proporção ${aspect ?? 'da vaga'}. Recorte de novo.`;
    }
    if (error.code === 'AD_IMAGE_TOO_SMALL') {
      const { min } = formatDetails(error.details);
      return `A imagem precisa ter pelo menos ${min ?? 'o tamanho mínimo da vaga'} px. Use uma imagem maior.`;
    }
    const known = AD_ERROR_MESSAGES[error.code];
    if (known) return known;
    if (error.status === 503) return STORAGE_UNAVAILABLE;
    if (error.status === 403) return 'Você não tem permissão para fazer isso.';
    if (error.status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
    return error.message || 'Não foi possível concluir. Tente novamente.';
  }
  if (error instanceof TypeError) {
    return 'Não foi possível conectar. Verifique sua internet e tente de novo.';
  }
  return 'Não foi possível concluir. Tente novamente.';
}

/** Campo do formulário a que o erro da API se refere (para destacar), se houver. */
export function adErrorField(error: unknown): string | null {
  if (!isApiError(error)) return null;
  const fields: Record<string, string> = {
    AD_CATEGORY_FORBIDDEN: 'category',
    ADVERTISER_SPACE_TAKEN: 'spaceId',
    AD_SPACE_NOT_FOUND: 'spaceId',
    AD_CITY_NOT_FOUND: 'cityIds',
    AD_SPORT_NOT_FOUND: 'sportIds',
    AD_INVALID_PERIOD: 'endsAt',
    AD_PLACEMENT_LOCKED: 'placement',
    AD_DESTINATION_SPACE_NOT_FOUND: 'spaceId',
    AD_IMAGE_REQUIRED: 'image',
    AD_PLACEMENT_CHANGED: 'image',
    AD_IMAGE_KEY_INVALID: 'image',
    AD_IMAGE_NOT_UPLOADED: 'image',
    AD_IMAGE_TOO_LARGE: 'image',
    AD_IMAGE_INVALID: 'image',
    AD_IMAGE_WRONG_ASPECT: 'image',
    AD_IMAGE_TOO_SMALL: 'image',
  };
  return fields[error.code] ?? null;
}

/** A imagem enviada deixou de valer (o Super precisa escolher e recortar de novo). */
export function isImageResendError(error: unknown): boolean {
  return (
    isApiError(error) &&
    [
      'AD_PLACEMENT_CHANGED',
      'AD_IMAGE_KEY_INVALID',
      'AD_IMAGE_NOT_UPLOADED',
      'AD_IMAGE_WRONG_ASPECT',
      'AD_IMAGE_TOO_SMALL',
      'AD_IMAGE_TOO_LARGE',
      'AD_IMAGE_INVALID',
    ].includes(error.code)
  );
}

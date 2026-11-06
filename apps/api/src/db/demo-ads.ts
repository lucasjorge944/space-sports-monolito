import { readFile } from 'node:fs/promises';
import type {
  AdCategory,
  AdDestinationInput,
  AdImageUpload,
  AdPlacement,
} from '@space-sports/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { AdvertisersService } from '../ads/advertisers.service.js';
import { AdCampaignsService } from '../ads/campaigns.service.js';
import { AdCreativesService } from '../ads/creatives.service.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import type { Database } from './client.js';
import { adCampaigns, adCreatives, advertisers, spaces } from './schema/index.js';

// Anúncios de demonstração (dev/staging; decisões 73 a 79). Anunciantes **fictícios**, sem marca
// real; destinos em `https://example.com/...` (domínio reservado) e WhatsApp com número fictício.
// Imagens CC0 de `demo-assets/ads/` (créditos em CREDITOS.md). O destaque da Astral Beach Sports
// usa só o que está em docs/08 (nome, cidade e esportes): sem preço nem dado inventado.

/** Duração das campanhas de demonstração a partir do seed. */
export const DEMO_AD_DAYS = 90;

/** Número fictício (faixa `(31) 90000-00NN` das contas de demonstração): não recebe nada. */
export const DEMO_AD_WHATSAPP = '+5531900000090';

export type DemoAd = {
  advertiser: { name: string; category: AdCategory; space?: string };
  placement: AdPlacement;
  /** Arquivo em `demo-assets/ads/`; sem imagem, só o anúncio de espaço. */
  image: string | null;
  title: string;
  body: string;
  ctaLabel: string;
  /** Destino; `space` usa o slug do parceiro. */
  destination: Exclude<AdDestinationInput, { type: 'SPACE' }> | { type: 'SPACE'; space: string };
};

const url = (path: string) => ({ type: 'URL' as const, url: `https://example.com/${path}` });

export const DEMO_ADS: readonly DemoAd[] = [
  {
    advertiser: { name: 'Rede Quadra Artigos Esportivos', category: 'SPORTING_GOODS' },
    placement: 'EXPLORE_HERO',
    image: 'rede-quadra-hero.jpg',
    title: 'Raquetes de beach tennis com até 30% off',
    body: 'Raquetes, bolas e acessórios para a sua próxima partida na areia.',
    ctaLabel: 'Ver ofertas',
    destination: url('rede-quadra'),
  },
  {
    advertiser: { name: 'Areia Fit', category: 'APPAREL' },
    placement: 'EXPLORE_HERO',
    image: 'areia-fit-hero.jpg',
    title: 'Coleção praia e quadra',
    body: 'Tops, shorts e bermudas leves para jogar na areia com conforto.',
    ctaLabel: 'Conhecer coleção',
    destination: url('areia-fit'),
  },
  {
    advertiser: { name: 'Força Total Equipamentos', category: 'FITNESS' },
    placement: 'EXPLORE_HERO',
    image: 'forca-total-hero.jpg',
    title: 'Treino funcional sem sair de casa',
    body: 'Halteres, elásticos e kettlebells para complementar o seu treino.',
    ctaLabel: 'Ver equipamentos',
    destination: url('forca-total'),
  },
  {
    // Decisão 74: o próprio espaço parceiro anuncia. Sem imagem: o app usa a capa e a logo.
    advertiser: {
      name: 'Astral Beach Sports',
      category: 'SPORTS_SPACE',
      space: 'astral-beach-sports',
    },
    placement: 'EXPLORE_HERO',
    image: null,
    title: 'Astral Beach Sports',
    body: 'Futevôlei, beach tennis e vôlei de praia em Belo Horizonte.',
    ctaLabel: 'Ver espaço',
    destination: { type: 'SPACE', space: 'astral-beach-sports' },
  },
  {
    advertiser: { name: 'Pulso Nutrition', category: 'SUPPLEMENTS' },
    placement: 'EXPLORE_FEED',
    image: 'pulso-nutrition-feed.jpg',
    title: 'Whey e pré-treino para o seu jogo',
    body: 'Suplementos para ter energia antes e se recuperar depois da partida.',
    ctaLabel: 'Comprar',
    destination: url('pulso-nutrition'),
  },
  {
    advertiser: { name: 'Passada Calçados', category: 'SPORTING_GOODS' },
    placement: 'EXPLORE_FEED',
    image: 'passada-feed.jpg',
    title: 'Tênis para treinar todo dia',
    body: 'Amortecimento e leveza para a corrida e o treino.',
    ctaLabel: 'Ver modelos',
    destination: url('passada'),
  },
  {
    advertiser: { name: 'Movimento Fisio', category: 'HEALTH' },
    placement: 'EXPLORE_FEED',
    image: 'movimento-fisio-feed.jpg',
    title: 'Fisioterapia esportiva',
    body: 'Avaliação e tratamento de lesões para voltar a jogar sem dor.',
    ctaLabel: 'Agendar',
    destination: {
      type: 'WHATSAPP',
      phone: DEMO_AD_WHATSAPP,
      message: 'Olá! Vi o anúncio no Space Sports e quero agendar uma avaliação.',
    },
  },
  {
    advertiser: { name: 'Verde Vida Sucos', category: 'FOOD_BEVERAGE' },
    placement: 'EXPLORE_FEED',
    image: 'verde-vida-feed.jpg',
    title: 'Sucos naturais para depois do jogo',
    body: 'Sucos e smoothies para repor a energia depois da partida.',
    ctaLabel: 'Ver cardápio',
    destination: url('verde-vida'),
  },
  {
    advertiser: { name: 'Hidrata+', category: 'SPORTING_GOODS' },
    placement: 'EXPLORE_FEED',
    image: 'hidrata-feed.jpg',
    title: 'Garrafas térmicas Hidrata+',
    body: 'Água gelada o jogo todo, na quadra ou na areia.',
    ctaLabel: 'Ver garrafas',
    destination: url('hidrata'),
  },
];

/** Nome da campanha de demonstração do anunciante. */
export const demoCampaignName = (ad: DemoAd) => `Demonstração · ${ad.advertiser.name}`;

const adFile = (name: string) => new URL(`./demo-assets/ads/${name}`, import.meta.url);

/**
 * Por anunciante: a peça foi enviada agora (`uploaded`), criada sem imagem (`created`), já existia
 * (`kept`) ou foi pulada por falta de storage (`skipped`, a campanha fica sem peça até o próximo
 * seed com storage).
 */
export type DemoAdsReport = Record<
  string,
  { campaign: 'created' | 'kept'; creative: 'uploaded' | 'created' | 'kept' | 'skipped' }
>;

/**
 * Anunciantes, campanhas `ACTIVE` por 90 dias a partir do seed (sem filtro de cidade nem de
 * esporte) e uma peça por campanha, pelos mesmos serviços do /super (auditados sem usuário). A
 * imagem segue o fluxo do upload (URL pré-assinada, envio e registro). Idempotente: o anunciante
 * é achado pelo nome (o de espaço, pelo espaço, mesmo desativado), a campanha pelo nome, e campanha
 * que já tem peça não ganha outra; nada existente muda (nem o período nem a ativação).
 */
export async function seedDemoAds(
  db: Database,
  storage: PhotoStorage,
  putObject: (upload: AdImageUpload, body: Uint8Array<ArrayBuffer>) => Promise<void>,
  now: Date = new Date(),
): Promise<DemoAdsReport> {
  const advertisersService = new AdvertisersService(db);
  const campaignsService = new AdCampaignsService(db, storage);
  const creativesService = new AdCreativesService(db, storage);
  const endsAt = new Date(now.getTime() + DEMO_AD_DAYS * 24 * 60 * 60 * 1000);
  const report: DemoAdsReport = {};

  for (const ad of DEMO_ADS) {
    const spaceId = ad.advertiser.space ? await spaceIdOf(db, ad.advertiser.space) : undefined;
    const advertiserId =
      (await existingAdvertiser(db, ad.advertiser.name, spaceId)) ??
      (
        await advertisersService.create(null, {
          name: ad.advertiser.name,
          kind: spaceId ? 'SPACE' : 'COMPANY',
          ...(spaceId ? { spaceId } : {}),
          category: ad.advertiser.category,
        })
      ).id;

    const name = demoCampaignName(ad);
    const [existing] = await db
      .select({ id: adCampaigns.id })
      .from(adCampaigns)
      .where(and(eq(adCampaigns.advertiserId, advertiserId), eq(adCampaigns.name, name)));
    const campaignId =
      existing?.id ??
      (
        await campaignsService.create(null, {
          advertiserId,
          name,
          placement: ad.placement,
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
          cityIds: [],
          sportIds: [],
          weight: 5,
          status: 'ACTIVE',
        })
      ).id;
    const campaign = existing ? 'kept' : 'created';

    if ((await db.$count(adCreatives, eq(adCreatives.campaignId, campaignId))) > 0) {
      report[ad.advertiser.name] = { campaign, creative: 'kept' };
      continue;
    }
    if (ad.image && !storage.enabled) {
      report[ad.advertiser.name] = { campaign, creative: 'skipped' };
      continue;
    }
    const destination: AdDestinationInput =
      ad.destination.type === 'SPACE'
        ? { type: 'SPACE', spaceId: await spaceIdOf(db, ad.destination.space) }
        : ad.destination;
    let imageKey: string | null = null;
    if (ad.image) {
      const body = new Uint8Array(await readFile(adFile(ad.image)));
      const upload = await creativesService.createUpload({
        placement: ad.placement,
        contentType: 'image/jpeg',
        size: body.length,
      });
      await putObject(upload, body);
      imageKey = upload.key;
    }
    try {
      await creativesService.create(null, campaignId, {
        imageKey,
        title: ad.title,
        body: ad.body,
        ctaLabel: ad.ctaLabel,
        destination,
        active: true,
      });
    } catch (err) {
      // Enviado mas não registrado: não deixa o arquivo órfão no bucket.
      if (imageKey) await storage.delete(imageKey);
      throw err;
    }
    report[ad.advertiser.name] = { campaign, creative: imageKey ? 'uploaded' : 'created' };
  }
  return report;
}

async function spaceIdOf(db: Database, slug: string): Promise<string> {
  const [space] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.slug, slug));
  if (!space) throw new Error(`Espaço parceiro ${slug} não encontrado.`);
  return space.id;
}

/**
 * Anunciante já cadastrado: o mais recente do espaço, ativo ou não (o seed não recria nem reativa
 * o destaque que o Super desativou), ou, de empresa, o primeiro de mesmo nome.
 */
async function existingAdvertiser(
  db: Database,
  name: string,
  spaceId: string | undefined,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: advertisers.id })
    .from(advertisers)
    .where(
      spaceId
        ? eq(advertisers.spaceId, spaceId)
        : and(eq(advertisers.name, name), eq(advertisers.kind, 'COMPANY')),
    )
    .orderBy(
      spaceId ? desc(advertisers.createdAt) : asc(advertisers.createdAt),
      spaceId ? desc(advertisers.id) : asc(advertisers.id),
    )
    .limit(1);
  return row?.id;
}

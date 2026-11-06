import { readFileSync } from 'node:fs';
import type { AdPlacement } from '@space-sports/shared';
import type { SignedUp, TestApp } from '../auth/helpers.js';
import type { FakeStorage } from '../spaces/fixtures.js';
import { bearer } from '../super/fixtures.js';

/** JPEGs reais das vagas (demo-assets): 960×480 (2:1) e 512×640 (4:5). */
const asset = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../src/db/demo-assets/ads/${name}`, import.meta.url)));
export const HERO_JPEG = asset('rede-quadra-hero.jpg');
export const FEED_JPEG = asset('passada-feed.jpg');

/**
 * Cabeçalho PNG com as dimensões pedidas (o image-info só lê o IHDR): para testar proporção e
 * tamanho mínimo sem gerar a imagem inteira.
 */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt8(8, 24);
  bytes.writeUInt8(2, 25);
  return new Uint8Array(bytes);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Período em volta de agora (padrão: começou ontem, termina em 30 dias). */
export function period(startOffsetDays = -1, endOffsetDays = 30) {
  const now = Date.now();
  return {
    startsAt: new Date(now + startOffsetDays * DAY_MS).toISOString(),
    endsAt: new Date(now + endOffsetDays * DAY_MS).toISOString(),
  };
}

/** Chamadas do /super/ads com o usuário. */
export function superAds(t: TestApp, user: SignedUp) {
  const base = '/v1/super/ads';
  const auth = <T extends { set: (name: string, value: string) => T }>(req: T) =>
    req.set(...bearer(user));
  return {
    listAdvertisers: (query: Record<string, string> = {}) =>
      auth(t.http().get(`${base}/advertisers`).query(query)),
    getAdvertiser: (id: string) => auth(t.http().get(`${base}/advertisers/${id}`)),
    createAdvertiser: (body: object) => auth(t.http().post(`${base}/advertisers`)).send(body),
    updateAdvertiser: (id: string, body: object) =>
      auth(t.http().patch(`${base}/advertisers/${id}`)).send(body),
    listCampaigns: (query: Record<string, string> = {}) =>
      auth(t.http().get(`${base}/campaigns`).query(query)),
    getCampaign: (id: string) => auth(t.http().get(`${base}/campaigns/${id}`)),
    createCampaign: (body: object) => auth(t.http().post(`${base}/campaigns`)).send(body),
    updateCampaign: (id: string, body: object) =>
      auth(t.http().patch(`${base}/campaigns/${id}`)).send(body),
    status: (id: string, status: string) =>
      auth(t.http().post(`${base}/campaigns/${id}/status`)).send({ status }),
    duplicate: (id: string) => auth(t.http().post(`${base}/campaigns/${id}/duplicate`)),
    presign: (body: object) => auth(t.http().post(`${base}/creatives/uploads`)).send(body),
    createCreative: (campaignId: string, body: object) =>
      auth(t.http().post(`${base}/campaigns/${campaignId}/creatives`)).send(body),
    updateCreative: (campaignId: string, creativeId: string, body: object) =>
      auth(t.http().patch(`${base}/campaigns/${campaignId}/creatives/${creativeId}`)).send(body),
    reorder: (campaignId: string, creativeIds: string[]) =>
      auth(t.http().put(`${base}/campaigns/${campaignId}/creatives/order`)).send({ creativeIds }),
    report: (campaignId: string, query: Record<string, string> = {}) =>
      auth(t.http().get(`${base}/campaigns/${campaignId}/report`).query(query)),
    reportCsv: (campaignId: string, query: Record<string, string> = {}) =>
      auth(t.http().get(`${base}/campaigns/${campaignId}/report.csv`).query(query)),
  };
}

export type SuperAds = ReturnType<typeof superAds>;

/** Pede a URL, "envia" a imagem e devolve a chave. */
export async function uploadImage(
  api: SuperAds,
  storage: FakeStorage,
  placement: AdPlacement,
  body: Uint8Array = placement === 'EXPLORE_HERO' ? HERO_JPEG : FEED_JPEG,
  contentType = 'image/jpeg',
): Promise<string> {
  const res = await api.presign({ placement, contentType });
  if (res.status !== 201)
    throw new Error(`Upload falhou: ${res.status} ${JSON.stringify(res.body)}`);
  storage.uploadBody(res.body.key, body);
  return res.body.key as string;
}

const created = (res: { status: number; body: { id: string } }, what: string) => {
  if (res.status !== 201)
    throw new Error(`${what} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

/** Anunciante empresa (ou espaço, com `spaceId`). */
export async function advertiser(
  api: SuperAds,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return created(
    await api.createAdvertiser({
      name: 'Loja Teste',
      kind: 'COMPANY',
      category: 'SPORTING_GOODS',
      ...overrides,
    }),
    'Anunciante',
  );
}

/** Campanha ACTIVE no ar (período em volta de agora) do anunciante. */
export async function campaign(
  api: SuperAds,
  advertiserId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  return created(
    await api.createCampaign({
      advertiserId,
      name: 'Campanha Teste',
      placement: 'EXPLORE_HERO',
      ...period(),
      status: 'ACTIVE',
      ...overrides,
    }),
    'Campanha',
  );
}

/** Peça com imagem da vaga e destino URL. */
export async function creative(
  api: SuperAds,
  storage: FakeStorage,
  campaignId: string,
  placement: AdPlacement = 'EXPLORE_HERO',
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const imageKey =
    'imageKey' in overrides ? overrides.imageKey : await uploadImage(api, storage, placement);
  return created(
    await api.createCreative(campaignId, {
      title: 'Oferta da semana',
      body: 'Texto curto da peça.',
      ctaLabel: 'Ver mais',
      destination: { type: 'URL', url: 'https://example.com/oferta' },
      ...overrides,
      imageKey,
    }),
    'Peça',
  );
}

import { randomUUID } from 'node:crypto';
import {
  AD_PLACEMENT_FORMATS,
  type AdPlacement,
  adImageFit,
  type CreateAdImageUpload,
} from '@space-sports/shared';
import { imageInfo } from '../storage/image-info.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { contentTypeOfKey, isScopedUploadKey, newScopedUploadKey } from '../storage/uploads.js';
import {
  imageNotUploaded,
  imageTooLarge,
  imageTooSmall,
  imageWrongAspect,
  invalidImageFile,
} from './ads.errors.js';

// Imagens das peças, no esquema de `storage/uploads.ts` (decisão 72): o /super envia para
// `uploads/ads/<vaga>/<uuid>.<ext>` pela URL pré-assinada, e a API copia para
// `ads/<campaignId>/<uuid do upload>-<uuid novo>.<ext>`, confere a cópia (tipo pelos bytes,
// tamanho, proporção e dimensões da vaga) e só então grava a URL. `ads/` é publicado pelo
// CloudFront; `uploads/` nunca.

const SCOPES: Record<AdPlacement, string> = {
  EXPLORE_HERO: 'ads/explore-hero',
  EXPLORE_FEED: 'ads/explore-feed',
};

/** Prefixo das imagens publicadas das peças da campanha. */
export const campaignImagePrefix = (campaignId: string) => `ads/${campaignId}/`;

/** Nova chave de upload para a vaga. */
export function newAdUploadKey(
  placement: AdPlacement,
  contentType: CreateAdImageUpload['contentType'],
): string {
  return newScopedUploadKey(SCOPES[placement], contentType);
}

/** A chave é de upload de peça desta vaga, no formato de `newAdUploadKey`. */
export function isAdUploadKeyOf(placement: AdPlacement, key: string): boolean {
  return isScopedUploadKey(SCOPES[placement], key);
}

/** uuid e extensão de uma chave de upload já validada. */
function uploadParts(uploadKey: string) {
  const file = uploadKey.slice(uploadKey.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return { uuid: file.slice(0, dot), extension: file.slice(dot + 1) };
}

/** Prefixo de toda imagem publicada desta chave de upload na campanha (registro repetido). */
export function adPublishedPrefix(campaignId: string, uploadKey: string): string {
  return `${campaignImagePrefix(campaignId)}${uploadParts(uploadKey).uuid}-`;
}

/** Chave publicada nova para um registro desta chave de upload. */
export function newAdPublishedKey(campaignId: string, uploadKey: string): string {
  const { extension } = uploadParts(uploadKey);
  return `${adPublishedPrefix(campaignId, uploadKey)}${randomUUID()}.${extension}`;
}

/** Chave da cópia de uma imagem publicada para outra campanha (duplicar). */
export function copiedImageKey(campaignId: string, sourceKey: string): string {
  const extension = sourceKey.slice(sourceKey.lastIndexOf('.') + 1);
  return `${campaignImagePrefix(campaignId)}${randomUUID()}.${extension}`;
}

/**
 * Confere a imagem publicada: tamanho (HEAD), tipo e dimensões pelos bytes, proporção da vaga com
 * 2% de tolerância e tamanho mínimo (docs/12, seção 4). Quem chama apaga o que não serve.
 */
export async function checkAdImage(
  storage: PhotoStorage,
  key: string,
  placement: AdPlacement,
): Promise<void> {
  const format = AD_PLACEMENT_FORMATS[placement];
  const stored = await storage.head(key);
  if (!stored) throw imageNotUploaded();
  if (stored.size > format.maxBytes) throw imageTooLarge();
  const expected = contentTypeOfKey(key);
  if (stored.size === 0 || stored.contentType !== expected) throw invalidImageFile();
  const bytes = await storage.read(key, format.maxBytes);
  const info = bytes && bytes.length <= format.maxBytes ? imageInfo(bytes) : null;
  if (!info || info.contentType !== expected) throw invalidImageFile();
  const size = { width: info.width, height: info.height };
  const fit = adImageFit(placement, size);
  if (fit === 'WRONG_ASPECT') throw imageWrongAspect(size, format);
  if (fit === 'TOO_SMALL') throw imageTooSmall(size, format);
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AD_PLACEMENT_FORMATS,
  type AdCreative,
  type AdDestinationInput,
  type AdImageUpload,
  type AdPlacement,
  type CreateAdCreative,
  type CreateAdImageUpload,
  type ReorderAdCreatives,
  type UpdateAdCreative,
} from '@space-sports/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { isCheckViolation, type Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { adCampaigns, adCreatives, advertisers, spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { storageUnavailable } from '../storage/storage.errors.js';
import { AdCandidatesCache } from './ad-candidates.cache.js';
import {
  adPublishedPrefix,
  checkAdImage,
  isAdUploadKeyOf,
  newAdPublishedKey,
  newAdUploadKey,
} from './ad-images.js';
import { loadCreatives } from './ad-views.js';
import {
  campaignNotFound,
  creativeNotFound,
  destinationSpaceNotFound,
  imageNotUploaded,
  imageRequired,
  invalidCreative,
  invalidCreativeOrder,
  invalidImageKey,
  placementChanged,
} from './ads.errors.js';
import { adsAudit, changes, lockCampaign } from './ads-common.js';

type CampaignInfo = {
  id: string;
  placement: AdPlacement;
  advertiserKind: 'COMPANY' | 'SPACE';
  /** Espaço do anunciante `SPACE`. */
  advertiserSpaceId: string | null;
};

/** Checks de `ad_creatives` que viram 422 se algo escapar da validação do Zod. */
const CREATIVE_CHECKS = ['ad_creatives_destination_valid', 'ad_creatives_text_length'] as const;

/** Colunas do destino na tabela (as que não são do tipo ficam nulas, como pede o check). */
function destinationColumns(destination: AdDestinationInput) {
  return {
    destinationType: destination.type,
    destinationUrl: destination.type === 'URL' ? destination.url : null,
    whatsappPhone: destination.type === 'WHATSAPP' ? destination.phone : null,
    whatsappMessage: destination.type === 'WHATSAPP' ? destination.message : null,
    destinationSpaceId: destination.type === 'SPACE' ? destination.spaceId : null,
  };
}

/**
 * Peças das campanhas (RF-ADS-03, RN-ADS-05). A imagem segue o fluxo das fotos (decisão 72): URL
 * pré-assinada em `uploads/ads/<vaga>/`, registro da chave, cópia para `ads/<campaignId>/` e
 * conferência da cópia (tipo, tamanho, proporção e dimensões da vaga). Trocar ou tirar a imagem
 * apaga a anterior do storage depois do commit. `actorId` nulo = seed de demonstração.
 */
@Injectable()
export class AdCreativesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: PhotoStorage,
    @Optional() private readonly cache?: AdCandidatesCache,
  ) {}

  /** URL pré-assinada para a imagem de uma peça da vaga. */
  async createUpload(input: CreateAdImageUpload): Promise<AdImageUpload> {
    if (!this.storage.enabled) throw storageUnavailable();
    const key = newAdUploadKey(input.placement, input.contentType);
    const upload = await this.storage.presignUpload(key, input.contentType);
    return {
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      key,
      expiresAt: upload.expiresAt.toISOString(),
      format: AD_PLACEMENT_FORMATS[input.placement],
    };
  }

  async list(campaignId: string): Promise<AdCreative[]> {
    await this.campaignInfo(this.db, campaignId);
    return loadCreatives(this.db, eq(adCreatives.campaignId, campaignId));
  }

  /** Cria a peça no fim da lista (auditado: `super.ad_creative.create`). */
  async create(
    actorId: string | null,
    campaignId: string,
    input: CreateAdCreative,
  ): Promise<AdCreative> {
    const campaign = await this.campaignInfo(this.db, campaignId);
    await this.assertDestination(input.destination);
    if (!input.imageKey) this.assertImageOptional(campaign, input.destination);
    const image = input.imageKey ? await this.publish(campaign, input.imageKey) : null;

    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        await lockCampaign(tx, campaignId);
        if (image) await this.assertSamePlacement(tx, campaign);
        const [last] = await tx
          .select({ position: sql<number>`coalesce(max(${adCreatives.position}), -1)::int` })
          .from(adCreatives)
          .where(eq(adCreatives.campaignId, campaignId));
        const [row] = await tx
          .insert(adCreatives)
          .values({
            campaignId,
            imageUrl: image?.url ?? null,
            title: input.title,
            body: input.body ?? null,
            ctaLabel: input.ctaLabel,
            ...destinationColumns(input.destination),
            active: input.active,
            position: (last?.position ?? -1) + 1,
          })
          .returning({ id: adCreatives.id });
        if (!row) throw new Error('Insert de peça sem retorno.');
        await adsAudit(tx, actorId, {
          action: 'super.ad_creative.create',
          entity: 'ad_creative',
          entityId: row.id,
          diff: {
            campaignId,
            title: input.title,
            destination: input.destination,
            imageUrl: image?.url ?? null,
          },
        });
        return row.id;
      });
    } catch (err) {
      if (image) await this.storage.delete(image.key);
      throw isCheckViolation(err, CREATIVE_CHECKS) ? invalidCreative() : err;
    }
    this.cache?.clear();
    return this.creative(campaignId, id);
  }

  /**
   * Edita a peça (auditado: `super.ad_creative.update`, e `activate`/`deactivate` na ativação).
   * `imageKey` troca a imagem; `null` tira (só peça de espaço com destino no espaço). Registrar
   * de novo a chave da imagem atual não muda a imagem.
   */
  async update(
    actorId: string,
    campaignId: string,
    creativeId: string,
    input: UpdateAdCreative,
  ): Promise<AdCreative> {
    const campaign = await this.campaignInfo(this.db, campaignId);
    const current = await this.currentCreative(this.db, campaignId, creativeId);
    if (input.destination) await this.assertDestination(input.destination);
    const destination = input.destination ?? storedDestination(current);
    const removesImage = input.imageKey === null;
    const keepsImage =
      input.imageKey === undefined ||
      (input.imageKey !== null && this.isFromUpload(current.imageUrl, campaignId, input.imageKey));
    const endsWithoutImage = removesImage || (keepsImage && !current.imageUrl);
    if (endsWithoutImage) this.assertImageOptional(campaign, destination);
    const image =
      input.imageKey && !keepsImage ? await this.publish(campaign, input.imageKey) : null;

    let previous: string | null = null;
    try {
      previous = await this.db.transaction(async (tx) => {
        await lockCampaign(tx, campaignId);
        if (image) await this.assertSamePlacement(tx, campaign);
        const before = await this.currentCreative(tx, campaignId, creativeId);
        const next = {
          ...(image ? { imageUrl: image.url } : removesImage ? { imageUrl: null } : {}),
          title: input.title,
          body: input.body,
          ctaLabel: input.ctaLabel,
          ...(input.destination ? destinationColumns(input.destination) : {}),
        };
        const diff = changes(before, next);
        const toggled = input.active !== undefined && input.active !== before.active;
        if (!diff && !toggled) return null;
        await tx
          .update(adCreatives)
          .set({ ...next, ...(toggled ? { active: input.active } : {}) })
          .where(eq(adCreatives.id, creativeId));
        if (diff) {
          await adsAudit(tx, actorId, {
            action: 'super.ad_creative.update',
            entity: 'ad_creative',
            entityId: creativeId,
            diff,
          });
        }
        if (toggled) {
          await adsAudit(tx, actorId, {
            action: input.active ? 'super.ad_creative.activate' : 'super.ad_creative.deactivate',
            entity: 'ad_creative',
            entityId: creativeId,
          });
        }
        const replaced = 'imageUrl' in next && next.imageUrl !== before.imageUrl;
        return replaced ? before.imageUrl : null;
      });
    } catch (err) {
      if (image) await this.storage.delete(image.key);
      throw isCheckViolation(err, CREATIVE_CHECKS) ? invalidCreative() : err;
    }
    // Depois do commit; se falhar, sobra só o arquivo órfão no bucket.
    await this.deleteImage(previous);
    this.cache?.clear();
    return this.creative(campaignId, creativeId);
  }

  /** Nova ordem das peças (auditado: `super.ad_creative.reorder`). */
  async reorder(
    actorId: string,
    campaignId: string,
    { creativeIds }: ReorderAdCreatives,
  ): Promise<AdCreative[]> {
    await this.db.transaction(async (tx) => {
      await lockCampaign(tx, campaignId);
      const rows = await tx
        .select({ id: adCreatives.id })
        .from(adCreatives)
        .where(eq(adCreatives.campaignId, campaignId));
      const ids = new Set(rows.map((row) => row.id));
      const same =
        new Set(creativeIds).size === creativeIds.length &&
        creativeIds.length === ids.size &&
        creativeIds.every((id) => ids.has(id));
      if (!same) throw invalidCreativeOrder();
      for (const [position, id] of creativeIds.entries()) {
        await tx.update(adCreatives).set({ position }).where(eq(adCreatives.id, id));
      }
      await adsAudit(tx, actorId, {
        action: 'super.ad_creative.reorder',
        entity: 'ad_campaign',
        entityId: campaignId,
        diff: { creativeIds },
      });
    });
    this.cache?.clear();
    return loadCreatives(this.db, eq(adCreatives.campaignId, campaignId));
  }

  private async creative(campaignId: string, creativeId: string): Promise<AdCreative> {
    const [creative] = await loadCreatives(
      this.db,
      and(eq(adCreatives.campaignId, campaignId), eq(adCreatives.id, creativeId)) as SQL,
    );
    if (!creative) throw creativeNotFound();
    return creative;
  }

  private async campaignInfo(db: Database | Tx, campaignId: string): Promise<CampaignInfo> {
    const [row] = await db
      .select({
        id: adCampaigns.id,
        placement: adCampaigns.placement,
        advertiserKind: advertisers.kind,
        advertiserSpaceId: advertisers.spaceId,
      })
      .from(adCampaigns)
      .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
      .where(eq(adCampaigns.id, campaignId));
    if (!row) throw campaignNotFound();
    return row;
  }

  /**
   * Com a campanha travada: a vaga ainda é a da conferência da imagem? A vaga só muda sem peças,
   * então outra edição pode tê-la trocado entre a conferência (fora da transação) e a gravação.
   */
  private async assertSamePlacement(tx: Tx, checked: CampaignInfo): Promise<void> {
    const current = await this.campaignInfo(tx, checked.id);
    if (current.placement !== checked.placement) throw placementChanged();
  }

  private async currentCreative(db: Database | Tx, campaignId: string, creativeId: string) {
    const [row] = await db
      .select()
      .from(adCreatives)
      .where(and(eq(adCreatives.id, creativeId), eq(adCreatives.campaignId, campaignId)));
    if (!row) throw creativeNotFound();
    return row;
  }

  /** Destino `SPACE`: espaço existente e ativo (RN-ADS-05). */
  private async assertDestination(destination: AdDestinationInput): Promise<void> {
    if (destination.type !== 'SPACE') return;
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, destination.spaceId), eq(spaces.status, 'ACTIVE')));
    if (!space) throw destinationSpaceNotFound();
  }

  /**
   * Sem imagem só anunciante `SPACE` com destino no próprio espaço (a capa e a logo vêm do espaço;
   * a peça de um espaço não vira o card de outro).
   */
  private assertImageOptional(campaign: CampaignInfo, destination: AdDestinationInput): void {
    const ownSpace =
      campaign.advertiserKind === 'SPACE' &&
      destination.type === 'SPACE' &&
      destination.spaceId === campaign.advertiserSpaceId;
    if (!ownSpace) throw imageRequired();
  }

  /** A URL gravada veio deste upload (registro repetido da mesma chave)? */
  private isFromUpload(url: string | null, campaignId: string, key: string): boolean {
    if (!url || !this.storage.enabled) return false;
    try {
      return url.startsWith(this.storage.publicUrl(adPublishedPrefix(campaignId, key)));
    } catch {
      return false;
    }
  }

  /**
   * Copia o upload para uma chave publicada nova da campanha, apaga o upload e confere a cópia
   * (inválida é apagada). Devolve a chave e a URL pública da cópia.
   */
  private async publish(
    campaign: CampaignInfo,
    uploadKey: string,
  ): Promise<{ key: string; url: string }> {
    if (!this.storage.enabled) throw storageUnavailable();
    if (!isAdUploadKeyOf(campaign.placement, uploadKey)) throw invalidImageKey();
    const target = newAdPublishedKey(campaign.id, uploadKey);
    const copied = await this.storage.copy(uploadKey, target);
    // O upload não é mais necessário: a cópia é que é conferida e publicada.
    await this.storage.delete(uploadKey);
    if (!copied) throw imageNotUploaded();
    try {
      await checkAdImage(this.storage, target, campaign.placement);
    } catch (err) {
      await this.storage.delete(target);
      throw err;
    }
    return { key: target, url: this.storage.publicUrl(target) };
  }

  private async deleteImage(url: string | null): Promise<void> {
    const key = url && this.storage.keyFromUrl(url);
    if (key?.startsWith('ads/')) await this.storage.delete(key);
  }
}

/** O destino gravado, no formato de entrada (para conferir a imagem opcional na edição). */
function storedDestination(row: typeof adCreatives.$inferSelect): AdDestinationInput {
  switch (row.destinationType) {
    case 'URL':
      return { type: 'URL', url: row.destinationUrl ?? '' };
    case 'WHATSAPP':
      return {
        type: 'WHATSAPP',
        phone: row.whatsappPhone ?? '',
        message: row.whatsappMessage ?? '',
      };
    case 'SPACE':
      return { type: 'SPACE', spaceId: row.destinationSpaceId ?? '' };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateLogoUpload,
  LOGO_MAX_BYTES,
  type LogoUpload,
  type SetLogo,
} from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { audit } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { spaces } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import {
  checkSquareImage,
  newPublishedKey,
  publishedPrefix,
  type SquareImageErrors,
} from '../storage/uploads.js';
import { discardPublished, isUploadKeyOf, lockSpace, newUploadKey } from './space-uploads.js';
import {
  invalidLogoFile,
  invalidLogoKey,
  logoNotSquare,
  logoNotUploaded,
  logoTooLarge,
  storageUnavailable,
} from './spaces.errors.js';

const LOGO_ERRORS: SquareImageErrors = {
  notUploaded: logoNotUploaded,
  tooLarge: logoTooLarge,
  invalidFile: invalidLogoFile,
  notSquare: logoNotSquare,
};

/**
 * Logo do espaço (RF-SPACE-11, decisão 44), no mesmo fluxo das fotos: URL pré-assinada, upload
 * direto ao storage e registro da chave, que copia o arquivo para a chave publicada (ver
 * `space-uploads.ts`) e confere a cópia (tamanho, tipo pelos bytes e imagem quadrada). Trocar ou
 * remover apaga o arquivo anterior do storage depois do commit.
 * `actorId` nulo = seed de demonstração (sem usuário).
 */
@Injectable()
export class SpaceLogoService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: PhotoStorage,
  ) {}

  async createUpload(spaceId: string, input: CreateLogoUpload): Promise<LogoUpload> {
    if (!this.storage.enabled) throw storageUnavailable();
    const key = newUploadKey(spaceId, 'logo', input.contentType);
    const upload = await this.storage.presignUpload(key, input.contentType);
    return {
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      key,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /**
   * Grava a logo já enviada ao storage no lugar da atual (auditado: `space.logo.update`).
   * Registrar de novo a chave da logo atual não muda nada (nem confere ou apaga o arquivo).
   */
  async set(spaceId: string, actorId: string | null, { key }: SetLogo): Promise<void> {
    if (!this.storage.enabled) throw storageUnavailable();
    if (!isUploadKeyOf(spaceId, 'logo', key)) throw invalidLogoKey();
    // A logo atual veio deste upload (registro anterior da mesma chave)?
    const prefix = this.storage.publicUrl(publishedPrefix(key));
    const fromThisUpload = (url: string | null) => url?.startsWith(prefix) ?? false;
    if (fromThisUpload(await this.currentLogoUrl(spaceId))) return;

    // Chave publicada nova: nenhum outro pedido nem a URL pré-assinada escrevem nela.
    const target = newPublishedKey(key);
    const url = this.storage.publicUrl(target);
    const copied = await this.storage.copy(key, target);
    // O upload não é mais necessário: a cópia é que é conferida e publicada.
    await this.storage.delete(key);
    if (!copied) {
      // Outro pedido com a mesma chave já copiou, apagou o upload e gravou a logo.
      if (fromThisUpload(await this.currentLogoUrl(spaceId))) return;
      throw logoNotUploaded();
    }

    let saved: { previous: string | null } | null;
    try {
      await this.checkObject(target);
      saved = await this.save(spaceId, actorId, url, fromThisUpload);
    } catch (err) {
      await discardPublished(this.db, this.storage, spaceId, target, async (tx) => {
        const [row] = await tx
          .select({ logoUrl: spaces.logoUrl })
          .from(spaces)
          .where(eq(spaces.id, spaceId));
        return row?.logoUrl === url;
      });
      throw err;
    }
    // Um registro concorrente da mesma chave gravou antes: esta cópia sobra.
    if (!saved) return this.storage.delete(target);
    await this.deleteByUrl(saved.previous);
  }

  /**
   * Grava a URL no lugar da atual e devolve a anterior; `null` (nada gravado) se a atual já veio
   * do mesmo upload.
   */
  private save(
    spaceId: string,
    actorId: string | null,
    url: string,
    fromThisUpload: (url: string | null) => boolean,
  ): Promise<{ previous: string | null } | null> {
    return this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [current] = await tx
        .select({ logoUrl: spaces.logoUrl })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      const before = current?.logoUrl ?? null;
      if (fromThisUpload(before)) return null;
      await tx.update(spaces).set({ logoUrl: url }).where(eq(spaces.id, spaceId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'space.logo.update',
        entity: 'space',
        entityId: spaceId,
        diff: { before, after: url },
      });
      return { previous: before };
    });
  }

  /** Remove a logo (idempotente; só audita `space.logo.remove` quando havia uma). */
  async remove(spaceId: string, actorId: string | null): Promise<void> {
    const previous = await this.db.transaction(async (tx) => {
      await lockSpace(tx, spaceId);
      const [current] = await tx
        .select({ logoUrl: spaces.logoUrl })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      const before = current?.logoUrl ?? null;
      if (!before) return null;
      await tx.update(spaces).set({ logoUrl: null }).where(eq(spaces.id, spaceId));
      await audit(tx, {
        actorId,
        spaceId,
        action: 'space.logo.remove',
        entity: 'space',
        entityId: spaceId,
        diff: { before },
      });
      return before;
    });
    await this.deleteByUrl(previous);
  }

  private async currentLogoUrl(spaceId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ logoUrl: spaces.logoUrl })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    return row?.logoUrl ?? null;
  }

  /** Confere a cópia (tamanho, tipo pelos bytes e imagem quadrada); quem chama apaga a inválida. */
  private checkObject(key: string): Promise<void> {
    return checkSquareImage(this.storage, key, LOGO_MAX_BYTES, LOGO_ERRORS);
  }

  /** Depois do commit; se falhar, sobra só o arquivo órfão no bucket. */
  private async deleteByUrl(url: string | null): Promise<void> {
    const key = url && this.storage.keyFromUrl(url);
    if (key) await this.storage.delete(key);
  }
}

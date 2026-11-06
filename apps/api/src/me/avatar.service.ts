import { Inject, Injectable } from '@nestjs/common';
import {
  AVATAR_MAX_BYTES,
  type AvatarResponse,
  type AvatarUpload,
  type CreateAvatarUpload,
  type SetAvatar,
} from '@space-sports/shared';
import { eq } from 'drizzle-orm';
import { unauthenticated } from '../auth/auth.errors.js';
import { audit, type Tx } from '../bookings/db-utils.js';
import { RateLimiter, type RateLimitRule } from '../contacts/rate-limiter.js';
import type { Database } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import {
  checkSquareImage,
  discardPublished,
  isScopedUploadKey,
  newPublishedKey,
  newScopedUploadKey,
  publishedPrefix,
  type SquareImageErrors,
} from '../storage/uploads.js';
import { avatarScope, deleteStoredAvatar } from '../users/avatar-storage.js';
import {
  imageNotSquare,
  imageTooLarge,
  invalidImageFile,
  invalidUploadKey,
  storageUnavailable,
  uploadNotFound,
} from './avatar.errors.js';

/**
 * Pedidos de URL de upload por usuário: cada URL aceita um PUT de qualquer tamanho no bucket (a
 * conferência vem depois), então o limite segura o abuso de espaço até a expiração de `uploads/`.
 */
export const AVATAR_UPLOAD_LIMIT = { window: 60 * 60, max: 20 } as const satisfies RateLimitRule;

const AVATAR_ERRORS: SquareImageErrors = {
  notUploaded: uploadNotFound,
  tooLarge: imageTooLarge,
  invalidFile: invalidImageFile,
  notSquare: imageNotSquare,
};

/**
 * Foto de perfil do próprio usuário (RF-AUTH-02, decisões 67 e 71), no mesmo fluxo da logo do
 * espaço: URL pré-assinada para `uploads/users/<id>/avatar/`, upload direto ao storage e registro
 * da chave, que copia o arquivo para uma chave nova em `users/<id>/avatar/` (fora do alcance da
 * URL e de outros registros) e confere a cópia (tamanho, tipo pelos bytes e imagem quadrada).
 * Trocar ou remover apaga do storage a foto anterior, depois do commit, só se ela for uma foto
 * enviada por este usuário: a foto do Google (URL externa) nunca é apagada.
 */
@Injectable()
export class AvatarService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: PhotoStorage,
    private readonly rateLimit: RateLimiter,
  ) {}

  /** URL pré-assinada (até `AVATAR_UPLOAD_LIMIT` por usuário: 429 `TOO_MANY_REQUESTS`). */
  async createUpload(userId: string, input: CreateAvatarUpload): Promise<AvatarUpload> {
    if (!this.storage.enabled) throw storageUnavailable();
    await this.rateLimit.consume(`user:${userId}|/me/avatar/uploads`, AVATAR_UPLOAD_LIMIT);
    const key = newScopedUploadKey(avatarScope(userId), input.contentType);
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
   * Grava a foto já enviada ao storage no lugar da atual (auditado: `user.avatar.update`, sem a
   * URL). Registrar de novo a chave da foto atual não muda nada (nem confere ou apaga o arquivo).
   */
  async set(userId: string, { key }: SetAvatar): Promise<AvatarResponse> {
    if (!this.storage.enabled) throw storageUnavailable();
    if (!isScopedUploadKey(avatarScope(userId), key)) throw invalidUploadKey();
    // A foto atual veio deste upload (registro anterior da mesma chave)?
    const prefix = this.storage.publicUrl(publishedPrefix(key));
    const fromThisUpload = (url: string | null): url is string => url?.startsWith(prefix) ?? false;
    const current = await this.currentUrl(userId);
    if (fromThisUpload(current)) return { avatarUrl: current };

    // Chave publicada nova: nenhum outro pedido nem a URL pré-assinada escrevem nela.
    const target = newPublishedKey(key);
    const url = this.storage.publicUrl(target);
    const copied = await this.storage.copy(key, target);
    // O upload não é mais necessário: a cópia é que é conferida e publicada.
    await this.storage.delete(key);
    if (!copied) {
      // Outro pedido com a mesma chave já copiou, apagou o upload e gravou a foto.
      const now = await this.currentUrl(userId);
      if (fromThisUpload(now)) return { avatarUrl: now };
      throw uploadNotFound();
    }

    let saved: { previous: string | null } | { winner: string };
    try {
      await checkSquareImage(this.storage, target, AVATAR_MAX_BYTES, AVATAR_ERRORS);
      saved = await this.save(userId, url, fromThisUpload);
    } catch (err) {
      // Sob o lock do usuário: esta cópia só fica se a própria URL foi gravada.
      await discardPublished(
        this.db,
        this.storage,
        target,
        async (tx) => (await lockUser(tx, userId))?.avatarUrl === url,
      );
      throw err;
    }
    if ('winner' in saved) {
      // Um registro concorrente da mesma chave gravou antes: esta cópia sobra.
      await this.storage.delete(target);
      return { avatarUrl: saved.winner };
    }
    await deleteStoredAvatar(this.storage, userId, saved.previous);
    return { avatarUrl: url };
  }

  /**
   * Grava a URL no lugar da atual e devolve a anterior; se a atual já veio do mesmo upload, não
   * grava nada e devolve a que ficou (`winner`).
   */
  private save(
    userId: string,
    url: string,
    fromThisUpload: (url: string | null) => url is string,
  ): Promise<{ previous: string | null } | { winner: string }> {
    return this.db.transaction(async (tx) => {
      const current = await lockUser(tx, userId);
      // Conta anonimizada no meio do pedido: nada de dado pessoal novo nela.
      if (!current || current.deletedAt) throw unauthenticated();
      if (fromThisUpload(current.avatarUrl)) return { winner: current.avatarUrl };
      await tx.update(users).set({ avatarUrl: url }).where(eq(users.id, userId));
      await audit(tx, {
        actorId: userId,
        spaceId: null,
        action: 'user.avatar.update',
        entity: 'user',
        entityId: userId,
        diff: { replaced: current.avatarUrl !== null },
      });
      return { previous: current.avatarUrl };
    });
  }

  /**
   * Remove a foto (idempotente; só audita `user.avatar.remove` quando havia uma). A foto do Google
   * também sai de `avatar_url`, mas o arquivo externo fica como está.
   */
  async remove(userId: string): Promise<void> {
    const previous = await this.db.transaction(async (tx) => {
      const current = await lockUser(tx, userId);
      if (!current?.avatarUrl || current.deletedAt) return null;
      await tx.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));
      await audit(tx, {
        actorId: userId,
        spaceId: null,
        action: 'user.avatar.remove',
        entity: 'user',
        entityId: userId,
      });
      return current.avatarUrl;
    });
    await deleteStoredAvatar(this.storage, userId, previous);
  }

  private async currentUrl(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId));
    return row?.avatarUrl ?? null;
  }
}

/** Serializa as trocas da foto do usuário (e a anonimização, que também trava a linha). */
async function lockUser(
  tx: Tx,
  userId: string,
): Promise<{ avatarUrl: string | null; deletedAt: Date | null } | undefined> {
  const [row] = await tx
    .select({ avatarUrl: users.avatarUrl, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  return row;
}

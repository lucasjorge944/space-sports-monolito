import { Logger } from '@nestjs/common';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { isPublishedKeyOf, UPLOAD_PREFIX } from '../storage/uploads.js';

/** Escopo das chaves da foto de perfil: `uploads/users/<id>/avatar/…` → `users/<id>/avatar/…`. */
export const avatarScope = (userId: string) => `users/${userId}/avatar`;

/**
 * Chave da foto no storage, só se a URL for uma foto de perfil publicada deste usuário. URL
 * externa (como a foto do Google, decisão 71) ou de outro objeto do bucket dá `null`: o `image` do
 * Better Auth também grava `avatar_url`, e a remoção nunca pode alcançar o arquivo de outra pessoa.
 */
export function storedAvatarKey(
  storage: PhotoStorage,
  userId: string,
  url: string | null | undefined,
): string | null {
  const key = url ? storage.keyFromUrl(url) : null;
  return key && isPublishedKeyOf(avatarScope(userId), key) ? key : null;
}

const logger = new Logger('AvatarStorage');

/**
 * Exclusão de conta (LGPD): apaga do storage tudo o que é do usuário, depois do commit da
 * anonimização. Lista os prefixos `users/<id>/` (fotos publicadas, inclusive órfãs de uma troca que
 * falhou) e `uploads/users/<id>/` (envios ainda não expirados), em vez de confiar em `avatar_url`.
 * Nunca lança: a falha só é logada e não desfaz a anonimização.
 */
export async function deleteUserMedia(storage: PhotoStorage, userId: string): Promise<void> {
  for (const prefix of [`users/${userId}/`, `${UPLOAD_PREFIX}users/${userId}/`]) {
    try {
      await storage.deletePrefix(prefix);
    } catch (err) {
      logger.warn({ err, userId, prefix }, 'Falha ao apagar a mídia do usuário no storage');
    }
  }
}

/**
 * Apaga do storage a foto de perfil do usuário (depois do commit de quem a tirou de `avatar_url`).
 * Nunca lança: a falha só é logada e deixa um arquivo órfão no bucket.
 */
export async function deleteStoredAvatar(
  storage: PhotoStorage,
  userId: string,
  url: string | null | undefined,
): Promise<void> {
  const key = storedAvatarKey(storage, userId, url);
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (err) {
    logger.warn({ err, userId, key }, 'Falha ao apagar a foto de perfil no storage');
  }
}

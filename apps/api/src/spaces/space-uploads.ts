import type { CreatePhotoUpload } from '@space-sports/shared';
import { sql } from 'drizzle-orm';
import type { Tx } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { spaces } from '../db/schema/index.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import {
  discardPublished as discardPublishedCopy,
  isScopedUploadKey,
  newScopedUploadKey,
} from '../storage/uploads.js';
import { spaceNotFound } from './spaces.errors.js';

export { contentTypeOfKey, EXTENSIONS } from '../storage/uploads.js';

// Chaves e utilitários dos uploads do espaço (fotos e logo), no esquema de `storage/uploads.ts`:
// upload em `uploads/spaces/<id>/<tipo>/<uuid>.<ext>`, publicado em
// `spaces/<id>/<tipo>/<uuid do upload>-<uuid novo>.<ext>`. URLs gravadas antes continuam valendo: o
// `keyFromUrl` do storage acha a chave pela URL pública, qualquer que seja o formato.

export type UploadKind = 'photos' | 'logo';

const scope = (spaceId: string, kind: UploadKind) => `spaces/${spaceId}/${kind}`;

/** Nova chave de upload (destino da URL pré-assinada). */
export function newUploadKey(
  spaceId: string,
  kind: UploadKind,
  contentType: CreatePhotoUpload['contentType'],
): string {
  return newScopedUploadKey(scope(spaceId, kind), contentType);
}

/** A chave é de upload deste espaço e deste tipo, no formato gerado por `newUploadKey`. */
export function isUploadKeyOf(spaceId: string, kind: UploadKind, key: string): boolean {
  return isScopedUploadKey(scope(spaceId, kind), key);
}

/** Serializa as alterações de galeria/configurações/logo de um espaço (posições sem colisão). */
export async function lockSpace(tx: Tx, spaceId: string): Promise<void> {
  const [row] = await tx
    .execute<{ id: string }>(
      sql`SELECT ${spaces.id} FROM ${spaces} WHERE ${spaces.id} = ${spaceId} FOR UPDATE`,
    )
    .then((result) => result.rows);
  if (!row) throw spaceNotFound();
}

/**
 * Apaga a cópia publicada de um registro que falhou, sob o lock do espaço, a menos que a URL já
 * esteja gravada (outro pedido com a mesma chave a registrou). Falhas aqui só deixam um órfão.
 */
export function discardPublished(
  db: Database,
  storage: PhotoStorage,
  spaceId: string,
  target: string,
  isRecorded: (tx: Tx) => Promise<boolean>,
): Promise<void> {
  return discardPublishedCopy(db, storage, target, async (tx) => {
    // Sem `lockSpace`: espaço inexistente também não tem a URL gravada.
    await tx.execute(
      sql`SELECT ${spaces.id} FROM ${spaces} WHERE ${spaces.id} = ${spaceId} FOR UPDATE`,
    );
    return isRecorded(tx);
  });
}

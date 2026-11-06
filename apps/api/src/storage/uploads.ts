import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Tx } from '../bookings/db-utils.js';
import type { AppException } from '../common/app.exception.js';
import type { Database } from '../db/client.js';
import { imageInfo } from './image-info.js';
import type { PhotoStorage } from './photo-storage.js';

// Chaves dos uploads (decisão 72). O cliente envia o arquivo para uma chave de upload
// (`uploads/<escopo>/<uuid>.<ext>`), que a URL pré-assinada alcança por alguns minutos; a API copia
// o objeto para uma chave publicada NOVA a cada registro (`<escopo>/<uuid do upload>-<uuid
// novo>.<ext>`, fora de `uploads/`), confere a cópia e só então grava a URL. Como a chave publicada
// é única, nem a URL pré-assinada (ainda válida) nem um registro concorrente da mesma chave de
// upload escrevem no objeto conferido. O uuid do upload no nome diz que a URL gravada veio daquele
// upload (registrar de novo não duplica). Os uploads ficam todos sob `uploads/`, para uma única
// regra de expiração no bucket (1 dia) limpar os abandonados, e o CloudFront só lê os publicados.
//
// Escopos: `spaces/<spaceId>/photos`, `spaces/<spaceId>/logo` e `users/<userId>/avatar`. URLs
// gravadas antes, no formato `<escopo>/<uuid>.<ext>`, continuam valendo (`keyFromUrl`).

export const UPLOAD_PREFIX = 'uploads/';

export const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type ImageContentType = keyof typeof EXTENSIONS;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UPLOAD_FILE = new RegExp(`^${UUID}\\.(jpg|png|webp)$`);
/** Publicada: `<uuid do upload>-<uuid novo>.<ext>`; sem o segundo uuid, o formato anterior. */
const PUBLISHED_FILE = new RegExp(`^${UUID}(-${UUID})?\\.(jpg|png|webp)$`);

const uploadPrefix = (scope: string) => `${UPLOAD_PREFIX}${scope}/`;

/** Nova chave de upload (destino da URL pré-assinada) no escopo. */
export function newScopedUploadKey(scope: string, contentType: ImageContentType): string {
  return `${uploadPrefix(scope)}${randomUUID()}.${EXTENSIONS[contentType]}`;
}

/** A chave é de upload deste escopo, no formato gerado por `newScopedUploadKey`. */
export function isScopedUploadKey(scope: string, key: string): boolean {
  const prefix = uploadPrefix(scope);
  return key.startsWith(prefix) && UPLOAD_FILE.test(key.slice(prefix.length));
}

/** Escopo, uuid e extensão de uma chave de upload válida. */
function parseUploadKey(uploadKey: string) {
  const slash = uploadKey.lastIndexOf('/');
  const file = uploadKey.slice(slash + 1);
  if (!uploadKey.startsWith(UPLOAD_PREFIX) || !UPLOAD_FILE.test(file)) {
    throw new Error(`Chave de upload inválida: ${uploadKey}`);
  }
  const dot = file.lastIndexOf('.');
  return {
    scope: uploadKey.slice(UPLOAD_PREFIX.length, slash),
    uuid: file.slice(0, dot),
    extension: file.slice(dot + 1),
  };
}

/**
 * Prefixo de toda chave publicada a partir desta chave de upload (`<escopo>/<uuid do upload>-`):
 * com `publicUrl`, diz se uma URL gravada veio deste upload.
 */
export function publishedPrefix(uploadKey: string): string {
  const { scope, uuid } = parseUploadKey(uploadKey);
  return `${scope}/${uuid}-`;
}

/** Chave publicada nova para um registro desta chave de upload (fora do alcance da URL). */
export function newPublishedKey(uploadKey: string): string {
  const { extension } = parseUploadKey(uploadKey);
  return `${publishedPrefix(uploadKey)}${randomUUID()}.${extension}`;
}

/** A chave publicada é deste escopo (formato atual ou anterior). */
export function isPublishedKeyOf(scope: string, key: string): boolean {
  const prefix = `${scope}/`;
  return key.startsWith(prefix) && PUBLISHED_FILE.test(key.slice(prefix.length));
}

/** Tipo esperado pela extensão da chave (gerada a partir do `contentType` pedido). */
export function contentTypeOfKey(key: string): string | undefined {
  const extension = key.slice(key.lastIndexOf('.') + 1);
  return Object.entries(EXTENSIONS).find(([, ext]) => ext === extension)?.[0];
}

/** Erros da conferência de uma imagem quadrada (cada fluxo tem os seus códigos). */
export type SquareImageErrors = {
  notUploaded: () => AppException;
  tooLarge: () => AppException;
  invalidFile: () => AppException;
  notSquare: (size: { width: number; height: number }) => AppException;
};

/**
 * O storage não garante o tamanho nem o tipo declarados no pedido da URL: confere o objeto real
 * (tamanho pelo HEAD; tipo e dimensões pelos bytes, lidos até `maxBytes + 1`) e lança o erro do
 * fluxo. Quem chama apaga o que não serve. Usado pela logo do espaço e pela foto de perfil.
 */
export async function checkSquareImage(
  storage: PhotoStorage,
  key: string,
  maxBytes: number,
  errors: SquareImageErrors,
): Promise<void> {
  const stored = await storage.head(key);
  if (!stored) throw errors.notUploaded();
  const expected = contentTypeOfKey(key);
  if (stored.size > maxBytes) throw errors.tooLarge();
  if (stored.size === 0 || stored.contentType !== expected) throw errors.invalidFile();
  const bytes = await storage.read(key, maxBytes);
  const info = bytes && bytes.length <= maxBytes ? imageInfo(bytes) : null;
  if (!info || info.contentType !== expected) throw errors.invalidFile();
  if (info.width !== info.height) throw errors.notSquare(info);
}

const logger = new Logger('Uploads');

/**
 * Apaga a cópia publicada de um registro que falhou, a menos que a URL já esteja gravada (outro
 * pedido com a mesma chave a registrou). `isRecorded` roda numa transação e deve travar a linha
 * dona da URL (espaço ou usuário). Falhas aqui só deixam um órfão.
 */
export async function discardPublished(
  db: Database,
  storage: PhotoStorage,
  target: string,
  isRecorded: (tx: Tx) => Promise<boolean>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      if (!(await isRecorded(tx))) await storage.delete(target);
    });
  } catch (err) {
    logger.warn({ err, key: target }, 'Falha ao descartar a cópia publicada');
  }
}

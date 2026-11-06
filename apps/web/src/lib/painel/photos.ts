export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 20;

/** Valida o arquivo antes de pedir a URL de envio; devolve a mensagem de erro ou `null`. */
export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'Use uma imagem JPEG, PNG ou WebP.';
  }
  if (file.size > MAX_PHOTO_BYTES) return 'A foto passa de 10 MB.';
  if (file.size === 0) return 'O arquivo está vazio.';
  return null;
}

/** Nova ordem depois de mover o item `from` para a posição `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

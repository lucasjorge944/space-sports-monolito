import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES } from '@space-sports/shared';
import { CROP_MAX_ZOOM, cropBox, type Pan, panAfterDragBox, type Size } from '@/lib/image-crop';

// Foto de perfil (RF-AUTH-02, decisões 67 e 71): a pessoa escolhe qualquer imagem JPEG/PNG/WebP, recorta
// um quadrado no navegador e o recorte (já quadrado e pequeno) segue pelo mesmo fluxo da logo do espaço.

export type AvatarType = (typeof AVATAR_CONTENT_TYPES)[number];
export const AVATAR_TYPES = AVATAR_CONTENT_TYPES;
export { AVATAR_MAX_BYTES };

/** Arquivo escolhido, antes do recorte: o recorte é reduzido, então a imagem original pode ser maior. */
export const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** Lado do quadrado enviado: sobra para as telas, que mostram a foto pequena. */
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_MAX_ZOOM = CROP_MAX_ZOOM;

export function validateAvatarSource(file: { type: string; size: number }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return 'Use uma imagem JPEG, PNG ou WebP.';
  }
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > AVATAR_SOURCE_MAX_BYTES) return 'A imagem passa de 20 MB.';
  return null;
}

export type { Pan, Size } from '@/lib/image-crop';
export type CropRect = { x: number; y: number; size: number };

/**
 * Quadrado da imagem original que vira a foto. Com zoom 1, o maior quadrado possível; o zoom o reduz
 * (até `AVATAR_MAX_ZOOM`) e o `pan` o move dentro da imagem, sem nunca sair dela.
 */
export function cropRect(image: Size, zoom: number, pan: Pan): CropRect {
  const box = cropBox(image, 1, zoom, pan);
  return { x: box.x, y: box.y, size: box.width };
}

/**
 * Arrasto na prévia (em px da prévia, de lado `viewport`) → novo `pan`. Arrastar para a direita mostra
 * mais da esquerda da imagem, como em qualquer editor de foto.
 */
export function panAfterDrag(
  image: Size,
  zoom: number,
  pan: Pan,
  drag: { dx: number; dy: number },
  viewport: number,
): Pan {
  return panAfterDragBox(image, 1, zoom, pan, drag, viewport);
}

/**
 * Formato do recorte: o mesmo da imagem escolhida. PNG e WebP mantêm a transparência (em JPEG ela
 * viraria fundo preto); JPEG continua JPEG.
 */
export function outputTypeFor(sourceType: string): AvatarType {
  return (AVATAR_TYPES as readonly string[]).includes(sourceType)
    ? (sourceType as AvatarType)
    : 'image/png';
}

/**
 * Tipo do arquivo que o navegador gerou de fato: quem não codifica WebP (Safari antigo) devolve PNG,
 * que também tem transparência. Tipo fora da lista aceita pela API fica com o pedido.
 */
export function producedType(requested: AvatarType, blobType: string): AvatarType {
  return (AVATAR_TYPES as readonly string[]).includes(blobType)
    ? (blobType as AvatarType)
    : requested;
}

const EXTENSIONS: Record<AvatarType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function avatarFileName(type: AvatarType): string {
  return `foto.${EXTENSIONS[type]}`;
}

/** Lado do arquivo final: nunca amplia uma imagem pequena. */
export function outputSize(crop: CropRect): number {
  return Math.max(1, Math.min(AVATAR_OUTPUT_SIZE, Math.round(crop.size)));
}

/** Mensagens dos erros do fluxo da foto (`/v1/me/avatar`). */
export const AVATAR_ERROR_MESSAGES: Record<string, string> = {
  STORAGE_UNAVAILABLE: 'O envio de fotos está indisponível no momento. Tente mais tarde.',
  TOO_MANY_REQUESTS: 'Muitos envios de foto na última hora. Tente de novo mais tarde.',
  IMAGE_TOO_LARGE: 'A foto passa de 2 MB.',
  IMAGE_NOT_SQUARE: 'A foto precisa ser quadrada. Recorte de novo.',
  INVALID_IMAGE_FILE: 'O arquivo não é uma imagem válida. Use JPEG, PNG ou WebP.',
  INVALID_UPLOAD_KEY: 'O envio expirou. Escolha a foto de novo.',
  UPLOAD_NOT_FOUND: 'O envio da foto não foi concluído. Tente de novo.',
  IMAGE_NOT_ALLOWED: 'A foto só pode ser trocada pelo envio de imagem.',
};

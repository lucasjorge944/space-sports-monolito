import { LOGO_CONTENT_TYPES, LOGO_MAX_BYTES } from '@space-sports/shared';

export const LOGO_TYPES = LOGO_CONTENT_TYPES;
export type LogoType = (typeof LOGO_TYPES)[number];
export { LOGO_MAX_BYTES };

/** Valida tipo e tamanho antes de pedir a URL de envio; devolve a mensagem de erro ou `null`. */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
    return 'Use uma imagem JPEG, PNG ou WebP.';
  }
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > LOGO_MAX_BYTES) return 'A logo passa de 2 MB.';
  return null;
}

/** A logo é quadrada: confere as dimensões lidas no navegador antes de enviar. */
export function validateLogoDimensions(size: { width: number; height: number }): string | null {
  if (size.width !== size.height) {
    return `A logo precisa ser quadrada (mesma largura e altura). A imagem escolhida tem ${size.width}×${size.height} px.`;
  }
  return null;
}

/** Lê as dimensões da imagem no navegador (para recusar logo não quadrada antes do envio). */
export function readImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('unreadable'));
    img.src = url;
  });
}

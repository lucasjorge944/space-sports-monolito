export type ImageInfo = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
};

/**
 * Tipo e dimensões de uma imagem PNG, JPEG ou WebP, lidos do cabeçalho (sem decodificar os
 * pixels). `null` se os bytes não forem uma dessas imagens ou o cabeçalho estiver incompleto.
 */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return png(bytes, view) ?? jpeg(bytes, view) ?? webp(bytes, view);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

/** PNG: assinatura + o primeiro chunk é o IHDR (largura e altura em 32 bits big-endian). */
function png(bytes: Uint8Array, view: DataView): ImageInfo | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE) || ascii(bytes, 12, 4) !== 'IHDR') {
    return null;
  }
  return sized('image/png', view.getUint32(16), view.getUint32(20));
}

/** JPEG: percorre os segmentos até o SOF (baseline, progressivo etc.), que traz as dimensões. */
function jpeg(bytes: Uint8Array, view: DataView): ImageInfo | null {
  if (!startsWith(bytes, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // Preenchimento (0xFF repetido) e marcadores sem tamanho.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = view.getUint16(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (offset + 9 > bytes.length) return null;
      return sized('image/jpeg', view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** WebP: contêiner RIFF com o chunk VP8 (com perdas), VP8L (sem perdas) ou VP8X (estendido). */
function webp(bytes: Uint8Array, view: DataView): ImageInfo | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    // Quadro-chave: código de início 9D 01 2A, depois largura e altura em 14 bits little-endian.
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return sized(
      'image/webp',
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return sized('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    const uint24 = (offset: number) =>
      (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
    return sized('image/webp', uint24(24) + 1, uint24(27) + 1);
  }
  return null;
}

function sized(contentType: ImageInfo['contentType'], width: number, height: number) {
  return width > 0 && height > 0 ? { contentType, width, height } : null;
}

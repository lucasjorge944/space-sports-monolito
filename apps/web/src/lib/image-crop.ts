// Recorte de imagem no navegador numa proporção fixa: a foto de perfil (quadrado) e as peças de
// anúncio (2:1 no carrossel, 4:5 no card). O zoom reduz o retângulo; o `pan` o move dentro da imagem.

export type Size = { width: number; height: number };
/** Deslocamento do recorte, de -1 (encostado à esquerda/topo) a 1 (à direita/base); 0 = centro. */
export type Pan = { x: number; y: number };
export type CropBox = { x: number; y: number; width: number; height: number };

export const CROP_MAX_ZOOM = 3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Retângulo da imagem original com a proporção `aspect` (largura ÷ altura). Com zoom 1, o maior
 * possível; o zoom o reduz (até `CROP_MAX_ZOOM`) e o `pan` o move, sem nunca sair da imagem.
 */
export function cropBox(image: Size, aspect: number, zoom: number, pan: Pan): CropBox {
  const fitsWidth = image.width / image.height <= aspect;
  const baseWidth = fitsWidth ? image.width : image.height * aspect;
  const baseHeight = fitsWidth ? image.width / aspect : image.height;
  const scale = clamp(zoom, 1, CROP_MAX_ZOOM);
  const width = baseWidth / scale;
  const height = baseHeight / scale;
  const freeX = image.width - width;
  const freeY = image.height - height;
  return {
    x: (freeX / 2) * (1 + clamp(pan.x, -1, 1)),
    y: (freeY / 2) * (1 + clamp(pan.y, -1, 1)),
    width,
    height,
  };
}

/**
 * Arrasto na prévia (em px da prévia, de largura `viewportWidth`) → novo `pan`. Arrastar para a
 * direita mostra mais da esquerda da imagem, como em qualquer editor de foto.
 */
export function panAfterDragBox(
  image: Size,
  aspect: number,
  zoom: number,
  pan: Pan,
  drag: { dx: number; dy: number },
  viewportWidth: number,
): Pan {
  const crop = cropBox(image, aspect, zoom, pan);
  const scale = crop.width / viewportWidth;
  const freeX = image.width - crop.width;
  const freeY = image.height - crop.height;
  const x = freeX > 0 ? pan.x - (2 * drag.dx * scale) / freeX : 0;
  const y = freeY > 0 ? pan.y - (2 * drag.dy * scale) / freeY : 0;
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}

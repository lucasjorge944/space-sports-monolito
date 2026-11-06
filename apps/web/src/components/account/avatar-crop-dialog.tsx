'use client';

import { ImageCropDialog } from '@/components/image-crop-dialog';
import { avatarFileName, outputSize, outputTypeFor, producedType } from '@/lib/account/avatar';
import type { CropBox } from '@/lib/image-crop';

/** Recorta o quadrado escolhido e devolve o arquivo, no formato da imagem escolhida, para o envio. */
async function renderCrop(
  image: HTMLImageElement,
  box: CropBox,
  sourceType: string,
): Promise<File> {
  const side = outputSize({ x: box.x, y: box.y, size: box.width });
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, side, side);
  const requested = outputTypeFor(sourceType);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, requested, 0.9));
  if (!blob) throw new Error('canvas');
  const type = producedType(requested, blob.type);
  return new File([blob], avatarFileName(type), { type });
}

/**
 * Recorte quadrado da foto de perfil no navegador (decisão 67): arrastar (ou setas) move, o zoom
 * aproxima. "Salvar foto" gera o quadrado e entrega a `onConfirm`, que faz o envio; o erro do envio
 * aparece aqui mesmo, para tentar de novo sem escolher o arquivo outra vez.
 */
export function AvatarCropDialog({
  file,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
  pending: boolean;
  error: string | undefined;
}) {
  return (
    <ImageCropDialog
      file={file}
      onCancel={onCancel}
      onConfirm={onConfirm}
      pending={pending}
      error={error}
      aspect={1}
      frame="circle"
      idPrefix="avatar"
      title="Recortar foto"
      description="Arraste a imagem ou use os controles de zoom e posição para ajustar o enquadramento. O círculo mostra como a foto aparece."
      confirmLabel="Salvar foto"
      render={renderCrop}
    />
  );
}

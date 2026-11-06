import { createMyAvatarUpload, deleteMyAvatar, setMyAvatar } from '@space-sports/api-client';
import { AVATAR_MAX_BYTES } from '@space-sports/shared';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Foto de perfil (RF-AUTH-02, decisões 67 e 71): a pessoa escolhe na galeria ou tira com a câmera,
// recorta em quadrado no seletor do sistema, e o app normaliza para um JPEG quadrado pequeno antes
// do envio direto ao storage (URL pré-assinada). O `updateUser` do Better Auth recusa `image`
// (`IMAGE_NOT_ALLOWED`): a foto só muda por este fluxo.

export type AvatarSource = 'camera' | 'library';

/** Lado da foto enviada, em pixels: as telas exibem a foto pequena. */
export const AVATAR_SIZE = 512;
const AVATAR_COMPRESS = 0.8;

/** Erro local do fluxo da foto (antes de chegar à API), com a mensagem pronta para a tela. */
export class AvatarError extends Error {
  override readonly name = 'AvatarError';
  constructor(
    readonly code: 'CAMERA_PERMISSION_DENIED' | 'IMAGE_TOO_LARGE' | 'UPLOAD_FAILED',
    message: string,
  ) {
    super(message);
  }
}

export interface PickedAvatar {
  uri: string;
  /** Tamanho em bytes, quando o sistema informa. */
  size?: number;
}

/**
 * Abre a câmera ou a galeria com o recorte quadrado. Devolve `null` se a pessoa cancelar.
 * A galeria usa o seletor do sistema e não pede permissão; a câmera pede na hora.
 */
export async function pickAvatar(source: AvatarSource): Promise<PickedAvatar | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new AvatarError(
        'CAMERA_PERMISSION_DENIED',
        'Sem acesso à câmera. Libere nas configurações do aparelho ou escolha uma foto da galeria.',
      );
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return normalizeAvatar(asset);
}

/**
 * Recorte do seletor pode sair com um pixel a mais num lado (e o iOS ignora `aspect`): corta o
 * centro em quadrado exato e reduz para `AVATAR_SIZE`, em JPEG. A API recusa imagem não quadrada.
 */
async function normalizeAvatar(asset: ImagePicker.ImagePickerAsset): Promise<PickedAvatar> {
  const side = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (side > 0 && asset.width !== asset.height) {
      context.crop({
        originX: Math.floor((asset.width - side) / 2),
        originY: Math.floor((asset.height - side) / 2),
        width: side,
        height: side,
      });
    }
    image = await context.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE }).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: AVATAR_COMPRESS });
    return { uri: saved.uri };
  } finally {
    // Objetos nativos do manipulator (imagem decodificada em memória) e a cópia que o seletor
    // gravou no cache: nada da foto fica no aparelho além do JPEG a enviar (LGPD).
    image?.release();
    context.release();
    deleteLocalFile(asset.uri);
  }
}

/** Apaga um arquivo do cache do app; o que não existir (ou não for arquivo local) é ignorado. */
export function deleteLocalFile(uri: string): void {
  if (!uri.startsWith('file:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Sem permissão ou já apagado: o sistema limpa o cache do app depois.
  }
}

/**
 * Envia a foto: pede a URL de upload só agora (vale 5 minutos), manda o arquivo com `PUT` e os
 * headers devolvidos, e registra a chave. Devolve a URL pública da foto nova. O JPEG local é
 * apagado no fim, com sucesso ou falha (LGPD).
 */
export async function uploadAvatar(
  picked: PickedAvatar,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    return await sendAvatar(picked, fetcher);
  } finally {
    deleteLocalFile(picked.uri);
  }
}

async function sendAvatar(picked: PickedAvatar, fetcher: typeof fetch): Promise<string> {
  const file = await (await fetcher(picked.uri)).blob();
  const size = file.size || picked.size;
  if (size && size > AVATAR_MAX_BYTES) {
    throw new AvatarError('IMAGE_TOO_LARGE', 'A foto passa de 2 MB. Escolha outra imagem.');
  }
  const upload = await createMyAvatarUpload({
    contentType: 'image/jpeg',
    ...(size ? { size } : {}),
  });
  const response = await fetcher(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new AvatarError('UPLOAD_FAILED', 'Não foi possível enviar a foto. Tente de novo.');
  }
  const { avatarUrl } = await setMyAvatar({ key: upload.key });
  return avatarUrl;
}

export async function removeAvatar(): Promise<void> {
  await deleteMyAvatar();
}

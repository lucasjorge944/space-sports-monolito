import { z } from 'zod';
import { LOGO_MAX_BYTES, PHOTO_CONTENT_TYPES, photoUploadSchema } from './spaces';

// ---------------------------------------------------------------------------
// Foto de perfil do usuário (RF-AUTH-02, decisões 67 e 71): imagem quadrada, no mesmo fluxo da
// logo do espaço (URL pré-assinada, upload direto ao storage e registro da chave).

export const AVATAR_CONTENT_TYPES = PHOTO_CONTENT_TYPES;
/** Mesmo limite da logo do espaço (2 MB): as telas exibem a foto em tamanho pequeno. */
export const AVATAR_MAX_BYTES = LOGO_MAX_BYTES;

/** POST /v1/me/avatar/uploads. A imagem precisa ser quadrada (largura = altura). */
export const createAvatarUploadSchema = z
  .object({
    contentType: z.enum(AVATAR_CONTENT_TYPES),
    /** Tamanho do arquivo em bytes (opcional): recusa cedo o que passa do limite. */
    size: z.number().int().min(1).max(AVATAR_MAX_BYTES).optional(),
  })
  .strict();
export type CreateAvatarUpload = z.infer<typeof createAvatarUploadSchema>;

/** Mesmo formato da URL de upload das fotos e da logo. */
export const avatarUploadSchema = photoUploadSchema.extend({
  /** Chave do objeto; envie em `PUT /v1/me/avatar` depois do upload. */
  key: z.string(),
});
export type AvatarUpload = z.infer<typeof avatarUploadSchema>;

/** PUT /v1/me/avatar. */
export const setAvatarSchema = z.object({ key: z.string().min(1).max(300) }).strict();
export type SetAvatar = z.infer<typeof setAvatarSchema>;

/** Resposta de PUT /v1/me/avatar: a URL pública da foto gravada. */
export const avatarResponseSchema = z.object({ avatarUrl: z.string() });
export type AvatarResponse = z.infer<typeof avatarResponseSchema>;

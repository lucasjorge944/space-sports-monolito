import {
  avatarResponseSchema,
  avatarUploadSchema,
  createAvatarUploadSchema,
  setAvatarSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI da foto de perfil (RF-AUTH-02), a partir dos schemas de @space-sports/shared.

export const avatarSchemas = {
  createUpload: openApiSchema(createAvatarUploadSchema, 'CreateAvatarUploadInput', 'input'),
  upload: openApiSchema(avatarUploadSchema, 'AvatarUpload', 'output'),
  set: openApiSchema(setAvatarSchema, 'SetAvatarInput', 'input'),
  response: openApiSchema(avatarResponseSchema, 'AvatarResponse', 'output'),
};

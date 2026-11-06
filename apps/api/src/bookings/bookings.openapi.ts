import {
  confirmPublicInviteSchema,
  confirmSuggestedUserSchema,
  publicInvitePreviewSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI do convite público e do vínculo, a partir dos schemas de @space-sports/shared.

export const bookingSchemas = {
  publicInvite: openApiSchema(publicInvitePreviewSchema, 'PublicInvitePreview', 'output'),
  confirmPublicInvite: openApiSchema(
    confirmPublicInviteSchema,
    'ConfirmPublicInviteInput',
    'input',
  ),
  confirmSuggestedUser: openApiSchema(
    confirmSuggestedUserSchema,
    'ConfirmSuggestedUserInput',
    'input',
  ),
};

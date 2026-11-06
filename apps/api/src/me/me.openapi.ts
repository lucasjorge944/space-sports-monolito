import {
  accountDeletionReceiptSchema,
  publicAccountDeletionResponseSchema,
  publicAccountDeletionSchema,
  requestAccountDeletionSchema,
  updateProfileSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI da conta do titular, a partir dos schemas de @space-sports/shared.

export const meSchemas = {
  updateProfile: openApiSchema(updateProfileSchema, 'UpdateProfileInput', 'input'),
  requestDeletion: openApiSchema(
    requestAccountDeletionSchema,
    'RequestAccountDeletionInput',
    'input',
  ),
  deletionReceipt: openApiSchema(accountDeletionReceiptSchema, 'AccountDeletionReceipt', 'output'),
  publicDeletion: openApiSchema(publicAccountDeletionSchema, 'PublicAccountDeletionInput', 'input'),
  publicDeletionResponse: openApiSchema(
    publicAccountDeletionResponseSchema,
    'PublicAccountDeletionResponse',
    'output',
  ),
};

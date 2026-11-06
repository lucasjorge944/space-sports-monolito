import {
  contactPageSchema,
  superContactPageSchema,
  unsubscribeContactSchema,
  unsubscribeResultSchema,
} from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI dos contatos, a partir dos schemas de @space-sports/shared.

export const contactSchemas = {
  page: openApiSchema(contactPageSchema, 'ContactPage', 'output'),
  superPage: openApiSchema(superContactPageSchema, 'SuperContactPage', 'output'),
  unsubscribe: openApiSchema(unsubscribeContactSchema, 'UnsubscribeContactInput', 'input'),
  unsubscribed: openApiSchema(unsubscribeResultSchema, 'UnsubscribeResult', 'output'),
};

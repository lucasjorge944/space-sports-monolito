import { cepAddressSchema } from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI do endereço, a partir dos schemas de @space-sports/shared.

export const schemas = {
  cepAddress: openApiSchema(cepAddressSchema, 'CepAddress', 'output'),
};

import { connectedAppListSchema, oauthConsentRequestSchema } from '@space-sports/shared';
import { openApiSchema } from '../openapi/zod-openapi.js';

// Componentes OpenAPI do MCP (consentimento e apps conectados), a partir de @space-sports/shared.

export const oauthSchemas = {
  consentRequest: openApiSchema(oauthConsentRequestSchema, 'OAuthConsentRequest', 'output'),
  connectedApps: openApiSchema(connectedAppListSchema, 'ConnectedAppList', 'output'),
};

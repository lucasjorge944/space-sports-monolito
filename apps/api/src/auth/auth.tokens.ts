/** Instância do Better Auth (`Auth`, ver auth.ts). */
export const AUTH = Symbol('AUTH');
/** Documento OpenAPI das rotas do Better Auth, gerado no boot (mesclado no /docs-json). */
export const AUTH_OPENAPI = Symbol('AUTH_OPENAPI');
/** `SmsSender | null`: sem sender, o login por telefone fica desligado. */
export const SMS_SENDER = Symbol('SMS_SENDER');
/**
 * Busca do Client ID Metadata Document (`ClientMetadataResourceFetch`): a de `@better-auth/cimd/node`
 * em produção; os testes trocam por um fake.
 */
export const CIMD_FETCH = Symbol('CIMD_FETCH');

// Chaves de metadata dos decorators de autorização (separadas para os guards não importarem os
// decorators, que importam os guards).
export const IS_PUBLIC = 'auth:isPublic';
export const SPACE_ROLES = 'auth:spaceRoles';
/** Nome do parâmetro de rota com o id do espaço (ex.: `/spaces/:spaceId/courts`). */
export const SPACE_ID_PARAM = 'spaceId';
/**
 * Escopos OAuth exigidos para o token do MCP entrar na rota (decisão 112). Sem esta marca, a rota
 * recusa o token do MCP; com a lista vazia, qualquer escopo do MCP serve.
 */
export const OAUTH_SCOPES = 'auth:oauthScopes';
/**
 * Visão do token do MCP nas rotas de gestão e do Super (decisão 122): os schemas Zod com a lista
 * de campos permitidos da resposta (`@OAuthView`).
 */
export const OAUTH_VIEW = 'auth:oauthView';

// Chaves de metadata dos decorators de autorização (separadas para os guards não importarem os
// decorators, que importam os guards).
export const IS_PUBLIC = 'auth:isPublic';
export const SPACE_ROLES = 'auth:spaceRoles';
/** Nome do parâmetro de rota com o id do espaço (ex.: `/spaces/:spaceId/courts`). */
export const SPACE_ID_PARAM = 'spaceId';

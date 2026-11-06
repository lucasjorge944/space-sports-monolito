import type { OpenAPIObject } from '@nestjs/swagger';
import { BRAZILIAN_PHONE_REGEX } from '@space-sports/shared';
import { AUTH_BASE_PATH, AUTH_COOKIE_PREFIX, INTERNAL_USER_FIELDS } from './auth.js';
import { ROUTES_WITHOUT_IMAGE } from './profile-image.js';

type Json = Record<string, unknown>;

const AUTH_TAG = 'auth';
const ERROR_SCHEMA_REF = '#/components/schemas/ErrorResponseDto';
/** Os modelos do Better Auth ganham o prefixo Auth no OpenAPI (ex.: User → AuthUser). */
const MODEL_PREFIX = 'Auth';
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
/**
 * operationIds do Better Auth genéricos demais para o cliente orval: `callback` geraria o hook
 * `useCallback` (colide com o do React), e `ok`/`error` não dizem de onde vêm.
 */
const OPERATION_ID_OVERRIDES: Record<string, string> = {
  'get /callback/{id}': 'oauthCallback',
  'post /callback/{id}': 'oauthCallbackPost',
  'get /ok': 'authOk',
  'get /error': 'authError',
};
/**
 * Rotas do Better Auth desligadas na configuração, mas que o plugin openAPI ainda lista. Ficam no
 * documento como `deprecated` (respondem 404) até os clientes pararem de importá-las.
 */
const DISABLED_OPERATIONS: Record<string, string> = {
  'post /delete-user':
    'Desligada (RF-AUTH-03, decisão 29): responde 404. O app inativa a conta com `POST /v1/me/deactivate`.',
  'get /delete-user/callback': 'Desligada (RF-AUTH-03, decisão 29): responde 404.',
};
/** Provedores sociais do produto (RF-AUTH-01); o Better Auth lista todos os que suporta. */
const SOCIAL_PROVIDERS = ['google', 'apple'];

/**
 * Mescla as rotas do Better Auth (geradas pelo plugin openAPI) no documento do Nest, para que
 * /docs-json descreva a API inteira e o orval gere um cliente só:
 * - caminhos com o prefixo /v1/auth, tag `auth` e operationId em todas as operações;
 * - erros 4xx/5xx no formato padrão da API (o AuthController converte as respostas);
 * - modelos User/Session/Account/Verification como AuthUser/AuthSession/...;
 * - `type: [X, 'null']` (OpenAPI 3.1) convertido para `nullable` (o Nest gera 3.0), e
 *   `propertyNames` (só 3.1; o Better Auth só o usa como `{ type: 'string' }`) removido.
 */
export function mergeAuthOpenApi(document: OpenAPIObject, authDocument: Json): OpenAPIObject {
  const auth = renameModelRefs(toOpenApi30(structuredClone(authDocument))) as Json;
  const authPaths = (auth.paths ?? {}) as Record<string, Record<string, Json>>;
  const authComponents = (auth.components ?? {}) as { schemas?: Record<string, Json> };

  const paths: Record<string, Json> = {};
  for (const [path, operations] of Object.entries(authPaths)) {
    const methods = Object.keys(operations).filter((method) => HTTP_METHODS.has(method));
    paths[`${AUTH_BASE_PATH}${path}`] = Object.fromEntries(
      methods.map((method) => [
        method,
        normalizeOperation(operations[method] as Json, path, method, methods),
      ]),
    );
  }
  patchRequestBodies(paths);

  const schemas = Object.fromEntries(
    Object.entries(authComponents.schemas ?? {}).map(([name, schema]) => [
      `${MODEL_PREFIX}${name}`,
      schema,
    ]),
  );
  patchUserSchema(schemas[`${MODEL_PREFIX}User`]);

  return {
    ...document,
    tags: [
      ...(document.tags ?? []),
      {
        name: AUTH_TAG,
        description: 'Better Auth: cadastro, login, sessão e recuperação de senha.',
      },
    ],
    paths: { ...document.paths, ...paths } as OpenAPIObject['paths'],
    components: {
      ...document.components,
      schemas: { ...document.components?.schemas, ...schemas } as never,
      securitySchemes: {
        ...document.components?.securitySchemes,
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'App: token da sessão (header `set-auth-token` ou `token` do login).',
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: `${AUTH_COOKIE_PREFIX}.session_token`,
          description: 'Web: cookie de sessão (com o prefixo `__Secure-` em HTTPS).',
        },
      },
    },
  };
}

function normalizeOperation(operation: Json, path: string, method: string, methods: string[]) {
  const responses = Object.fromEntries(
    Object.entries((operation.responses ?? {}) as Record<string, Json>).map(([status, response]) =>
      Number(status) >= 400
        ? [
            status,
            {
              description: response.description ?? 'Erro',
              content: { 'application/json': { schema: { $ref: ERROR_SCHEMA_REF } } },
            },
          ]
        : [status, response],
    ),
  );
  return {
    ...operation,
    tags: [AUTH_TAG],
    operationId:
      OPERATION_ID_OVERRIDES[`${method} ${path}`] ??
      operation.operationId ??
      operationIdFor(path, method, methods),
    security: [{ bearerAuth: [] }, { sessionCookie: [] }, {}],
    responses,
    ...(DISABLED_OPERATIONS[`${method} ${path}`]
      ? { deprecated: true, description: DISABLED_OPERATIONS[`${method} ${path}`] }
      : {}),
  };
}

/** `/phone-number/send-otp` → `phoneNumberSendOtp`; com GET e POST no mesmo caminho, o POST ganha `Post`. */
function operationIdFor(path: string, method: string, methods: string[]): string {
  const words = path
    .split('/')
    .filter((segment) => segment && !segment.startsWith('{'))
    .flatMap((segment) => segment.split('-'));
  const base = words
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
  const suffix =
    methods.length > 1 && method !== 'get' ? method.charAt(0).toUpperCase() + method.slice(1) : '';
  return `${base}${suffix}`;
}

function patchRequestBodies(paths: Record<string, Json>) {
  // Decisão 64: o cadastro por e-mail exige `phone` (validado no hook do Better Auth, auth.ts);
  // `phoneNumber` é o campo do login por OTP e não entra por aqui.
  const signUp = jsonBodySchema(paths[`${AUTH_BASE_PATH}/sign-up/email`]?.post);
  const signUpProperties = signUp?.properties as Json | undefined;
  if (signUp && signUpProperties) {
    delete signUpProperties.phoneNumber;
    signUpProperties.phone = {
      type: 'string',
      pattern: BRAZILIAN_PHONE_REGEX.source,
      example: '+5531999998888',
      description:
        'Telefone brasileiro em E.164 (+55, DDD e 8 ou 9 dígitos), obrigatório (decisão 64). Fica gravado sem verificação (`phoneNumberVerified = false`). Inválido ou ausente: 400 `INVALID_PHONE_NUMBER`.',
    };
    signUp.required = [...new Set([...((signUp.required as string[]) ?? []), 'phone'])];
  }
  // A foto só muda por /v1/me/avatar: o hook recusa `image` nestas rotas (profile-image.ts).
  for (const path of ROUTES_WITHOUT_IMAGE) {
    delete (jsonBodySchema(paths[`${AUTH_BASE_PATH}${path}`]?.post)?.properties as Json | undefined)
      ?.image;
  }

  for (const path of ['/sign-in/social', '/link-social']) {
    const properties = jsonBodySchema(paths[`${AUTH_BASE_PATH}${path}`]?.post)?.properties as
      | Json
      | undefined;
    if (properties?.provider) properties.provider = { type: 'string', enum: SOCIAL_PROVIDERS };
  }
}

function jsonBodySchema(operation: unknown): Json | undefined {
  const content = (operation as { requestBody?: { content?: Record<string, { schema?: Json }> } })
    ?.requestBody?.content;
  return content?.['application/json']?.schema;
}

/**
 * Tira as colunas internas e marca como anuláveis o e-mail (quem entra só pelo telefone não tem),
 * a foto e o telefone.
 */
function patchUserSchema(user: Json | undefined) {
  const properties = user?.properties as Record<string, Json> | undefined;
  if (!user || !properties) return;
  for (const field of Object.keys(INTERNAL_USER_FIELDS)) delete properties[field];
  if (Array.isArray(user.required)) {
    user.required = user.required.filter((field) => !(field in INTERNAL_USER_FIELDS));
  }
  for (const field of ['email', 'image', 'phoneNumber']) {
    if (properties[field]) properties[field] = { ...properties[field], nullable: true };
  }
  if (properties.image) properties.image.description = 'URL da foto (users.avatar_url).';
  if (properties.phoneNumber) properties.phoneNumber.description = 'Telefone em E.164.';
}

function toOpenApi30(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenApi30);
  if (!value || typeof value !== 'object') return value;
  const result: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'propertyNames') result[key] = toOpenApi30(child);
  }
  if (Array.isArray(result.type)) {
    const types = (result.type as string[]).filter((type) => type !== 'null');
    if (types.length === 1) {
      result.type = types[0];
      if (types.length !== (value as Json & { type: string[] }).type.length) result.nullable = true;
    }
  }
  return result;
}

function renameModelRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameModelRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string'
        ? child.replace('#/components/schemas/', `#/components/schemas/${MODEL_PREFIX}`)
        : renameModelRefs(child),
    ]),
  );
}

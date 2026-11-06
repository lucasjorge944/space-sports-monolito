import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { APP_OPTIONS, operationIdFactory, setupApp } from '../app.setup.js';
import { exportOpenApiDocument, OPENAPI_EXPORT_ENV } from './export-openapi.js';

// Nenhuma rota é chamada além do /docs-json: o Postgres e o Redis nunca conectam.
async function servedDocument(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(OPENAPI_EXPORT_ENV)],
  }).compile();
  const app = setupApp(moduleRef.createNestApplication(APP_OPTIONS));
  await app.init();
  try {
    return (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  } finally {
    await app.close();
  }
}

/** Valores de `key` em qualquer nível do documento. */
function findKey(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => findKey(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, child]) => [
    ...(k === key ? [child] : []),
    ...findKey(child, key),
  ]);
}

describe('exportOpenApiDocument (fonte do packages/api-client)', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await exportOpenApiDocument();
  });

  it('é igual ao documento servido em /docs-json', async () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(await servedDocument());
  });

  it('inclui /v1/me e as rotas de auth, sem as do login por telefone (decisão 65)', () => {
    expect(document.paths['/v1/me']?.get?.operationId).toBe('getMe');
    expect(document.paths['/v1/me/profile']?.patch?.operationId).toBe('updateMyProfile');
    expect(document.paths['/v1/auth/sign-in/email']?.post?.operationId).toBe('signInEmail');
    expect(document.paths['/v1/auth/phone-number/send-otp']).toBeUndefined();
    expect(document.paths['/v1/auth/phone-number/verify']).toBeUndefined();
  });

  it('não usa palavras-chave só do OpenAPI 3.1 (o documento é 3.0)', () => {
    expect(document.openapi).toMatch(/^3\.0\./);
    expect(findKey(document.paths, 'propertyNames')).toEqual([]);
    expect(findKey(document.components, 'propertyNames')).toEqual([]);
  });

  it('nenhum operationId gera um hook que colide com os do React', () => {
    const ids = findKey(document.paths, 'operationId') as string[];
    const hooks = ids.map((id) => `use${id.charAt(0).toUpperCase()}${id.slice(1)}`);
    for (const reactHook of [
      'useCallback',
      'useEffect',
      'useState',
      'useMemo',
      'useRef',
      'useId',
    ]) {
      expect(hooks).not.toContain(reactHook);
    }
  });
});

describe('operationIdFactory', () => {
  it('controller sem o sufixo + método', () => {
    expect(operationIdFactory('SpacesController', 'findAll')).toBe('spacesFindAll');
    expect(operationIdFactory('MeController', 'me')).toBe('meMe');
  });
});

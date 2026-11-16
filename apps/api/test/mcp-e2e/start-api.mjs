// API REAL para o e2e do MCP (apps/mcp/e2e): o build de produção (`apps/api/dist`) sobre o Postgres
// e o Redis de verdade, com UMA troca: o fetch do CIMD (o transporte real só fala HTTPS e recusa
// endereço privado, então não alcança um documento local). Os documentos são gerados a partir da
// URL do cliente, sempre sob `https://cimd.e2e.test/`:
//   - `<id>.json`            → redirect_uri https://cimd.e2e.test/callback (nunca é seguido);
//   - `...?redirect=<uri>`   → o redirect_uri pedido (para os casos de redirect inseguro);
//   - `bad-*.json`           → documento sem `redirect_uris` (inválido).
// Todo o resto vem do ambiente (DATABASE_URL, REDIS_URL, PORT, MCP_*), como no boot normal.
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const apiRoot = resolve(import.meta.dirname, '../..');
const dist = (file) => import(pathToFileURL(resolve(apiRoot, 'dist', file)).href);
const require = createRequire(resolve(apiRoot, 'package.json'));
const { Test } = await import(pathToFileURL(require.resolve('@nestjs/testing')).href);

const { AppModule } = await dist('app.module.js');
const { APP_OPTIONS, setupApp } = await dist('app.setup.js');
const { loadEnv } = await dist('config/env.js');
const { CIMD_FETCH } = await dist('auth/auth.tokens.js');

const CIMD_ORIGIN = 'https://cimd.e2e.test';

function cimdDocument(url) {
  const parsed = new URL(url);
  const name =
    parsed.pathname
      .split('/')
      .pop()
      ?.replace(/\.json$/, '') ?? 'cliente';
  if (name.startsWith('bad-')) return { client_id: url, client_name: name };
  return {
    client_id: url,
    client_name: `Cliente ${name}`,
    client_uri: CIMD_ORIGIN,
    logo_uri: `${CIMD_ORIGIN}/logo.png`,
    redirect_uris: [parsed.searchParams.get('redirect') ?? `${CIMD_ORIGIN}/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

const fakeCimdFetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(`${CIMD_ORIGIN}/`)) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(cimdDocument(url)), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' },
  });
};

const env = loadEnv();
const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
  .overrideProvider(CIMD_FETCH)
  .useValue(fakeCimdFetch)
  .compile();
const app = setupApp(moduleRef.createNestApplication(APP_OPTIONS));
await app.listen(env.PORT, '127.0.0.1');
console.log(`api-e2e-ready ${env.PORT}`);

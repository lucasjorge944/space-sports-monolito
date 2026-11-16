import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/mcp/src/config.js';
import { parseYaml } from './helpers.js';

/**
 * O compose e o `apps/mcp` mudam em pacotes diferentes. Uma superfície ou variável que o app não
 * reconhece passa no `docker compose config` e só derruba o `mcp` no deploy: o `up --wait` para, e o
 * conector do jogador cai junto. Aqui o environment do serviço passa pelo mesmo `loadConfig` da
 * subida, com `NODE_ENV=production` e as regras dela (HTTPS ou `MCP_INTERNAL_HOSTS`).
 */
const { mcp } = parseYaml('staging/compose.yml').services;
/** Fictício: o de verdade chega pelo env/mcp.env, a partir do Parameter Store. */
const SECRET = { MCP_CONFIRMATION_SECRET: 'segredo-ficticio-do-teste-com-mais-de-32-caracteres' };

describe('o apps/mcp aceita o environment do serviço mcp do compose', () => {
  it('sobe com as duas superfícies, cada uma com a sua URL de recurso', () => {
    const config = loadConfig({ ...mcp.environment, ...SECRET });
    expect(config.enabled).toBe(true);
    expect(config.surfaces).toEqual([
      { name: 'user', resourceUrl: mcp.environment.MCP_RESOURCE_URL, enabled: true },
      { name: 'admin', resourceUrl: mcp.environment.MCP_ADMIN_RESOURCE_URL, enabled: true },
    ]);
    expect(config.jwksUrl).toBe(mcp.environment.MCP_JWKS_URL);
    expect(config.allowedOrigins).toEqual([]);
  });

  it('o valor documentado da chave de emergência (`false`) desliga só a superfície admin', () => {
    // O parâmetro mcp/MCP_ADMIN_ENABLED chega pelo env/mcp.env (infra/README.md).
    const config = loadConfig({ ...mcp.environment, ...SECRET, MCP_ADMIN_ENABLED: 'false' });
    expect(config.surfaces.map(({ name, enabled }) => [name, enabled])).toEqual([
      ['user', true],
      ['admin', false],
    ]);
  });

  it('sem o segredo do env/mcp.env, recusa a subida', () => {
    expect(() => loadConfig({ ...mcp.environment })).toThrow(/MCP_CONFIRMATION_SECRET/);
  });
});

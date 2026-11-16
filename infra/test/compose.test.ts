import { describe, expect, it } from 'vitest';
import { parseYaml, readInfraFile } from './helpers.js';

interface Service {
  ports?: string[];
  restart?: string;
  mem_limit?: string;
  profiles?: string[];
  environment?: Record<string, string>;
  env_file?: { path: string; format: string }[];
  networks?: string[];
  command?: string[];
  volumes?: string[];
  image?: string;
  healthcheck?: { test?: string[]; disable?: boolean };
  depends_on?: Record<string, { condition: string }>;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
}

const compose = parseYaml('staging/compose.yml');
const services: Record<string, Service> = compose.services;
const longRunning = ['api', 'web', 'mcp', 'redis', 'postgres', 'caddy'] as const;

const megabytes = (limit: string | undefined) => Number(limit?.replace(/m$/, ''));

describe('compose do servidor', () => {
  it('só o Caddy publica portas', () => {
    const published = Object.entries(services).filter(([, service]) => service.ports);
    expect(published.map(([name]) => name)).toEqual(['caddy']);
    expect(services.caddy?.ports).toEqual(['80:80', '443:443']);
  });

  it('os serviços têm restart e limite de memória, e a soma cabe em 2 GB com folga', () => {
    for (const name of longRunning) {
      expect(services[name]?.restart, name).toBe('unless-stopped');
      expect(megabytes(services[name]?.mem_limit), name).toBeGreaterThan(0);
    }
    const total = longRunning.reduce((sum, n) => sum + megabytes(services[n]?.mem_limit), 0);
    expect(total).toBeLessThanOrEqual(1600);
  });

  it('o heap do Node cabe no limite de cada contêiner', () => {
    for (const name of ['api', 'web', 'mcp'] as const) {
      const heap = Number(services[name]?.environment?.NODE_OPTIONS?.match(/=(\d+)/)?.[1]);
      expect(heap, name).toBeLessThan(megabytes(services[name]?.mem_limit));
    }
  });

  it('Postgres e Redis ficam só na rede interna', () => {
    expect(compose.networks.data.internal).toBe(true);
    expect(services.postgres?.networks).toEqual(['data']);
    expect(services.redis?.networks).toEqual(['data']);
    expect(services.web?.networks).toEqual(['edge']);
    expect(services.mcp?.networks).toEqual(['edge']);
    expect(services.caddy?.networks).toEqual(['edge']);
  });

  it('dados persistem em volumes', () => {
    expect(services.postgres?.volumes).toContain('postgres-data:/var/lib/postgresql/data');
    expect(services.redis?.volumes).toContain('redis-data:/data');
    expect(services.caddy?.volumes).toContain('caddy-data:/data');
  });

  it('o Redis usa noeviction e AOF, com folga entre o maxmemory e o limite do contêiner', () => {
    const command = services.redis?.command?.join(' ');
    expect(command).toContain('--maxmemory-policy noeviction');
    expect(command).toContain('--appendonly yes');
    const maxmemory = Number(command?.match(/--maxmemory (\d+)mb/)?.[1]);
    // O fork da reescrita do AOF também conta no limite.
    expect(megabytes(services.redis?.mem_limit) - maxmemory).toBeGreaterThanOrEqual(32);
  });

  it('a API roda em produção, com os workers e sem a permissão do seed', () => {
    const environment = services.api?.environment;
    expect(environment?.NODE_ENV).toBe('production');
    expect(environment?.JOBS_ENABLED).toBe('true');
    expect(environment).not.toHaveProperty('ALLOW_DEMO_SEED');
    expect(services.api?.env_file?.map((file) => file.path)).toEqual(['./env/api.env']);
  });

  it('só o seed lê o seed.env, e nada de seed.env ou NODE_ENV=development vaza para a API', () => {
    const readers = Object.entries(services).filter(([, service]) =>
      service.env_file?.some((file) => file.path.endsWith('seed.env')),
    );
    expect(readers.map(([name]) => name)).toEqual(['seed']);
    expect(services.seed?.environment?.NODE_ENV).toBe('development');
    expect(services.seed?.profiles).toEqual(['ops']);
  });

  it('nenhum segredo fica no compose', () => {
    const secretNames = /PASSWORD|SECRET|DATABASE_URL|_KEY/;
    for (const [name, service] of Object.entries(services)) {
      const declared = Object.entries(service.environment ?? {});
      expect(
        declared.filter(([key]) => secretNames.test(key)).map(([key]) => key),
        name,
      ).toEqual([]);
    }
  });

  it('só os serviços da API recebem as credenciais do papel de mídia, só para leitura', () => {
    const mounting = Object.entries(services).filter(([, service]) =>
      service.volumes?.some((volume) => volume.startsWith('./aws:')),
    );
    expect(mounting.map(([name]) => name).sort()).toEqual(['api', 'migrate', 'seed']);
    for (const [, service] of mounting) expect(service.volumes).toContain('./aws:/run/aws:ro');
  });

  it('a API e o seed usam o S3 sem chaves e sem tentar o serviço de metadados', () => {
    for (const name of ['api', 'seed'] as const) {
      const environment = services[name]?.environment ?? {};
      expect(environment.AWS_CONFIG_FILE, name).toBe('/run/aws/config');
      expect(environment.AWS_EC2_METADATA_DISABLED, name).toBe('true');
      expect(
        Object.keys(environment).filter((key) => /ACCESS_KEY|^R2_/.test(key)),
        name,
      ).toEqual([]);
    }
  });

  it('as variáveis S3_* não ficam no compose: chegam juntas pelo env da API', () => {
    // O environment do compose vence o env_file: um S3_BUCKET aqui chegaria antes do S3_PUBLIC_URL,
    // que só existe depois do `cdk deploy`, e a API recusa um sem o outro.
    for (const [name, service] of Object.entries(services)) {
      expect(
        Object.keys(service.environment ?? {}).filter((key) => key.startsWith('S3_')),
        name,
      ).toEqual([]);
    }
    for (const name of ['api', 'seed'] as const) {
      expect(
        services[name]?.env_file?.map((file) => file.path),
        name,
      ).toContain('./env/api.env');
    }
  });

  describe('MCP', () => {
    const mcp = services.mcp;
    const environment = mcp?.environment ?? {};

    it('usa a imagem do commit, em produção', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: interpolação do compose, não do JS.
      expect(mcp?.image).toBe('${ECR_REGISTRY:?}/space-sports/mcp:${IMAGE_TAG:?}');
      expect(environment.NODE_ENV).toBe('production');
    });

    it('chama a API pela rede interna, e só o host `api` dispensa HTTPS', () => {
      expect(environment.API_URL).toBe('http://api:3333');
      expect(environment.MCP_JWKS_URL).toBe('http://api:3333/v1/auth/jwks');
      expect(environment.MCP_INTERNAL_HOSTS).toBe('api');
    });

    it('aceita só tokens emitidos pela API para este recurso', () => {
      const api = services.api?.environment ?? {};
      expect(environment.MCP_ISSUER).toBe(`${api.BETTER_AUTH_URL}/v1/auth`);
      expect(environment.MCP_RESOURCE_URL).toBe(api.MCP_RESOURCE_URL);
      expect(environment.MCP_RESOURCE_URL).toMatch(/^https:\/\/[^/]+\/mcp$/);
      expect(environment.WEB_URL).toBe(api.WEB_URL);
    });

    it('serve os dois conectores, cada um com a mesma URL de recurso da API', () => {
      const api = services.api?.environment ?? {};
      expect(environment.MCP_SURFACES).toBe('user,admin');
      expect(environment.MCP_ADMIN_RESOURCE_URL).toBe(api.MCP_ADMIN_RESOURCE_URL);
      expect(environment.MCP_ADMIN_RESOURCE_URL).toMatch(/^https:\/\/[^/]+\/mcp$/);
      // Um token vale para um recurso só: as audiências não podem coincidir.
      expect(new URL(environment.MCP_ADMIN_RESOURCE_URL ?? '').host).not.toBe(
        new URL(environment.MCP_RESOURCE_URL ?? '').host,
      );
    });

    it('não libera Origin de navegador', () => {
      expect(environment).not.toHaveProperty('MCP_ALLOWED_ORIGINS');
    });

    it('MCP_ENABLED não fica no compose, para o parâmetro do Parameter Store poder desligar', () => {
      // O environment do compose vence o env_file: aqui, ele anularia o api/MCP_ENABLED=false.
      for (const [name, service] of Object.entries(services)) {
        expect(service.environment ?? {}, name).not.toHaveProperty('MCP_ENABLED');
      }
      // Sem a variável, a API liga o MCP no staging pela MCP_RESOURCE_URL (DEPLOY_ENV=staging).
      expect(services.api?.environment?.DEPLOY_ENV).toBe('staging');
      expect(services.api?.environment?.MCP_RESOURCE_URL).toBeTruthy();
    });

    it('a chave do Super e a lista de clientes vêm só dos parâmetros', () => {
      // Como o MCP_ENABLED: no compose, venceriam o env/api.env e o env/mcp.env.
      for (const [name, service] of Object.entries(services)) {
        expect(service.environment ?? {}, name).not.toHaveProperty('MCP_ADMIN_ENABLED');
        expect(service.environment ?? {}, name).not.toHaveProperty('MCP_ADMIN_ALLOWED_CLIENT_IDS');
      }
      // Sem MCP_ADMIN_ENABLED, a API liga o recurso do Super pela MCP_ADMIN_RESOURCE_URL.
      expect(services.api?.environment?.MCP_ADMIN_RESOURCE_URL).toBeTruthy();
      expect(readInfraFile('staging/fetch-env.sh')).not.toMatch(/^require .*MCP_ADMIN/m);
    });

    it('roda com o disco só de leitura, sem capabilities e sem ganhar privilégio', () => {
      expect(mcp?.read_only).toBe(true);
      expect(mcp?.cap_drop).toEqual(['ALL']);
      expect(mcp?.security_opt).toEqual(['no-new-privileges:true']);
    });

    it('o segredo dos códigos de confirmação chega só pelo env/mcp.env', () => {
      expect(mcp?.env_file).toEqual([{ path: './env/mcp.env', format: 'raw' }]);
      const readers = Object.entries(services).filter(([, service]) =>
        service.env_file?.some((file) => file.path.endsWith('mcp.env')),
      );
      expect(readers.map(([name]) => name)).toEqual(['mcp']);
      expect(mcp?.env_file?.map((file) => file.path)).not.toContain('./env/api.env');
    });

    it('confere o /health e só sobe depois da API saudável', () => {
      expect(mcp?.healthcheck?.test?.join(' ')).toContain('http://127.0.0.1:3340/health');
      expect(mcp?.depends_on).toEqual({ api: { condition: 'service_healthy' } });
    });
  });

  it('lê os arquivos de env sem interpolar valores', () => {
    for (const service of Object.values(services)) {
      for (const file of service.env_file ?? []) expect(file.format).toBe('raw');
    }
  });
});

describe('Caddyfile', () => {
  const caddyfile = readInfraFile('staging/Caddyfile');

  it('aponta cada domínio para o seu serviço', () => {
    expect(caddyfile).toMatch(/^staging\.spacesports\.com\.br \{[^}]*reverse_proxy web:3000/m);
    expect(caddyfile).toMatch(/^api-staging\.spacesports\.com\.br \{[^}]*reverse_proxy api:3333/m);
    expect(caddyfile).toMatch(/^mcp-staging\.spacesports\.com\.br \{[^}]*reverse_proxy mcp:3340/m);
    // O conector do Super vai para o mesmo serviço, que escolhe a superfície pelo host.
    expect(caddyfile).toMatch(
      /^mcp-admin-staging\.spacesports\.com\.br \{[^}]*reverse_proxy mcp:3340/m,
    );
  });

  /** Conteúdo do bloco `<subdomínio>.spacesports.com.br { ... }`. */
  const blockOf = (subdomain: string) =>
    caddyfile.match(new RegExp(`^${subdomain}\\.spacesports\\.com\\.br \\{([^}]*)\\}`, 'm'))?.[1];

  it.each(['mcp-staging', 'mcp-admin-staging'])('não comprime nem segura o MCP em %s', (host) => {
    // As respostas podem vir em streaming (`text/event-stream`).
    const block = blockOf(host) ?? '';
    expect(block).toContain('reverse_proxy mcp:3340');
    expect(block).not.toMatch(/^\s*encode\b/m);
    // `header_up Host` trocaria o host que o `mcp` usa para escolher a superfície.
    expect(block).not.toMatch(/buffers|flush_interval|header_up/);
    expect(block).toContain('X-Robots-Tag "noindex, nofollow"');
  });
});

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
}

const compose = parseYaml('staging/compose.yml');
const services: Record<string, Service> = compose.services;
const longRunning = ['api', 'web', 'redis', 'postgres', 'caddy'] as const;

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
    for (const name of ['api', 'web'] as const) {
      const heap = Number(services[name]?.environment?.NODE_OPTIONS?.match(/=(\d+)/)?.[1]);
      expect(heap, name).toBeLessThan(megabytes(services[name]?.mem_limit));
    }
  });

  it('Postgres e Redis ficam só na rede interna', () => {
    expect(compose.networks.data.internal).toBe(true);
    expect(services.postgres?.networks).toEqual(['data']);
    expect(services.redis?.networks).toEqual(['data']);
    expect(services.web?.networks).toEqual(['edge']);
    expect(services.caddy?.networks).toEqual(['edge']);
  });

  it('dados persistem em volumes', () => {
    expect(services.postgres?.volumes).toContain('postgres-data:/var/lib/postgresql/data');
    expect(services.redis?.volumes).toContain('redis-data:/data');
    expect(services.caddy?.volumes).toContain('caddy-data:/data');
  });

  it('o Redis usa noeviction e AOF', () => {
    const command = services.redis?.command?.join(' ');
    expect(command).toContain('--maxmemory-policy noeviction');
    expect(command).toContain('--appendonly yes');
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
  });
});

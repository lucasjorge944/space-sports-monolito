import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = {
  API_URL: 'http://localhost:3333/',
  WEB_URL: 'http://localhost:3000',
  MCP_ISSUER: 'http://localhost:3333/v1/auth/',
  MCP_RESOURCE_URL: 'http://localhost:3340/mcp',
  MCP_CONFIRMATION_SECRET: 'x'.repeat(32),
};

const production = {
  NODE_ENV: 'production',
  API_URL: 'https://api.example.com',
  WEB_URL: 'https://app.example.com',
  MCP_ISSUER: 'https://api.example.com/v1/auth',
  MCP_RESOURCE_URL: 'https://mcp.example.com/mcp',
  MCP_CONFIRMATION_SECRET: 'y'.repeat(32),
};

describe('loadConfig', () => {
  it('usa os padrões (porta 3340, ligado, JWKS do emissor) e tira a barra do fim', () => {
    expect(loadConfig(valid)).toEqual({
      port: 3340,
      host: '0.0.0.0',
      enabled: true,
      apiUrl: 'http://localhost:3333',
      webUrl: 'http://localhost:3000',
      issuer: 'http://localhost:3333/v1/auth',
      surfaces: [{ name: 'user', resourceUrl: 'http://localhost:3340/mcp', enabled: true }],
      jwksUrl: 'http://localhost:3333/v1/auth/jwks',
      confirmationSecret: 'x'.repeat(32),
      allowedOrigins: ['localhost', '127.0.0.1', '[::1]'],
      logLevel: 'info',
    });
  });

  it('MCP_ALLOWED_ORIGINS define a lista; em produção o padrão é nenhuma', () => {
    expect(
      loadConfig({ ...valid, MCP_ALLOWED_ORIGINS: 'claude.ai, app.example.com' }).allowedOrigins,
    ).toEqual(['claude.ai', 'app.example.com']);
    expect(loadConfig(production).allowedOrigins).toEqual([]);
  });

  describe('HTTPS em produção', () => {
    it('aceita HTTPS, loopback e host interno explícito', () => {
      expect(() => loadConfig(production)).not.toThrow();
      expect(() =>
        loadConfig({
          ...production,
          API_URL: 'http://api:3333',
          MCP_JWKS_URL: 'http://api:3333/v1/auth/jwks',
          MCP_INTERNAL_HOSTS: 'api',
        }),
      ).not.toThrow();
      expect(() =>
        loadConfig({
          ...production,
          API_URL: 'http://127.0.0.1:3333',
          MCP_ISSUER: 'http://localhost:3333/v1/auth',
        }),
      ).not.toThrow();
    });

    it.each([
      ['MCP_ISSUER', { MCP_ISSUER: 'http://api.example.com/v1/auth' }],
      ['MCP_JWKS_URL', { MCP_JWKS_URL: 'http://api.example.com/v1/auth/jwks' }],
      ['MCP_JWKS_URL', { MCP_JWKS_URL: 'http://api:3333/jwks', MCP_INTERNAL_HOSTS: 'outro' }],
      ['API_URL', { API_URL: 'http://api.example.com' }],
    ])('recusa %s com http fora de loopback e da lista de hosts internos', (name, env) => {
      expect(() => loadConfig({ ...production, ...env })).toThrow(`${name}: use HTTPS`);
    });

    it('fora de produção, http é aceito', () => {
      expect(() =>
        loadConfig({ ...valid, MCP_JWKS_URL: 'http://api.example.com/v1/auth/jwks' }),
      ).not.toThrow();
    });
  });

  it('MCP_ENABLED=false desliga; variável vazia conta como ausente', () => {
    expect(loadConfig({ ...valid, MCP_ENABLED: 'false' }).enabled).toBe(false);
    expect(loadConfig({ ...valid, MCP_ENABLED: '', PORT: '' }).enabled).toBe(true);
  });

  // Como a API (`z.stringbool()`): a chave de emergência não pode derrubar o processo por causa
  // da grafia do valor.
  it.each(['False', 'FALSE', '0', 'off', 'no'])(
    'MCP_ENABLED=%s desliga, sem recusar a subida',
    (value) => {
      expect(loadConfig({ ...valid, MCP_ENABLED: value }).enabled).toBe(false);
    },
  );

  it.each(['True', '1', 'on', 'yes'])('MCP_ENABLED=%s liga', (value) => {
    expect(loadConfig({ ...valid, MCP_ENABLED: value }).enabled).toBe(true);
  });

  it('JWKS explícito', () => {
    expect(loadConfig({ ...valid, MCP_JWKS_URL: 'https://api.example.com/jwks' }).jwksUrl).toBe(
      'https://api.example.com/jwks',
    );
  });

  it('em produção, falha com a lista do que falta e com segredo curto', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /API_URL[\s\S]*MCP_CONFIRMATION_SECRET/,
    );
    const { MCP_RESOURCE_URL: _resource, ...withoutResource } = production;
    expect(() => loadConfig(withoutResource)).toThrow(
      'MCP_RESOURCE_URL: obrigatória com a superfície user',
    );
    expect(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', MCP_CONFIRMATION_SECRET: 'curto' }),
    ).toThrow(/32 caracteres/);
  });

  it('fora de produção, sobe sem .env com os endereços locais e um segredo aleatório', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      apiUrl: 'http://localhost:3333',
      issuer: 'http://localhost:3333/v1/auth',
      surfaces: [{ name: 'user', resourceUrl: 'http://localhost:3340/mcp', enabled: true }],
    });
    expect(config.confirmationSecret.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({}).confirmationSecret).not.toBe(config.confirmationSecret);
  });

  describe('MCP_SURFACES (decisão 120)', () => {
    it('padrão: só a superfície user, com MCP_RESOURCE_URL', () => {
      expect(loadConfig(valid).surfaces).toEqual([
        { name: 'user', resourceUrl: 'http://localhost:3340/mcp', enabled: true },
      ]);
      expect(loadConfig({ ...valid, MCP_SURFACES: ' User ' }).surfaces).toHaveLength(1);
    });

    it.each([
      ['player', 'superfície desconhecida (player); disponíveis: user, admin'],
      ['user,user', 'superfície repetida'],
      [',', 'informe pelo menos uma superfície'],
      ['admin', 'MCP_ADMIN_RESOURCE_URL: obrigatória com a superfície admin'],
    ])('recusa MCP_SURFACES=%s', (value, message) => {
      expect(() => loadConfig({ ...valid, MCP_SURFACES: value })).toThrow(message);
    });

    it('user,admin: as duas, cada uma com a sua URL; a admin com a chave própria', () => {
      const admin = 'https://mcp-admin.example.com/mcp';
      expect(
        loadConfig({ ...valid, MCP_SURFACES: 'user, admin', MCP_ADMIN_RESOURCE_URL: admin })
          .surfaces,
      ).toEqual([
        { name: 'user', resourceUrl: 'http://localhost:3340/mcp', enabled: true },
        { name: 'admin', resourceUrl: admin, enabled: true },
      ]);
      expect(
        loadConfig({
          ...valid,
          MCP_SURFACES: 'user,admin',
          MCP_ADMIN_RESOURCE_URL: admin,
          MCP_ADMIN_ENABLED: 'false',
        }).surfaces,
      ).toEqual([
        { name: 'user', resourceUrl: 'http://localhost:3340/mcp', enabled: true },
        { name: 'admin', resourceUrl: admin, enabled: false },
      ]);
    });

    it('só a admin num processo (contêiner próprio em produção)', () => {
      const config = loadConfig({
        ...production,
        MCP_SURFACES: 'admin',
        MCP_RESOURCE_URL: '',
        MCP_ADMIN_RESOURCE_URL: 'https://mcp-admin.example.com/mcp',
      });
      expect(config.surfaces).toEqual([
        { name: 'admin', resourceUrl: 'https://mcp-admin.example.com/mcp', enabled: true },
      ]);
    });

    it('mesmo host: precisa de outro caminho (a escolha é por host e caminho)', () => {
      expect(() =>
        loadConfig({
          ...valid,
          MCP_SURFACES: 'user,admin',
          MCP_ADMIN_RESOURCE_URL: 'http://localhost:3341/mcp',
        }),
      ).toThrow('duas superfícies com o mesmo host e caminho');
      expect(
        loadConfig({
          ...valid,
          MCP_SURFACES: 'user,admin',
          MCP_ADMIN_RESOURCE_URL: 'http://localhost:3340/admin/mcp',
        }).surfaces,
      ).toHaveLength(2);
    });

    it.each(['False', '0', 'off', 'false'])(
      'MCP_ADMIN_ENABLED=%s desliga só a admin, sem recusar a subida',
      (value) => {
        const config = loadConfig({
          ...valid,
          MCP_SURFACES: 'user,admin',
          MCP_ADMIN_RESOURCE_URL: 'http://localhost:3340/admin/mcp',
          MCP_ADMIN_ENABLED: value,
        });
        expect(config.enabled).toBe(true);
        expect(config.surfaces.map(({ name, enabled }) => [name, enabled])).toEqual([
          ['user', true],
          ['admin', false],
        ]);
      },
    );

    it('MCP_ADMIN_ENABLED com valor que não é booleano recusa a subida (como na API)', () => {
      expect(() =>
        loadConfig({
          ...valid,
          MCP_SURFACES: 'admin',
          MCP_ADMIN_RESOURCE_URL: 'http://localhost:3340/admin/mcp',
          MCP_ADMIN_ENABLED: 'talvez',
        }),
      ).toThrow('MCP_ADMIN_ENABLED');
    });

    it('a URL do recurso precisa do caminho do endpoint (ex.: /mcp)', () => {
      expect(() => loadConfig({ ...valid, MCP_RESOURCE_URL: 'https://mcp.example.com/' })).toThrow(
        'MCP_RESOURCE_URL: inclua o caminho do endpoint MCP',
      );
    });
  });
});

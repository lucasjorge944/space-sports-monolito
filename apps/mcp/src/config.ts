import { randomBytes } from 'node:crypto';
import { localhostAllowedOrigins } from '@modelcontextprotocol/server';
import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ });

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3340),
  HOST: z.string().min(1).default('0.0.0.0'),
  /**
   * Chave de emergência (RN-MCP-04): `false` responde 503 em /mcp sem afetar app e web. Booleano
   * como na API (`z.stringbool()`, sem diferença de caixa): `false`, `0`, `no`, `off` desligam;
   * `true`, `1`, `yes`, `on` ligam; outro valor recusa a subida.
   */
  MCP_ENABLED: z.stringbool().default(true),
  /** Origem da API, sem `/v1` (os caminhos do api-client já trazem `/v1`). */
  API_URL: httpUrl,
  /** URL pública do web, para os links "conclua no app" (ex.: espaço que só aceita cartão). */
  WEB_URL: httpUrl,
  /** Emissor (`iss`) dos tokens: o servidor de autorização (Better Auth da API). */
  MCP_ISSUER: httpUrl,
  /**
   * Superfícies servidas por este processo (decisão 120), separadas por vírgula. Padrão: `user`
   * (conector "Space Sports": jogador e gestão). `admin`: conector "Space Sports · Plataforma"
   * (só Super, `super:read`). Com mais de uma, a escolha é pelo host da requisição.
   */
  MCP_SURFACES: z.string().default('user'),
  /**
   * URL canônica do recurso da superfície `user`, igual ao `aud` dos tokens (RFC 8707). O caminho
   * dela é o do endpoint MCP (ex.: `/mcp`). Obrigatória quando `user` está em `MCP_SURFACES`.
   */
  MCP_RESOURCE_URL: httpUrl.optional(),
  /**
   * URL canônica do recurso da superfície `admin` (conector do Super), igual ao `aud` dos tokens do
   * Super e ao `MCP_ADMIN_RESOURCE_URL` da API. Obrigatória quando `admin` está em `MCP_SURFACES`;
   * host ou caminho diferentes dos da `user`.
   */
  MCP_ADMIN_RESOURCE_URL: httpUrl.optional(),
  /**
   * Chave de emergência só da superfície `admin` (decisão 123): `false` responde 503 no endpoint e
   * no metadata dela, sem afetar a `user`. A da API (mesmo nome) desliga o recurso do Super lá.
   * Booleano como o `MCP_ENABLED` (`z.stringbool()`).
   */
  MCP_ADMIN_ENABLED: z.stringbool().default(true),
  /** JWKS do emissor. Padrão: `<MCP_ISSUER>/jwks`. */
  MCP_JWKS_URL: httpUrl.optional(),
  /** Segredo do HMAC dos códigos de confirmação (decisão 114). */
  MCP_CONFIRMATION_SECRET: z
    .string()
    .min(32, 'MCP_CONFIRMATION_SECRET precisa de pelo menos 32 caracteres'),
  /**
   * Hosts internos (ex.: `api`, o nome do serviço no compose) aceitos com `http://` em produção em
   * `API_URL`, `MCP_ISSUER` e `MCP_JWKS_URL`. Separados por vírgula. Loopback já é aceito.
   */
  MCP_INTERNAL_HOSTS: z.string().optional(),
  /**
   * Hostnames (sem esquema nem porta) aceitos no cabeçalho `Origin` de `/mcp`. Separados por
   * vírgula. Padrão: nenhum em produção; localhost fora dela.
   */
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/**
 * Superfícies que o `apps/mcp` sabe servir (decisão 120; `docs/14-mcp.md` 8.1). Cada uma tem a sua
 * URL de recurso (`aud`), o seu metadata RFC 9728, os seus escopos, tools e prompts
 * (`src/surfaces`): `user` (jogador e gestão) e `admin` (Super).
 */
export const SURFACE_NAMES = ['user', 'admin'] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];

/** Variáveis de cada superfície: a URL do recurso e a chave de emergência própria (se houver). */
const SURFACE_ENV: Record<
  SurfaceName,
  { resourceUrl: 'MCP_RESOURCE_URL' | 'MCP_ADMIN_RESOURCE_URL'; enabled?: 'MCP_ADMIN_ENABLED' }
> = {
  user: { resourceUrl: 'MCP_RESOURCE_URL' },
  admin: { resourceUrl: 'MCP_ADMIN_RESOURCE_URL', enabled: 'MCP_ADMIN_ENABLED' },
};

export interface SurfaceConfig {
  name: SurfaceName;
  /** URL canônica do recurso (= `aud` dos tokens); o caminho dela é o do endpoint MCP. */
  resourceUrl: string;
  /**
   * Chave de emergência própria da superfície (`MCP_ADMIN_ENABLED` na `admin`; a `user` só tem a
   * global, `Config.enabled`).
   */
  enabled: boolean;
}

export interface Config {
  port: number;
  host: string;
  /** `MCP_ENABLED`: desligado, todas as superfícies respondem 503. */
  enabled: boolean;
  apiUrl: string;
  webUrl: string;
  issuer: string;
  /** Superfícies servidas, na ordem de `MCP_SURFACES` (pelo menos uma). */
  surfaces: SurfaceConfig[];
  jwksUrl: string;
  confirmationSecret: string;
  /** Hostnames aceitos no `Origin` (requisição sem `Origin` sempre passa). */
  allowedOrigins: string[];
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Em produção, emissor, JWKS e API só por HTTPS: o JWKS decide em quem o MCP confia e a API recebe
 * o token do usuário. Exceções: loopback e hosts internos listados em `MCP_INTERNAL_HOSTS`.
 */
function insecureUrls(urls: Record<string, string>, internalHosts: string[]): string[] {
  return Object.entries(urls)
    .filter(([, value]) => {
      const url = new URL(value);
      if (url.protocol === 'https:') return false;
      return !LOOPBACK.test(url.hostname) && !internalHosts.includes(url.hostname.toLowerCase());
    })
    .map(([name]) => `${name}: use HTTPS em produção (ou liste o host em MCP_INTERNAL_HOSTS)`);
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Caminho do endpoint MCP de um recurso (o caminho da URL, sem a barra final). */
export const resourcePathOf = (resourceUrl: string) =>
  new URL(resourceUrl).pathname.replace(/\/+$/, '');

/** `MCP_SURFACES` → superfícies com as variáveis de cada uma, ou a lista de problemas. */
function parseSurfaces(
  e: z.infer<typeof envSchema>,
): { surfaces: SurfaceConfig[] } | { issues: string[] } {
  const names = list(e.MCP_SURFACES).map((name) => name.toLowerCase());
  const issues: string[] = [];
  if (names.length === 0)
    issues.push('MCP_SURFACES: informe pelo menos uma superfície (ex.: user)');
  const unknown = names.filter((name) => !(SURFACE_NAMES as readonly string[]).includes(name));
  if (unknown.length) {
    issues.push(
      `MCP_SURFACES: superfície desconhecida (${unknown.join(', ')}); disponíveis: ${SURFACE_NAMES.join(', ')}`,
    );
  }
  if (new Set(names).size !== names.length) issues.push('MCP_SURFACES: superfície repetida');
  if (issues.length) return { issues };
  const surfaces: SurfaceConfig[] = [];
  for (const name of names as SurfaceName[]) {
    const { resourceUrl: variable, enabled } = SURFACE_ENV[name];
    const resourceUrl = e[variable];
    if (!resourceUrl) {
      issues.push(`${variable}: obrigatória com a superfície ${name}`);
      continue;
    }
    if (!resourcePathOf(resourceUrl)) {
      issues.push(`${variable}: inclua o caminho do endpoint MCP (ex.: https://host/mcp)`);
      continue;
    }
    surfaces.push({ name, resourceUrl, enabled: enabled ? e[enabled] : true });
  }
  // Mais de uma superfície no processo: a escolha é por host e caminho, que não podem se repetir.
  const endpoints = surfaces.map(({ resourceUrl }) => {
    const url = new URL(resourceUrl);
    return `${url.hostname.toLowerCase()}${resourcePathOf(resourceUrl)}`;
  });
  if (new Set(endpoints).size !== endpoints.length) {
    issues.push(
      'MCP_SURFACES: duas superfícies com o mesmo host e caminho de recurso (MCP_RESOURCE_URL e MCP_ADMIN_RESOURCE_URL precisam diferir no host ou no caminho)',
    );
  }
  return issues.length ? { issues } : { surfaces };
}

/**
 * Padrões do desenvolvimento local (API em 3333, web em 3000), para o `pnpm dev` da raiz subir sem
 * `.env`. O segredo vira aleatório por processo: os códigos de confirmação não sobrevivem a um
 * reinício, o que no dev não importa. Em produção (`NODE_ENV=production`), tudo é obrigatório.
 */
function developmentDefaults(): Record<string, string> {
  return {
    API_URL: 'http://localhost:3333',
    WEB_URL: 'http://localhost:3000',
    MCP_ISSUER: 'http://localhost:3333/v1/auth',
    MCP_RESOURCE_URL: 'http://localhost:3340/mcp',
    MCP_CONFIRMATION_SECRET: randomBytes(32).toString('base64url'),
  };
}

/** Lê e valida o ambiente. Variável vazia conta como ausente. Falha com a lista do que falta. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const production = env.NODE_ENV === 'production';
  const parsed = envSchema.safeParse(
    production ? present : { ...developmentDefaults(), ...present },
  );
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuração inválida do apps/mcp:\n  - ${issues.join('\n  - ')}`);
  }
  const e = parsed.data;
  const surfaces = parseSurfaces(e);
  if ('issues' in surfaces) {
    throw new Error(`Configuração inválida do apps/mcp:\n  - ${surfaces.issues.join('\n  - ')}`);
  }
  const issuer = trimSlash(e.MCP_ISSUER);
  const jwksUrl = e.MCP_JWKS_URL ?? `${issuer}/jwks`;
  if (production) {
    const internalHosts = list(e.MCP_INTERNAL_HOSTS).map((host) => host.toLowerCase());
    const insecure = insecureUrls(
      { API_URL: e.API_URL, MCP_ISSUER: issuer, MCP_JWKS_URL: jwksUrl },
      internalHosts,
    );
    if (insecure.length) {
      throw new Error(`Configuração inválida do apps/mcp:\n  - ${insecure.join('\n  - ')}`);
    }
  }
  return {
    port: e.PORT,
    host: e.HOST,
    enabled: e.MCP_ENABLED,
    apiUrl: trimSlash(e.API_URL),
    webUrl: trimSlash(e.WEB_URL),
    issuer,
    // O `aud` do token é comparado exatamente: a URL do recurso fica como foi configurada.
    surfaces: surfaces.surfaces,
    jwksUrl,
    confirmationSecret: e.MCP_CONFIRMATION_SECRET,
    allowedOrigins:
      e.MCP_ALLOWED_ORIGINS !== undefined || production
        ? list(e.MCP_ALLOWED_ORIGINS)
        : localhostAllowedOrigins(),
    logLevel: e.LOG_LEVEL,
  };
}

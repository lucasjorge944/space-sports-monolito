// Apoio dos testes da fase 2 (arquivos 11 a 17): conexões por papel (jogador/gestão e Super), chamadas
// de tool que não quebram quando o SDK lança, reset dos limites por usuário, as operações do OpenAPI
// e o "retrato" do banco que prova que nada foi escrito.
import { readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { resolve } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { MCP_MANAGE_SCOPES, MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { inject } from 'vitest';
import { sql } from './db.js';
import { MCP_ADMIN_URL, MCP_URL, REDIS_URL, USERS } from './env.js';
import { call, mcpClient, type ToolResult } from './mcp.js';
import {
  type Connected,
  type ConnectOptions,
  connect,
  disconnectAll,
  type TokenSet,
} from './oauth.js';
import type { World } from './world.js';

/** Os 7 escopos que o conector de jogador/gestão pede (o Claude pede todos; o servidor concede o que o papel permite). */
export const USER_SCOPES = [...MCP_OAUTH_SCOPES, ...MCP_MANAGE_SCOPES].join(' ');
export const SUPER_SCOPE = 'super:read';

export const world = (): World => inject('world');

export const emailOf = (key: string) => world().people[key]?.email as string;

export interface Conn {
  tokens: TokenSet;
  token: string;
  connected: Connected;
  url: string;
}

/** Conecta (OAuth completo) uma pessoa do mundo ao conector de jogador/gestão. */
export async function userConn(
  key: string,
  options: ConnectOptions & { fresh?: boolean } = {},
  email = emailOf(key),
): Promise<Conn> {
  // `fresh`: desconecta os apps da conta antes, para o fluxo passar pela tela de consentimento mesmo que
  // outro arquivo (a ordem de execução dos arquivos não é a numérica) já tenha conectado a conta.
  if (options.fresh) await disconnectAll(email);
  const connected = await connect(email, { scope: USER_SCOPES, ...options });
  return {
    tokens: connected.tokens,
    token: connected.tokens.access_token,
    connected,
    url: MCP_URL,
  };
}

/** Conecta ao conector da Plataforma (recurso do Super). */
export async function superConn(
  email: string = USERS.superUser,
  options: ConnectOptions & { fresh?: boolean } = {},
): Promise<Conn> {
  if (options.fresh) await disconnectAll(email);
  const connected = await connect(email, {
    scope: SUPER_SCOPE,
    resource: MCP_ADMIN_URL,
    ...options,
  });
  return {
    tokens: connected.tokens,
    token: connected.tokens.access_token,
    connected,
    url: MCP_ADMIN_URL,
  };
}

/** Abre o cliente MCP do SDK para a conexão e fecha ao fim. */
export async function withClient<T>(conn: Conn, run: (client: Client) => Promise<T>): Promise<T> {
  const client = await mcpClient(conn.token, conn.url);
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export type Outcome = ToolResult & {
  /** Mensagem quando o SDK lançou (ex.: 403 de escopo do `tools/call` vira exceção no cliente). */
  thrown?: string;
};

/** `call` que devolve a exceção do SDK em vez de lançar. */
export async function safeCall(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Outcome> {
  try {
    return await call(client, name, args);
  } catch (error) {
    return {
      result: { content: [] },
      data: {},
      text: '',
      isError: true,
      code: undefined,
      thrown: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Texto inteiro de uma resposta (resumo + JSON + dados estruturados), para as varreduras. */
export const everything = (outcome: Outcome) =>
  `${outcome.text}\n${JSON.stringify(outcome.data)}\n${JSON.stringify(outcome.result.content)}`;

// -------------------------------------------------------------------------------------------
// Limites por usuário (RN-MCP-03): 60 leituras/min e 10 escritas/10 min. As varreduras passam
// disso, então apagam os contadores `auth:rate-limit:mcp:*` entre os lotes (só em Redis local).

function resp(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
}

export async function resetLimits(): Promise<void> {
  const url = new URL(REDIS_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Recuso mexer num Redis que não é local: ${url.hostname}`);
  }
  const script =
    "local k = redis.call('keys', 'auth:rate-limit:mcp:*'); for i = 1, #k do redis.call('del', k[i]) end; return #k";
  await new Promise<void>((done, fail) => {
    const socket = netConnect(Number(url.port || 6379), url.hostname, () =>
      socket.write(resp(['EVAL', script, '0'])),
    );
    socket.once('data', (data) => {
      socket.end();
      if (String(data).startsWith(':')) done();
      else fail(new Error(`EVAL: ${data}`));
    });
    socket.once('error', fail);
  });
}

/** Chama `run` item a item, zerando os limites a cada `every` chamadas. */
export async function inBatches<T, R>(
  items: T[],
  run: (item: T) => Promise<R>,
  every = 40,
): Promise<R[]> {
  const out: R[] = [];
  let count = 0;
  await resetLimits();
  for (const item of items) {
    if (count > 0 && count % every === 0) await resetLimits();
    count += 1;
    out.push(await run(item));
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// OpenAPI

export interface Operation {
  method: string;
  /** Caminho do contrato, com `{param}`. */
  path: string;
  scopes: string[];
  /** Tem `x-oauth-scopes` (mesmo vazio, como `GET /v1/me/summary`): está na lista permitida do MCP. */
  listed: boolean;
  params: string[];
  /** Nomes dos parâmetros de query (para montar pedidos). */
  query: string[];
}

export function openApiOperations(): Operation[] {
  const file = resolve(import.meta.dirname, '../../../../packages/api-client/openapi.json');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as {
    paths: Record<
      string,
      Record<
        string,
        { 'x-oauth-scopes'?: string[]; parameters?: { name: string; in: string }[] } | undefined
      >
    >;
  };
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method];
      if (!operation) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        scopes: operation['x-oauth-scopes'] ?? [],
        listed: operation['x-oauth-scopes'] !== undefined,
        params: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string),
        query: (operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
      });
    }
  }
  return operations;
}

/** Parâmetros de rota com ids REAIS do mundo (a gestão do espaço A), para o pedido ser o mais perigoso possível. */
export function realParams(): Record<string, string> {
  const a = world().spaces.a;
  return {
    spaceId: a.id,
    slug: a.slug,
    courtId: a.court1,
    bookingId: a.bookingId as string,
    classGroupId: a.groupId as string,
    sessionId: a.sessionId as string,
    planId: a.planId as string,
    chargeId: world().northChargeId as string,
    userId: world().people.dani?.id as string,
  };
}

export const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

export const isManageOp = (op: Operation) => op.scopes.some((s) => s.startsWith('manage:'));
export const isSuperOp = (op: Operation) => op.scopes.includes('super:read');
/** Rotas do recurso do jogador (jogador + gestão). */
export const isUserResourceOp = (op: Operation) =>
  op.scopes.some((s) => !s.startsWith('super:')) ||
  (op.path === '/v1/me/summary' && op.method === 'GET');

export function fill(path: string, values: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => values[name] ?? PLACEHOLDER);
}

// -------------------------------------------------------------------------------------------
// "Nenhuma escrita": retrato do banco (hash das linhas) antes e depois de uma varredura.

const SNAPSHOT_TABLES = [
  'users',
  'spaces',
  'space_settings',
  'space_members',
  'space_opening_hours',
  'courts',
  'court_sports',
  'court_blocks',
  'court_occupations',
  'bookings',
  'booking_participants',
  'payment_records',
  'plans',
  'subscriptions',
  'subscription_charges',
  'enrollments',
  'class_groups',
  'class_sessions',
  'attendances',
  'space_reviews',
  'space_review_reports',
  'online_charges',
  'contacts',
  'advertisers',
  'ad_campaigns',
] as const;

export async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of SNAPSHOT_TABLES) {
    const [row] = await sql<{ digest: string }>(
      `select coalesce(md5(string_agg(t::text, '|' order by t::text)), 'vazio') as digest from ${table} t`,
    );
    out[table] = row?.digest ?? '?';
  }
  return out;
}

export async function expectNoWrites<T>(run: () => Promise<T>): Promise<T> {
  const before = await snapshot();
  const result = await run();
  const after = await snapshot();
  const changed = Object.keys(before).filter((table) => before[table] !== after[table]);
  if (changed.length > 0)
    throw new Error(`Tabelas alteradas por uma leitura: ${changed.join(', ')}`);
  return result;
}

// -------------------------------------------------------------------------------------------
// Auditoria do Super (decisão 123)

export interface AuditRow {
  id: string;
  action: string;
  actor_id: string;
  entity: string;
  diff: {
    method?: string;
    path?: string;
    query?: Record<string, unknown> | string | null;
    origin?: string;
    oauthClientId?: string;
    result?: { status?: number; code?: string | null; completed?: boolean } | null;
  } | null;
  created_at: string;
}

export async function adminAuditRows(actorId: string, since: Date): Promise<AuditRow[]> {
  return sql<AuditRow>(
    `select id, action, actor_id, entity, diff, created_at from audit_logs
      where action = 'mcp.admin_request' and actor_id = $1 and created_at >= $2
      order by created_at, id`,
    [actorId, since.toISOString()],
  );
}

/** Espera a auditoria fechar a resposta (o `result` é gravado quando a resposta termina). */
export async function settled(rows: () => Promise<AuditRow[]>, expected: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last: AuditRow[] = [];
  while (Date.now() < deadline) {
    last = await rows();
    if (last.length >= expected && last.every((row) => row.diff?.result)) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  return last;
}

// -------------------------------------------------------------------------------------------
// Estruturas de métricas

export interface MetricRow {
  key: string;
  label: string;
  // biome-ignore lint/suspicious/noExplicitAny: colunas variam por métrica.
  [column: string]: any;
}

export const rowOf = (rows: MetricRow[], key: string) => rows.find((row) => row.key === key);
export const byKey = (rows: MetricRow[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

// -------------------------------------------------------------------------------------------
// Tentativa de consentimento que NÃO lança: devolve em que etapa o servidor recusou.

import { E2E_PASSWORD } from './env.js';
import {
  authorizeUrl,
  Browser,
  CLIENT_ID,
  type ConsentRequest,
  pkce,
  signInInFlow,
} from './oauth.js';

export interface ConsentAttempt {
  /** Etapa em que parou: `authorize` (recusa antes do login), `consent` (tela) ou `redirect` (código). */
  stage: 'authorize' | 'consent' | 'redirect';
  authorize: { status: number; location: string | null; body: unknown };
  consentRequest?: ConsentRequest;
  consent?: { status: number; body: Record<string, unknown> };
  /** Reentrada do authorize já com sessão e `prompt=none` (sem tela possível). */
  promptNone?: { status: number; location: string | null; body: unknown };
  browser: Browser;
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function consentAttempt(
  email: string,
  options: { resource?: string; scope?: string; clientId?: string; consentScope?: string } = {},
): Promise<ConsentAttempt> {
  const browser = new Browser();
  const { challenge } = pkce();
  const params = { challenge, ...options };
  const first = await browser.request(authorizeUrl(params));
  const authorize = {
    status: first.status,
    location: first.headers.get('location'),
    body: first.status === 302 ? null : await bodyOf(first),
  };
  if (first.status !== 302 || !authorize.location)
    return { stage: 'authorize', authorize, browser };
  const entrar = new URL(authorize.location, 'http://web.invalid');
  const login = await signInInFlow(browser, email, entrar.search.slice(1), E2E_PASSWORD);
  if (login.res.status !== 200) {
    return { stage: 'authorize', authorize: { ...authorize, body: login.body }, browser };
  }
  const next = new URL(login.body.url, 'http://web.invalid');
  const out: ConsentAttempt = { stage: 'redirect', authorize, browser };
  if (next.pathname === '/autorizar') {
    const info = await browser.request(
      `/v1/oauth/consent-request?oauthQuery=${encodeURIComponent(next.search.slice(1))}`,
    );
    out.consentRequest = (await bodyOf(info)) as ConsentRequest;
    const consent = await browser.postJson('/v1/auth/oauth2/consent', {
      accept: true,
      ...(options.consentScope ? { scope: options.consentScope } : {}),
      oauth_query: next.search.slice(1),
    });
    out.stage = 'consent';
    out.consent = {
      status: consent.status,
      body: (await bodyOf(consent)) as Record<string, unknown>,
    };
  }
  const again = await browser.request(authorizeUrl({ ...params, extra: { prompt: 'none' } }));
  out.promptNone = {
    status: again.status,
    location: again.headers.get('location'),
    body: again.status === 302 ? null : await bodyOf(again),
  };
  return out;
}

/** Linhas de consentimento e tokens que uma conta tem no recurso do Super (`reference_id = 'mcp-admin'`). */
export async function adminGrants(userId: string) {
  const count = async (table: string) => {
    const [row] = await sql<{ n: string }>(
      `select count(*) as n from ${table} where user_id = $1 and reference_id = 'mcp-admin'`,
      [userId],
    );
    return Number(row?.n);
  };
  return {
    consents: await count('oauth_consents'),
    accessTokens: await count('oauth_access_tokens'),
    refreshTokens: await count('oauth_refresh_tokens'),
  };
}

/** O usuário tem consentimento do conector (`reference` nulo = jogador/gestão; `'mcp-admin'` = Super)? */
export async function consentExists(userId: string, reference: string | null): Promise<boolean> {
  const rows = await sql(
    `select id from oauth_consents where user_id = $1 and client_id = $2 and ${
      reference ? 'reference_id = $3' : "(reference_id is null or reference_id = '')"
    }`,
    reference ? [userId, CLIENT_ID, reference] : [userId, CLIENT_ID],
  );
  return rows.length > 0;
}

/** Zera os limites a cada 40 chamadas: use `await tick()` antes de cada requisição dos laços longos. */
let ticks = 0;
export async function tick(): Promise<void> {
  ticks += 1;
  if (ticks % 40 === 1) await resetLimits();
}

/** Ids de um espaço do mundo para preencher os parâmetros de rota e de query. */
export interface SpaceParams {
  spaceId: string;
  courtId: string;
  bookingId: string;
  classGroupId: string;
  sessionId: string;
  planId: string;
  /** Cobrança online de um TERCEIRO espaço (a Arena E2E Norte do seed). */
  chargeId: string;
  subscriptionId: string;
  userId: string;
  teacherMemberId: string;
}

export async function loadSpaceParams(
  key: 'a' | 'b',
  student: string,
  teacher: string,
): Promise<SpaceParams> {
  const space = world().spaces[key];
  const people = world().people;
  const [subscription] = await sql<{ id: string }>(
    'select id from subscriptions where space_id = $1 and user_id = $2 limit 1',
    [space.id, people[student]?.id],
  );
  const [member] = await sql<{ id: string }>(
    'select id from space_members where space_id = $1 and user_id = $2',
    [space.id, people[teacher]?.id],
  );
  return {
    spaceId: space.id,
    courtId: space.court1,
    bookingId: space.bookingId as string,
    classGroupId: space.groupId as string,
    sessionId: space.sessionId as string,
    planId: space.planId as string,
    chargeId: world().northChargeId as string,
    subscriptionId: subscription?.id as string,
    userId: people[student]?.id as string,
    teacherMemberId: member?.id as string,
  };
}

/** URL de uma operação de gestão com os parâmetros de rota e os filtros de id da query preenchidos. */
export function manageUrl(
  op: Operation,
  params: SpaceParams,
  options: { filters?: SpaceParams } = {},
): string {
  const path = fill(op.path, params as unknown as Record<string, string>);
  const query = new URLSearchParams();
  const iso = /\{spaceId\}\/(bookings|court-blocks|statement)$|wallet\/entries$/.test(op.path);
  const from = world().windows.from;
  const to = world().windows.to;
  if (op.query.includes('from')) query.set('from', iso ? `${from}T03:00:00.000Z` : from);
  if (op.query.includes('to')) query.set('to', iso ? `${to}T23:00:00.000Z` : to);
  // A frequência/presença exige um filtro: no controle usa a turma do próprio espaço.
  if (op.path.endsWith('/class-attendances') && !options.filters) {
    query.set('classGroupId', params.classGroupId);
  }
  const source = options.filters ?? params;
  for (const name of ['courtId', 'classGroupId', 'subscriptionId', 'userId', 'teacherMemberId']) {
    if (options.filters && op.query.includes(name)) {
      query.set(name, (source as unknown as Record<string, string>)[name] as string);
    }
  }
  if (options.filters && op.query.includes('payableId')) query.set('payableId', source.bookingId);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Valor de uma chave do Redis (só em Redis local), ou `null`. */
export async function redisGet(key: string): Promise<string | null> {
  const url = new URL(REDIS_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Recuso ler um Redis que não é local: ${url.hostname}`);
  }
  return new Promise((done, fail) => {
    const socket = netConnect(Number(url.port || 6379), url.hostname, () =>
      socket.write(resp(['GET', key])),
    );
    socket.once('data', (data) => {
      socket.end();
      const text = String(data);
      if (text.startsWith('$-1')) done(null);
      else done(text.split('\r\n')[1] ?? null);
    });
    socket.once('error', fail);
  });
}

/** Quantas leituras o contador por usuário já contou na janela atual. */
export async function readCount(userId: string): Promise<number> {
  return Number((await redisGet(`auth:rate-limit:mcp:read:${userId}`)) ?? 0);
}

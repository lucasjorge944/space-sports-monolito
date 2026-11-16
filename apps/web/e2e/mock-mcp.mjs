// Fluxo OAuth do MCP e "Apps conectados" na API simulada (docs/14-mcp.md seção 3.5). Espelha as regras
// da API: o pedido de consentimento exige sessão, assinatura e prazo; "Permitir" cria a conexão (ela
// passa a aparecer em /v1/me/connected-apps); "Cancelar" volta com `error=access_denied` e não cria nada;
// desconectar é idempotente (204). O cliente é dado pelo `client_id` do pedido (cenários abaixo).
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WEB_URL = process.env.MOCK_WEB_URL ?? 'http://localhost:3100';

/** Na ordem canônica do consentimento (packages/shared `MCP_OAUTH_SCOPES`). */
const SCOPES = ['spaces:read', 'bookings:read', 'bookings:write', 'classes:read', 'classes:write'];

// Fase 2 (docs/14-mcp.md 8.1): dois conectores (recursos), cada um com os seus escopos. O recurso do
// Super é o que a URL do pedido (`resource`) traz com "admin"; sem `resource`, vale o do jogador.
const RESOURCE_SCOPES = {
  USER: [...SCOPES, 'manage:read', 'manage:finance:read'],
  ADMIN: ['super:read'],
};
const RESOURCE_NAMES = { USER: 'Space Sports', ADMIN: 'Space Sports · Plataforma' };
const ADMIN_MAX_HOURS = 24;

const resourceKindOf = (params) => (/admin/.test(params.get('resource') ?? '') ? 'ADMIN' : 'USER');

/**
 * Escopos que a conta pode usar (espelha `eligibleScopes` da API, RN-MCP-06): os de jogador, qualquer
 * conta; `manage:read`, papel ativo em algum espaço; `manage:finance:read`, Dono ou Admin; `super:read`,
 * o Super. O Professor, portanto, recebe `manage:read` e nunca o financeiro.
 */
function eligible(scope, account) {
  if (scope === 'manage:read') return account.roles.length > 0;
  if (scope === 'manage:finance:read') {
    return account.roles.some((role) => role === 'OWNER' || role === 'ADMIN');
  }
  if (scope === 'super:read') return account.super;
  return true;
}

/**
 * Cenários pelo `client_id` (CIMD, uma URL). `requestError`: o pedido de consentimento falha (a API
 * responde 400 `OAUTH_REQUEST_INVALID` / 404 `OAUTH_CLIENT_NOT_FOUND`); `consentError`: o POST do
 * consentimento falha (`gone` = pedido vencido no meio do caminho; `server` = 500 só na 1ª vez).
 */
const CLIENTS = {
  'https://assistente.exemplo/cimd': {
    name: 'Assistente Exemplo',
    host: 'assistente.exemplo',
    uri: 'https://assistente.exemplo',
    logoUrl: 'https://assistente.exemplo/logo.svg',
  },
  'https://sem-logo.exemplo/cimd': {
    name: 'Zeca IA',
    host: 'sem-logo.exemplo',
    uri: null,
    logoUrl: null,
  },
  // Logo fora do que o web aceita (só https): `http:` e `javascript:`. A API não valida a imagem.
  'https://logo-http.exemplo/cimd': {
    name: 'Assistente Sem Cadeado',
    host: 'logo-http.exemplo',
    uri: null,
    logoUrl: 'http://logo-http.exemplo/logo.svg',
  },
  'https://logo-js.exemplo/cimd': {
    name: 'Assistente Script',
    host: 'logo-js.exemplo',
    uri: null,
    logoUrl: 'javascript:alert(1)',
  },
  // Defesa: um escopo que o web não conhece (API mais nova) não vira item em branco na lista.
  'https://escopo-novo.exemplo/cimd': {
    name: 'Assistente Novo',
    host: 'escopo-novo.exemplo',
    uri: null,
    logoUrl: null,
    extraScopes: ['admin:all'],
  },
  // Defesa: destino de redirect que não é caminho nem https/loopback não pode ser seguido.
  'https://redirect-ruim.exemplo/cimd': {
    name: 'Assistente Redirect',
    host: 'redirect-ruim.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'bad-redirect',
  },
  // Cliente fora de `MCP_ADMIN_ALLOWED_CLIENT_IDS`: nem o Super concede nada no recurso da plataforma.
  'https://fora-da-lista.exemplo/cimd': {
    name: 'Assistente Fora da Lista',
    host: 'fora-da-lista.exemplo',
    uri: null,
    logoUrl: null,
    adminBlocked: true,
  },
  // A conta perde o acesso entre abrir a tela e clicar: o "Permitir" refaz a conta e responde 403.
  'https://perdeu-acesso.exemplo/cimd': {
    name: 'Assistente Sem Acesso',
    host: 'perdeu-acesso.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'no-access',
  },
  // Conector desligado no servidor (`MCP_ADMIN_ENABLED=false`): o "Permitir" responde 503.
  'https://desligado.exemplo/cimd': {
    name: 'Assistente Desligado',
    host: 'desligado.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'disabled',
  },
  // Corrida: o cliente saiu da lista do Super depois de abrir a tela; o "Permitir" responde 400
  // `unauthorized_client` (o mesmo status do "pedido vencido", mas é falta de acesso).
  'https://saiu-da-lista.exemplo/cimd': {
    name: 'Assistente Removido',
    host: 'saiu-da-lista.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'unauthorized',
  },
  // Corrida: o telefone some entre abrir a tela e clicar; o "Permitir" responde o 403 real da API
  // (`error: access_denied` + `code: PROFILE_INCOMPLETE`), que não é falta de acesso ao conector.
  'https://cadastro-incompleto.exemplo/cimd': {
    name: 'Assistente Cadastro',
    host: 'cadastro-incompleto.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'profile-incomplete',
  },
  'https://vencido.exemplo/cimd': { requestError: 'invalid' },
  'https://sumiu.exemplo/cimd': { requestError: 'not-found' },
  'https://gone.exemplo/cimd': {
    name: 'Assistente Lento',
    host: 'gone.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'gone',
  },
  'https://instavel.exemplo/cimd': {
    name: 'Assistente Instável',
    host: 'instavel.exemplo',
    uri: null,
    logoUrl: null,
    consentError: 'server',
  },
};

const oauthError = (res, send, status, error, description) => {
  send(res, status, { error, error_description: description });
  return true;
};

/** Conexões já existentes (cenário `/__mcp-setup?apps=seed`). */
function seedApps() {
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
  return [
    {
      id: ID(701),
      clientId: 'https://assistente.exemplo/cimd',
      name: 'Assistente Exemplo',
      host: 'assistente.exemplo',
      uri: 'https://assistente.exemplo',
      logoUrl: null,
      resource: { kind: 'USER', name: RESOURCE_NAMES.USER },
      scopes: SCOPES,
      authorizedAt: daysAgo(2),
      lastUsedAt: daysAgo(1),
      expiresAt: null,
    },
    {
      id: ID(702),
      clientId: 'https://sem-logo.exemplo/cimd',
      name: 'Zeca IA',
      host: 'sem-logo.exemplo',
      uri: null,
      logoUrl: null,
      resource: { kind: 'USER', name: RESOURCE_NAMES.USER },
      scopes: ['spaces:read', 'bookings:read'],
      authorizedAt: daysAgo(10),
      lastUsedAt: null,
      expiresAt: null,
    },
  ];
}

/** Conexões da fase 2 (`apps=both`): o mesmo cliente nos dois conectores, o da gestão e o do Super (vencido). */
function phase2Apps() {
  const hoursAgo = (n) => new Date(Date.now() - n * 3_600_000).toISOString();
  const hoursAhead = (n) => new Date(Date.now() + n * 3_600_000).toISOString();
  return [
    {
      id: ID(721),
      clientId: 'https://assistente.exemplo/cimd',
      name: 'Assistente Exemplo',
      host: 'assistente.exemplo',
      uri: 'https://assistente.exemplo',
      logoUrl: null,
      resource: { kind: 'USER', name: RESOURCE_NAMES.USER },
      scopes: ['spaces:read', 'bookings:read', 'manage:read', 'manage:finance:read'],
      authorizedAt: hoursAgo(30),
      lastUsedAt: hoursAgo(2),
      expiresAt: null,
    },
    {
      id: ID(722),
      clientId: 'https://assistente.exemplo/cimd',
      name: 'Assistente Exemplo',
      host: 'assistente.exemplo',
      uri: 'https://assistente.exemplo',
      logoUrl: null,
      resource: { kind: 'ADMIN', name: RESOURCE_NAMES.ADMIN },
      scopes: ['super:read'],
      authorizedAt: hoursAgo(4),
      lastUsedAt: null,
      expiresAt: hoursAhead(20),
    },
    {
      id: ID(723),
      clientId: 'https://sem-logo.exemplo/cimd',
      name: 'Zeca IA',
      host: 'sem-logo.exemplo',
      uri: null,
      logoUrl: null,
      resource: { kind: 'ADMIN', name: RESOURCE_NAMES.ADMIN },
      scopes: ['super:read'],
      authorizedAt: hoursAgo(31),
      lastUsedAt: hoursAgo(26),
      expiresAt: hoursAgo(7),
    },
  ];
}

/** A query assinada do authorize: `sig` e `ba_param` são obrigatórios; `exp` (segundos) é o prazo. */
function parseSigned(oauthQuery) {
  if (typeof oauthQuery !== 'string') return null;
  const params = new URLSearchParams(oauthQuery);
  if (!params.get('sig') || params.getAll('ba_param').length === 0) return null;
  // Parâmetro fora da lista assinada quebra a assinatura (como no Better Auth).
  const signed = new Set(params.getAll('ba_param'));
  for (const key of params.keys()) {
    if (key !== 'sig' && !signed.has(key)) return null;
  }
  return params;
}

function isExpired(params) {
  const exp = Number(params.get('exp'));
  return Number.isFinite(exp) && exp > 0 && exp * 1000 <= Date.now();
}

function clientOf(params) {
  return CLIENTS[params.get('client_id') ?? ''];
}

/** O que o pedido quer do conector (`scope` ∩ escopos do recurso); sem `scope`, todos os do recurso. */
function requestedScopes(params) {
  const universe = RESOURCE_SCOPES[resourceKindOf(params)];
  if (!params.get('scope')) return universe;
  const asked = new Set(params.get('scope').split(/[ +]/));
  return universe.filter((scope) => asked.has(scope));
}

/**
 * Pedidos ∩ elegíveis da conta (o que o "Permitir" concede) e o que ficou de fora. Espelha
 * `consentRequest` da API (connected-apps.service.ts): o Super só autoriza cliente da lista e com o
 * recurso ligado (`adminBlocked`; sem isso, nada a conceder), e `deniedScopes` são TODOS os escopos do
 * conector que a conta não pode usar, tenham sido pedidos ou não.
 */
function decide(params, client, account, state) {
  const kind = resourceKindOf(params);
  const adminBlocked = kind === 'ADMIN' && (Boolean(client.adminBlocked) || state.adminDisabled);
  const allowed = (scope) => !adminBlocked && eligible(scope, account);
  return {
    kind,
    scopes: requestedScopes(params).filter(allowed),
    deniedScopes: RESOURCE_SCOPES[kind].filter((scope) => !allowed(scope)),
  };
}

function callbackUrl(params, extra) {
  const url = new URL(params.get('redirect_uri') ?? 'http://localhost:3334/__client-callback');
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const state = params.get('state');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** Resposta do `POST /v1/auth/sign-in/email` quando o corpo traz `oauth_query` (fluxo do MCP). */
export function oauthSignInBody(body, user) {
  const params = parseSigned(body.oauth_query);
  if (!params) return { status: 400, body: { error: 'invalid_signature' } };
  return {
    status: 200,
    body: {
      redirect: true,
      url: `${WEB_URL}/autorizar?${body.oauth_query}`,
      token: null,
      user,
    },
  };
}

export async function handleMcp({
  req,
  res,
  path,
  url,
  send: sendJson,
  fail: failJson,
  readJson,
  scoped,
  calls,
  session,
}) {
  // O roteador da API simulada trata "respondeu" como retorno verdadeiro.
  const send = (...args) => {
    sendJson(...args);
    return true;
  };
  const fail = (...args) => {
    failJson(...args);
    return true;
  };
  const method = req.method ?? 'GET';
  scoped.mcp ??= { apps: [], failedOnce: false };
  const state = scoped.mcp;

  if (path === '/__mcp-setup') {
    // `apps=seed` (conexões existentes), `failDelete=1` (a próxima desconexão falha uma vez),
    // `unknownScope=1` (um escopo desconhecido numa conexão).
    const apps = url.searchParams.get('apps');
    state.apps = apps === 'seed' ? seedApps() : apps === 'both' ? phase2Apps() : [];
    // `unknownScope=1`: a conexão do "Zeca IA" traz também um escopo que o web não conhece.
    if (url.searchParams.get('unknownScope') === '1' && state.apps[1]) {
      state.apps[1].scopes = [...state.apps[1].scopes, 'admin:all'];
    }
    state.failDelete = url.searchParams.get('failDelete') === '1';
    // `adminDisabled=1`: `MCP_ADMIN_ENABLED=false` (o pedido do conector da plataforma não concede nada).
    state.adminDisabled = url.searchParams.get('adminDisabled') === '1';
    return send(res, 200, {});
  }
  // Destino do `redirect_uri` dos testes: um cliente em loopback, para o navegador chegar a ele.
  if (path === '/__client-callback') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Cliente</title><h1>Voltou ao assistente</h1>');
    return true;
  }

  if (path === '/v1/oauth/consent-request' && method === 'GET') {
    if (!session) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    const params = parseSigned(url.searchParams.get('oauthQuery'));
    const client = params && clientOf(params);
    if (!params || isExpired(params) || client?.requestError === 'invalid') {
      return fail(res, 400, 'OAUTH_REQUEST_INVALID', 'Pedido inválido ou vencido.');
    }
    if (!client || client.requestError === 'not-found') {
      return fail(res, 404, 'OAUTH_CLIENT_NOT_FOUND', 'Cliente não encontrado.');
    }
    const decision = decide(params, client, session, state);
    return send(res, 200, {
      client: {
        clientId: params.get('client_id'),
        name: client.name,
        host: client.host,
        uri: client.uri,
        logoUrl: client.logoUrl,
      },
      resource: {
        kind: decision.kind,
        name: RESOURCE_NAMES[decision.kind],
        maxConnectionHours: decision.kind === 'ADMIN' ? ADMIN_MAX_HOURS : null,
      },
      scopes: [...decision.scopes, ...(client.extraScopes ?? [])],
      deniedScopes: decision.deniedScopes,
      canAuthorize: decision.scopes.length > 0,
      expiresAt: new Date(Number(params.get('exp')) * 1000).toISOString(),
    });
  }

  if (path === '/v1/auth/oauth2/continue' && method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: '/oauth2/continue', body });
    if (!session) return oauthError(res, send, 401, 'login_required', 'Login necessário.');
    if (!parseSigned(body.oauth_query)) {
      return oauthError(res, send, 400, 'invalid_signature', 'Assinatura inválida.');
    }
    return send(res, 200, { redirect: true, url: `${WEB_URL}/autorizar?${body.oauth_query}` });
  }

  if (path === '/v1/auth/oauth2/consent' && method === 'POST') {
    const body = await readJson(req);
    calls.push({ path: '/oauth2/consent', body });
    if (!session) return oauthError(res, send, 401, 'login_required', 'Login necessário.');
    const params = parseSigned(body.oauth_query);
    const client = params && clientOf(params);
    if (!params || isExpired(params) || !client || client.requestError) {
      return oauthError(res, send, 400, 'invalid_signature', 'Pedido inválido ou vencido.');
    }
    if (client.consentError === 'gone') {
      return oauthError(res, send, 400, 'invalid_request', 'Pedido vencido.');
    }
    if (body.accept === true && client.consentError === 'no-access') {
      return send(res, 403, { code: 'OAUTH_ACCESS_DENIED', error: 'access_denied' });
    }
    if (body.accept === true && client.consentError === 'profile-incomplete') {
      return send(res, 403, {
        error: 'access_denied',
        error_description: 'profile incomplete: phone',
        code: 'PROFILE_INCOMPLETE',
        message: 'Complete o seu cadastro para conectar um assistente.',
        details: { missing: ['phone'] },
      });
    }
    if (body.accept === true && client.consentError === 'unauthorized') {
      return oauthError(res, send, 400, 'unauthorized_client', 'Cliente não autorizado.');
    }
    if (body.accept === true && client.consentError === 'disabled') {
      return send(res, 503, { code: 'MCP_DISABLED', error: 'temporarily_unavailable' });
    }
    if (client.consentError === 'bad-redirect') {
      return send(res, 200, { redirect: true, url: 'javascript:window.__pwned=1' });
    }
    if (client.consentError === 'server' && !state.failedOnce) {
      state.failedOnce = true;
      return oauthError(res, send, 500, 'server_error', 'Erro interno.');
    }
    if (body.accept !== true) {
      return send(res, 200, {
        redirect: true,
        url: callbackUrl(params, { error: 'access_denied' }),
      });
    }
    // Refaz a conta no servidor (RN-MCP-06): sem nenhum escopo concedível, 403 e nada é gravado.
    const decision = decide(params, client, session, state);
    if (decision.scopes.length === 0) {
      return send(res, 403, {
        code: 'OAUTH_ACCESS_DENIED',
        error: 'access_denied',
        message: 'Sua conta não tem acesso a este conector.',
      });
    }
    const clientId = params.get('client_id');
    // Um consentimento por (cliente, conector): reconectar um não mexe no outro.
    state.apps = state.apps.filter(
      (app) => !(app.clientId === clientId && app.resource.kind === decision.kind),
    );
    const now = Date.now();
    state.apps.unshift({
      id: ID(710 + state.apps.length),
      clientId,
      name: client.name,
      host: client.host,
      uri: client.uri,
      logoUrl: null,
      resource: { kind: decision.kind, name: RESOURCE_NAMES[decision.kind] },
      scopes: decision.scopes,
      authorizedAt: new Date(now).toISOString(),
      lastUsedAt: null,
      expiresAt:
        decision.kind === 'ADMIN'
          ? new Date(now + ADMIN_MAX_HOURS * 3_600_000).toISOString()
          : null,
    });
    return send(res, 200, {
      redirect: true,
      url: callbackUrl(params, { code: 'codigo-de-teste' }),
    });
  }

  if (path === '/v1/me/connected-apps' && method === 'GET') {
    if (!session) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    const items = [...state.apps].sort((a, b) => b.authorizedAt.localeCompare(a.authorizedAt));
    return send(res, 200, { items });
  }
  const disconnect = /^\/v1\/me\/connected-apps\/([^/]+)$/.exec(path);
  if (disconnect && method === 'DELETE') {
    if (!session) return fail(res, 401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    calls.push({ path: `DELETE /v1/me/connected-apps/${disconnect[1]}`, body: {} });
    if (state.failDelete) {
      state.failDelete = false;
      return fail(res, 500, 'INTERNAL_ERROR', 'Erro interno.');
    }
    state.apps = state.apps.filter((app) => app.id !== disconnect[1]);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

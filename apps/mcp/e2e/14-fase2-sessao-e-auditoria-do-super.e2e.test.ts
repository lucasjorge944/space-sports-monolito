import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { MCP_ADMIN_URL, MCP_URL, USERS } from './support/env.js';
import {
  adminAuditRows,
  consentAttempt,
  consentExists,
  resetLimits,
  safeCall,
  settled,
  superConn,
  userConn,
  withClient,
  world,
} from './support/fase2.js';
import { userByEmail } from './support/helpers.js';
import { ok, rawMcp } from './support/mcp.js';
import { api, appSession, CLIENT_ID, decodeJwt, tokenRequest } from './support/oauth.js';

// Fase 2, proteções do Super (docs/14-mcp.md 8.3; RN-MCP-07 e RN-MCP-08; decisão 123): sessão de no
// máximo 24 h, auditoria de TODA requisição com o token do Super (inclusive as recusadas) e
// falha fechada quando a auditoria não grava.
//
// RELÓGIO: os processos da API e do MCP rodam com o relógio real e não há como controlá-lo de fora.
// A idade da conexão é a de `oauth_consents.created_at` (conferida a cada requisição, na emissão e
// na renovação), então o teste "envelhece" a conexão recuando essa coluna e o `expires_at` do refresh
// no banco. LACUNA: o `exp` de 15 min do token de acesso e a passagem real das 24 h não são
// exercitados de ponta a ponta (docs/14-mcp.md, seção 7.2, "Lacunas").

const w = world();

const backdateConsent = (userId: string, interval: string) =>
  sql(
    `update oauth_consents set created_at = now() - $2::interval
      where user_id = $1 and reference_id = 'mcp-admin'`,
    [userId, interval],
  );

describe('(2) sessão de 24 h do Super (decisão 123)', () => {
  it('aos 23 h 55 min a conexão vale; aos 24 h 01 min o token, a renovação e as tools param, e o recurso pede nova conexão', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    await resetLimits();
    expect((await api('/v1/super/spaces?pageSize=1', conn.token)).status).toBe(200);

    await backdateConsent(sup.id, '23 hours 55 minutes');
    expect((await api('/v1/super/spaces?pageSize=1', conn.token)).status).toBe(200);
    await withClient(conn, async (client) => {
      const res = await safeCall(client, 'list_spaces', { pageSize: 1 });
      expect(res.isError).toBe(false);
    });

    await backdateConsent(sup.id, '24 hours 1 minute');
    const expired = await api('/v1/super/spaces?pageSize=1', conn.token);
    expect([expired.status, expired.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
    // Pelo MCP: o assistente recebe a recusa, nunca dados; a orientação manda conectar de novo.
    await withClient(conn, async (client) => {
      const res = await safeCall(client, 'list_spaces', { pageSize: 1 });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.data)).not.toMatch(/"rows"|"total"/);
      if (res.code) {
        expect(res.code).toBe('OAUTH_TOKEN_INVALID');
        expect(res.text).toMatch(/24 horas/);
      }
    });
    // A renovação também recusa (invalid_grant), mesmo com o refresh ainda dentro do TTL próprio.
    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: conn.tokens.refresh_token as string,
      client_id: CLIENT_ID,
      resource: MCP_ADMIN_URL,
    });
    expect(refreshed.status).toBe(400);
    expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' });

    // Nova conexão: o consentimento vencido é apagado e o fluxo pede "Permitir" de novo.
    const again = await superConn();
    expect(again.connected.consentRequest?.canAuthorize).toBe(true);
    const [consent] = await sql<{ age: string; n: string }>(
      `select extract(epoch from (now() - max(created_at))) as age, count(*) as n
         from oauth_consents where user_id = $1 and reference_id = 'mcp-admin'`,
      [sup.id],
    );
    expect(Number(consent?.n)).toBe(1);
    expect(Number(consent?.age)).toBeLessThan(120);
    await resetLimits();
    expect((await api('/v1/super/spaces?pageSize=1', again.token)).status).toBe(200);
    // O token da conexão antiga não ressuscita com a nova (emitido antes do consentimento atual).
    const old = await api('/v1/super/spaces?pageSize=1', conn.token);
    expect([old.status, old.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
  });

  it('a janela NÃO desliza: renovar dentro das 24 h não estende a conexão', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    await backdateConsent(sup.id, '23 hours 50 minutes');
    const [before] = await sql<{ created_at: string }>(
      `select created_at from oauth_consents where user_id = $1 and reference_id = 'mcp-admin'`,
      [sup.id],
    );
    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: conn.tokens.refresh_token as string,
      client_id: CLIENT_ID,
      resource: MCP_ADMIN_URL,
    });
    expect(refreshed.status).toBe(200);
    const [after] = await sql<{ created_at: string }>(
      `select created_at from oauth_consents where user_id = $1 and reference_id = 'mcp-admin'`,
      [sup.id],
    );
    expect(String(after?.created_at)).toBe(String(before?.created_at));
    // Vinte minutos depois, a renovação já não passa.
    await backdateConsent(sup.id, '24 hours 5 minutes');
    const next = (await refreshed.json()) as { refresh_token: string };
    const late = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: next.refresh_token,
      client_id: CLIENT_ID,
      resource: MCP_ADMIN_URL,
    });
    expect(late.status).toBe(400);
  });

  it('TTL do refresh por recurso: 24 h no Super e 30 dias no jogador; refresh vencido no banco não renova', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    await userConn('semPapel', {}, USERS.superUser);
    const ttl = async (admin: boolean) => {
      const [row] = await sql<{ seconds: string }>(
        `select extract(epoch from (expires_at - created_at)) as seconds from oauth_refresh_tokens
          where user_id = $1 and client_id = $2 and revoked is null and ${
            admin ? "reference_id = 'mcp-admin'" : "(reference_id is null or reference_id = '')"
          } order by created_at desc limit 1`,
        [sup.id, CLIENT_ID],
      );
      return Number(row?.seconds);
    };
    expect(await ttl(true)).toBeGreaterThanOrEqual(24 * 3600 - 60);
    expect(await ttl(true)).toBeLessThanOrEqual(24 * 3600 + 60);
    expect(await ttl(false)).toBeGreaterThanOrEqual(30 * 24 * 3600 - 60);
    expect(await ttl(false)).toBeLessThanOrEqual(30 * 24 * 3600 + 60);

    await sql(
      `update oauth_refresh_tokens set expires_at = now() - interval '1 minute'
        where user_id = $1 and reference_id = 'mcp-admin'`,
      [sup.id],
    );
    const res = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: conn.tokens.refresh_token as string,
      client_id: CLIENT_ID,
      resource: MCP_ADMIN_URL,
    });
    expect(res.status).toBe(400);
  });

  it('"Desconectar" o conector da Plataforma corta o token na hora e não toca o conector de jogador', async () => {
    const sup = await userByEmail(USERS.superUser);
    const adminConn = await superConn();
    const playerConn = await userConn('semPapel', {}, USERS.superUser);
    await resetLimits();
    const apps = await api('/v1/me/connected-apps', (await appToken()).token);
    const adminApp = (apps.body.items as { id: string; resource: { kind: string } }[]).find(
      (item) => item.resource.kind === 'ADMIN',
    );
    expect(adminApp).toBeDefined();
    const del = await api(`/v1/me/connected-apps/${adminApp?.id}`, (await appToken()).token, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    const cut = await api('/v1/super/spaces?pageSize=1', adminConn.token);
    expect([cut.status, cut.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
    expect((await api('/v1/me/summary', playerConn.token)).status).toBe(200);
    expect(await consentExists(sup.id, 'mcp-admin')).toBe(false);
    expect(await consentExists(sup.id, null)).toBe(true);
  });
});

const appToken = () => appSession(USERS.superUser);

describe('(2) auditoria de leitura do Super (decisão 123): inclusive as recusadas', () => {
  it('rota de jogador, escrita e CSV com o token do Super: 403 OAUTH_ROUTE_NOT_ALLOWED, cada uma com a sua linha', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    await resetLimits();
    const since = new Date();
    const attempts: [string, string, number, string | null][] = [
      ['POST', '/v1/bookings', 403, 'OAUTH_ROUTE_NOT_ALLOWED'],
      ['GET', '/v1/me/summary', 403, 'OAUTH_ROUTE_NOT_ALLOWED'],
      ['GET', '/v1/super/finance/payments.csv', 403, 'OAUTH_ROUTE_NOT_ALLOWED'],
      [
        'POST',
        `/v1/super/spaces/${w.spaces.a.id}/support-sessions`,
        403,
        'OAUTH_ROUTE_NOT_ALLOWED',
      ],
      ['GET', '/v1/super/users/00000000-0000-4000-8000-000000000000', 404, null],
    ];
    for (const [method, path, status, code] of attempts) {
      const res = await api(path, conn.token, {
        method,
        ...(method === 'POST' ? { json: {} } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(status);
      if (code) expect(res.body?.error?.code, `${method} ${path}`).toBe(code);
    }
    const rows = await settled(() => adminAuditRows(sup.id, since), attempts.length);
    expect(rows).toHaveLength(attempts.length);
    attempts.forEach(([method, path, status, code], index) => {
      expect(rows[index]?.diff).toMatchObject({
        method,
        path,
        origin: 'MCP',
        oauthClientId: CLIENT_ID,
        result: { status, completed: true },
      });
      if (code) expect(rows[index]?.diff?.result?.code).toBe(code);
    });
  });

  it('limite de 60 leituras/min: as 429 também são auditadas, e o contador é o mesmo do conector de jogador', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    const player = await userConn('semPapel', {}, USERS.superUser);
    await resetLimits();
    const since = new Date();
    const statuses: number[] = [];
    for (let i = 0; i < 64; i++) {
      statuses.push((await api('/v1/super/spaces?pageSize=1', conn.token)).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(60);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    // Mesmo usuário, outro conector: o contador é um só (RN-MCP-03).
    const playerRes = await api('/v1/spaces', player.token);
    expect(playerRes.status).toBe(429);
    expect(playerRes.headers.get('retry-after')).toBeTruthy();
    const rows = await settled(() => adminAuditRows(sup.id, since), 64);
    expect(rows).toHaveLength(64);
    const limited = rows.filter((row) => row.diff?.result?.status === 429);
    expect(limited).toHaveLength(4);
    expect(limited.every((row) => row.diff?.result?.code === 'TOO_MANY_REQUESTS')).toBe(true);
    await resetLimits();
  });

  it('consulta longa: a query é gravada com no máximo 30 parâmetros de 500 caracteres, sem derrubar o pedido', async () => {
    const sup = await userByEmail(USERS.superUser);
    const conn = await superConn();
    await resetLimits();
    const since = new Date();
    const params = new URLSearchParams({ pageSize: '1', q: 'x'.repeat(600) });
    for (let i = 0; i < 40; i++) params.set(`extra${i}`, `v${i}`);
    const res = await api(`/v1/super/spaces?${params}`, conn.token);
    expect(res.status).toBeLessThan(500);
    const [row] = await settled(() => adminAuditRows(sup.id, since), 1);
    expect(row?.diff?.result?.status).toBe(res.status);
    const query = row?.diff?.query as Record<string, string>;
    expect(Object.keys(query).length).toBeLessThanOrEqual(30);
    for (const value of Object.values(query)) expect(String(value).length).toBeLessThanOrEqual(500);
  });

  it('o Super que deixou de ser Super: o mesmo token cai em 403 SUPER_REQUIRED (auditado) e a tool orienta', async () => {
    const temp = w.people.revisor;
    if (!temp) throw new Error('revisor ausente');
    await sql(`update users set platform_role = 'SUPER' where id = $1`, [temp.id]);
    try {
      const conn = await superConn(temp.email);
      await resetLimits();
      expect((await api('/v1/super/users?pageSize=1', conn.token)).status).toBe(200);
      await sql(`update users set platform_role = 'USER' where id = $1`, [temp.id]);
      const since = new Date();
      const denied = await api('/v1/super/users?pageSize=1', conn.token);
      expect([denied.status, denied.body?.error?.code]).toEqual([403, 'SUPER_REQUIRED']);
      await withClient(conn, async (client) => {
        const res = await safeCall(client, 'list_users', { pageSize: 1 });
        expect(res.isError).toBe(true);
        expect(JSON.stringify(res.data)).not.toMatch(/"rows"/);
        if (res.code) expect(res.code).toBe('SUPER_REQUIRED');
      });
      const rows = await settled(() => adminAuditRows(temp.id, since), 2);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((row) => row.diff?.result?.code === 'SUPER_REQUIRED')).toBe(true);
      // E não dá para conectar de novo: sem o papel, a tela nega.
      const attempt = await consentAttempt(temp.email, {
        resource: MCP_ADMIN_URL,
        scope: 'super:read',
      });
      expect(attempt.consentRequest?.canAuthorize).toBe(false);
    } finally {
      await sql(`update users set platform_role = 'USER' where id = $1`, [temp.id]);
    }
  });

  it('Super bloqueado depois de conectar: 401 USER_BLOCKED (o assistente para) e a recusa fica auditada', async () => {
    const temp = w.people.revisor;
    if (!temp) throw new Error('revisor ausente');
    await sql(`update users set platform_role = 'SUPER' where id = $1`, [temp.id]);
    try {
      const conn = await superConn(temp.email);
      await resetLimits();
      expect((await api('/v1/super/users?pageSize=1', conn.token)).status).toBe(200);
      await sql(`update users set status = 'BLOCKED' where id = $1`, [temp.id]);
      const since = new Date();
      const res = await api('/v1/super/users?pageSize=1', conn.token);
      expect([res.status, res.body?.error?.code]).toEqual([401, 'USER_BLOCKED']);
      await withClient(conn, async (client) => {
        const tool = await safeCall(client, 'list_users', { pageSize: 1 });
        expect(tool.isError).toBe(true);
        expect(JSON.stringify(tool.data)).not.toMatch(/"rows"/);
      });
      const rows = await settled(() => adminAuditRows(temp.id, since), 1);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((row) => row.diff?.result?.status === 401)).toBe(true);
      // Nem a renovação funciona para a conta bloqueada.
      const refresh = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: conn.tokens.refresh_token as string,
        client_id: CLIENT_ID,
        resource: MCP_ADMIN_URL,
      });
      expect(refresh.status).toBe(400);
    } finally {
      await sql(`update users set platform_role = 'USER', status = 'ACTIVE' where id = $1`, [
        temp.id,
      ]);
    }
  });

  it('o token e o corpo da resposta nunca entram na auditoria (varredura em todas as linhas do Super)', async () => {
    const conn = await superConn();
    await resetLimits();
    await api('/v1/super/spaces?pageSize=2', conn.token);
    // `query` é o que o Super pediu (inclusive um termo de busca com e-mail): fica de fora das checagens de nome.
    const rows = await sql<{ text: string; query: string }>(
      `select (diff - 'query')::text as text, (diff -> 'query')::text as query
         from audit_logs where action = 'mcp.admin_request'`,
    );
    expect(rows.length).toBeGreaterThan(10);
    const jti = decodeJwt(conn.token).payload.jti as string;
    for (const row of rows) {
      const whole = `${row.text}${row.query}`;
      expect(whole).not.toContain(conn.token.slice(0, 40));
      expect(whole).not.toContain(jti);
      expect(whole).not.toMatch(/Bearer\s|"authorization"\s*:|eyJ[A-Za-z0-9_-]{10,}\./i);
      expect(row.text).not.toMatch(/Quadra Fase Dois|Dona Fase Dois|@exemplo\.com/);
    }
  });

  it('falha fechada: se a auditoria não grava, a API recusa o token (401) e nada é devolvido', async () => {
    const conn = await superConn();
    await resetLimits();
    await sql(`
      create or replace function qa_block_admin_audit() returns trigger language plpgsql as $$
      begin raise exception 'auditoria indisponível (teste de falha fechada)'; end $$`);
    await sql(`
      create trigger qa_block_admin_audit before insert on audit_logs
      for each row when (new.action = 'mcp.admin_request') execute function qa_block_admin_audit()`);
    try {
      const res = await api('/v1/super/spaces?pageSize=1', conn.token);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/"items"|"total"/);
      await withClient(conn, async (client) => {
        const tool = await safeCall(client, 'list_spaces', { pageSize: 1 });
        expect(tool.isError).toBe(true);
        expect(JSON.stringify(tool.data)).not.toMatch(/"rows"/);
      });
    } finally {
      await sql('drop trigger if exists qa_block_admin_audit on audit_logs');
      await sql('drop function if exists qa_block_admin_audit()');
    }
    await resetLimits();
    expect((await api('/v1/super/spaces?pageSize=1', conn.token)).status).toBe(200);
  });

  it('a gestão pelo conector de jogador NÃO é auditada em leitura (só o Super; escritas do jogador seguem em mcp.request)', async () => {
    const dona = await userByEmail(w.people.dona?.email as string);
    const conn = await userConn('dona');
    await resetLimits();
    const since = new Date();
    await withClient(conn, async (client) => {
      await ok(client, 'get_booking_metrics', { space: w.spaces.a.slug });
    });
    const rows = await sql(
      `select id from audit_logs where actor_id = $1 and created_at >= $2
          and action in ('mcp.request', 'mcp.admin_request')`,
      [dona.id, since.toISOString()],
    );
    expect(rows).toEqual([]);
  });

  it('sem token no /admin/mcp: 401 sem auditoria de ninguém', async () => {
    const before = await sql<{ n: string }>(
      `select count(*) as n from audit_logs where action = 'mcp.admin_request'`,
    );
    expect((await rawMcp({}, undefined, MCP_ADMIN_URL)).status).toBe(401);
    expect((await rawMcp({ authorization: 'Bearer lixo' }, undefined, MCP_ADMIN_URL)).status).toBe(
      401,
    );
    expect((await rawMcp({}, undefined, MCP_URL)).status).toBe(401);
    const after = await sql<{ n: string }>(
      `select count(*) as n from audit_logs where action = 'mcp.admin_request'`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('(2) BUG-MCP2-1 (corrigido na MCP2.9): "desconectar e conectar de novo" corta o token emitido no mesmo segundo', () => {
  // Antes, a API comparava `claims.iat < Math.floor(consentCreatedAt / 1000)`, em segundos inteiros: um
  // token emitido no mesmo segundo em que o consentimento NOVO era criado continuava valendo, contra RN-MCP-01
  // ("reconectar não ressuscita os tokens da conexão anterior", docs/14-mcp.md 3.3). Agora o token leva o id
  // do consentimento em que foi emitido (claim `consent_id`), conferido contra o atual. O teste alinha a
  // reconexão ao começo de um segundo, para cobrir o caso de forma determinística.
  it('o token da conexão desfeita é recusado mesmo se o consentimento novo cai no mesmo segundo', async () => {
    const app = await appSession(USERS.superUser);
    for (let attempt = 0; attempt < 8; attempt++) {
      // Começa no início de um segundo: as duas conexões (~150 ms cada) cabem nele.
      const wait = 1000 - (Date.now() % 1000);
      if (wait < 900) await new Promise((done) => setTimeout(done, wait + 5));
      const old = await userConn('semPapel', {}, USERS.superUser);
      const apps = await api('/v1/me/connected-apps', app.token);
      for (const item of apps.body.items as { id: string; resource: { kind: string } }[]) {
        if (item.resource.kind === 'USER') {
          await api(`/v1/me/connected-apps/${item.id}`, app.token, { method: 'DELETE' });
        }
      }
      const fresh = await userConn('semPapel', {}, USERS.superUser);
      const sup = await userByEmail(USERS.superUser);
      const [consent] = await sql<{ second: string }>(
        `select floor(extract(epoch from created_at))::text as second from oauth_consents
          where user_id = $1 and client_id = $2 and (reference_id is null or reference_id = '')`,
        [sup.id, CLIENT_ID],
      );
      const issuedAt = decodeJwt(old.token).payload.iat as number;
      if (Number(consent?.second) !== issuedAt) continue; // não coincidiu no mesmo segundo: tenta de novo
      await resetLimits();
      const res = await api('/v1/me/summary', old.token);
      expect([res.status, res.body?.error?.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
      // O token da conexão nova, emitido no mesmo segundo do consentimento, vale.
      expect((await api('/v1/me/summary', fresh.token)).status).toBe(200);
      return;
    }
    throw new Error('Não foi possível alinhar a reconexão ao mesmo segundo (máquina lenta).');
  });
});

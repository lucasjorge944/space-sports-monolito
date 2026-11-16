import { describe, expect, it } from 'vitest';
import { sql } from './support/db.js';
import { CIMD_ORIGIN } from './support/env.js';
import { freshPlayerToken, signUpUser } from './support/helpers.js';
import { call, mcpClient, ok, rawMcp } from './support/mcp.js';
import { api, appSession, connect, decodeJwt, refreshTokens } from './support/oauth.js';

/** Id da conexão (Apps conectados) do cliente, pela sessão do app. */
async function connectedAppId(email: string, clientId: string) {
  const { token } = await appSession(email);
  const list = await api('/v1/me/connected-apps', token);
  const found = (list.body.items as { id: string; clientId: string }[]).find(
    (app) => app.clientId === clientId,
  );
  return { token, id: found?.id, items: list.body.items as { id: string; clientId: string }[] };
}

describe('(2) segurança — "Desconectar" corta tudo na hora (RN-MCP-04, decisão 116)', () => {
  it('o access token em uso, o refresh e as tools param de valer; reconectar não ressuscita os tokens antigos', async () => {
    const user = await signUpUser('desc');
    const first = await connect(user.email);
    const client = await mcpClient(first.tokens.access_token);
    expect((await ok(client, 'get_my_profile')).firstName).toBe('Qa');

    const { token: appToken, id } = await connectedAppId(user.email, first.clientId);
    expect(id).toBeDefined();
    const del = await api(`/v1/me/connected-apps/${id}`, appToken, { method: 'DELETE' });
    expect(del.status).toBe(204);
    // Idempotente.
    expect((await api(`/v1/me/connected-apps/${id}`, appToken, { method: 'DELETE' })).status).toBe(
      204,
    );

    // Na hora (sem esperar os 15 min do token): API, servidor MCP e uma conexão nova do SDK.
    const direct = await api('/v1/me/summary', first.tokens.access_token);
    expect([direct.status, direct.body.error.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
    const tool = await call(client, 'get_my_profile').catch((error: unknown) => ({
      isError: true,
      text: String(error),
      code: undefined as string | undefined,
    }));
    expect(tool.isError).toBe(true);
    expect(tool.text).toMatch(/reconect|conect|401|autoriza|token/i);
    await expect(
      mcpClient(first.tokens.access_token).then((c) => ok(c, 'get_my_profile')),
    ).rejects.toThrow();

    // O refresh token também morreu.
    const refreshed = await refreshTokens(first.tokens.refresh_token as string);
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe('invalid_grant');
    const items = (await api('/v1/me/connected-apps', appToken)).body.items;
    expect(items).toEqual([]);

    // Reconecta (novo consentimento): o token NOVO vale; o ANTIGO continua morto (é de outra conexão).
    const second = await connect(user.email);
    expect(second.consentRequest, 'reconectar precisa pedir consentimento de novo').toBeDefined();
    expect(second.tokens.access_token).not.toBe(first.tokens.access_token);
    const fresh = await mcpClient(second.tokens.access_token);
    try {
      expect((await ok(fresh, 'get_my_profile')).firstName).toBe('Qa');
    } finally {
      await fresh.close();
    }
    const old = await api('/v1/me/summary', first.tokens.access_token);
    expect([old.status, old.body.error.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
    expect((await refreshTokens(first.tokens.refresh_token as string)).status).toBe(400);
  });

  it('desconectar um cliente não derruba o outro cliente do mesmo usuário', async () => {
    const user = await signUpUser('desc2');
    const one = await connect(user.email);
    const otherClient = `${CIMD_ORIGIN}/segundo-cliente.json`;
    const two = await connect(user.email, { clientId: otherClient, loggedIn: false });
    const { token, id } = await connectedAppId(user.email, one.clientId);
    expect((await api(`/v1/me/connected-apps/${id}`, token, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await api('/v1/me/summary', one.tokens.access_token)).status).toBe(401);
    expect((await api('/v1/me/summary', two.tokens.access_token)).status).toBe(200);
    expect(decodeJwt(two.tokens.access_token).payload.azp).toBe(otherClient);
  });

  it('A não consegue desconectar o app de B (id válido de outra conta): B segue conectado', async () => {
    const a = await signUpUser('desc-a');
    const b = await signUpUser('desc-b');
    const bConn = await connect(b.email);
    const { id } = await connectedAppId(b.email, bConn.clientId);
    const { token: aToken } = await appSession(a.email);
    const res = await api(`/v1/me/connected-apps/${id}`, aToken, { method: 'DELETE' });
    expect([204, 403, 404]).toContain(res.status);
    expect((await api('/v1/me/summary', bConn.tokens.access_token)).status).toBe(200);
    expect((await connectedAppId(b.email, bConn.clientId)).id).toBe(id);
    // E a listagem de A não mostra o app de B.
    expect((await api('/v1/me/connected-apps', aToken)).body.items).toEqual([]);
  });

  it('"Apps conectados" lista nome, domínio, escopos e datas; e o último uso é gravado', async () => {
    const user = await signUpUser('desc3');
    const conn = await connect(user.email);
    const client = await mcpClient(conn.tokens.access_token);
    try {
      await ok(client, 'get_my_profile');
    } finally {
      await client.close();
    }
    const { token } = await appSession(user.email);
    const [app] = (await api('/v1/me/connected-apps', token)).body.items;
    expect(app).toMatchObject({ clientId: conn.clientId, host: 'cimd.e2e.test' });
    expect(app.scopes).toEqual(
      expect.arrayContaining(['spaces:read', 'bookings:write', 'classes:write']),
    );
    expect(app.authorizedAt).toBeTruthy();
    expect(app.lastUsedAt).toBeTruthy();
  });
});

describe('(2) segurança — conta bloqueada, inativa ou excluída no meio da conexão (RN-MCP-01)', () => {
  const setStatus = (id: string, status: string) =>
    sql('update users set status = $1 where id = $2', [status, id]);

  it('bloqueado: 401 USER_BLOCKED na API e erro nas tools; refresh recusado; ao desbloquear volta ao normal', async () => {
    const user = await signUpUser('block');
    const conn = await connect(user.email);
    const client = await mcpClient(conn.tokens.access_token);
    try {
      expect((await ok(client, 'get_my_profile')).firstName).toBe('Qa');
      await setStatus(user.id, 'BLOCKED');

      const direct = await api('/v1/me/summary', conn.tokens.access_token);
      expect([direct.status, direct.body.error.code]).toEqual([401, 'USER_BLOCKED']);
      const writes = await api('/v1/bookings', conn.tokens.access_token, {
        method: 'POST',
        json: {},
        headers: { 'Idempotency-Key': 'qa-bloqueado' },
      });
      expect([writes.status, writes.body.error.code]).toEqual([401, 'USER_BLOCKED']);

      const tool = await call(client, 'search_spaces', { text: 'arena' }).catch(
        (error: unknown) => ({ isError: true, text: String(error) }),
      );
      expect(tool.isError).toBe(true);

      const refreshed = await refreshTokens(conn.tokens.refresh_token as string);
      expect(refreshed.status).toBe(400);
      expect(refreshed.body.error).toBe('invalid_grant');

      // Um token NOVO também não sai: o fluxo do bloqueado não emite código.
      await expect(
        connect(user.email, { clientId: `${CIMD_ORIGIN}/novo-bloqueado.json` }),
      ).rejects.toThrow();
    } finally {
      await setStatus(user.id, 'ACTIVE');
      await client.close();
    }
    // Desbloqueado, o mesmo access token (ainda dentro dos 15 min) volta a valer.
    expect((await api('/v1/me/summary', conn.tokens.access_token)).status).toBe(200);
  });

  it('inativado pelo titular: 401 ACCOUNT_INACTIVE e refresh recusado', async () => {
    const user = await signUpUser('inativo');
    const conn = await connect(user.email);
    await setStatus(user.id, 'INACTIVE');
    try {
      const direct = await api('/v1/me/summary', conn.tokens.access_token);
      expect([direct.status, direct.body.error.code]).toEqual([401, 'ACCOUNT_INACTIVE']);
      expect((await refreshTokens(conn.tokens.refresh_token as string)).status).toBe(400);
    } finally {
      await setStatus(user.id, 'ACTIVE');
    }
  });

  it('excluído (deleted_at): 401 OAUTH_TOKEN_INVALID e refresh recusado', async () => {
    const user = await signUpUser('excluido');
    const conn = await connect(user.email);
    await sql('update users set deleted_at = now() where id = $1', [user.id]);
    try {
      const direct = await api('/v1/me/summary', conn.tokens.access_token);
      expect([direct.status, direct.body.error.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
      expect((await refreshTokens(conn.tokens.refresh_token as string)).status).toBe(400);
      expect(
        (await rawMcp({ authorization: `Bearer ${conn.tokens.access_token}` })).status,
      ).toBeLessThan(500);
    } finally {
      await sql('update users set deleted_at = null where id = $1', [user.id]);
    }
  });

  it('cliente desativado no servidor de autorização: o token dele para de valer', async () => {
    const user = await freshPlayerToken('cli-off');
    const clientId = user.connected.clientId;
    const rows = await sql('select 1 from oauth_clients where client_id = $1', [clientId]);
    expect(rows.length).toBe(1);
    await sql('update oauth_clients set disabled = true where client_id = $1', [clientId]);
    try {
      const direct = await api('/v1/me/summary', user.token);
      expect([direct.status, direct.body.error.code]).toEqual([401, 'OAUTH_TOKEN_INVALID']);
    } finally {
      await sql('update oauth_clients set disabled = false where client_id = $1', [clientId]);
    }
  });
});

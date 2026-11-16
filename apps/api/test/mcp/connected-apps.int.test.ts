import { MCP_OAUTH_SCOPES } from '@space-sports/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, oauthConsents } from '../../src/db/schema/index.js';
import { type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearerOf,
  CLIENT_ID,
  CLIENT_NAME,
  connect,
  createMcpTestApp,
  decodeJwt,
  refresh,
} from './helpers.js';

// Decisão 116, RF-MCP-05 e RN-MCP-04: "Apps conectados" (listar e desconectar).

describe('apps conectados', () => {
  let t: TestApp;
  let ana: SignedUp;
  let bob: SignedUp;

  beforeAll(async () => {
    t = await createMcpTestApp();
    ana = await signUp(t, 'ana.apps@exemplo.com', 'Ana');
    bob = await signUp(t, 'bob.apps@exemplo.com', 'Bob');
  });
  afterAll(() => t?.close());

  const list = (user: SignedUp) => t.http().get('/v1/me/connected-apps').set('cookie', user.cookie);

  it('lista o cliente autorizado com escopos, data da autorização e último uso', async () => {
    expect((await list(ana)).body).toEqual({ items: [] });
    const token = await connect(t, ana);
    const res = await list(ana);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: expect.any(String),
        clientId: CLIENT_ID,
        name: CLIENT_NAME,
        host: 'claude.example.com',
        uri: 'https://claude.example.com',
        logoUrl: 'https://claude.example.com/logo.png',
        resource: { kind: 'USER', name: 'Space Sports' },
        scopes: [...MCP_OAUTH_SCOPES],
        authorizedAt: expect.any(String),
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    // O uso pelo assistente aparece em "Último uso".
    await t
      .http()
      .get('/v1/bookings')
      .set(...bearerOf(token.access_token));
    const deadline = Date.now() + 2_000;
    let lastUsedAt: string | null = null;
    while (!lastUsedAt && Date.now() < deadline) {
      lastUsedAt = (await list(ana)).body.items[0]?.lastUsedAt ?? null;
    }
    expect(lastUsedAt).toEqual(expect.any(String));
    // Cada um vê só os seus.
    expect((await list(bob)).body.items).toEqual([]);
  });

  it('o token do MCP não lista nem desconecta apps', async () => {
    const token = await connect(t, bob);
    const auth = bearerOf(token.access_token);
    const listed = await t
      .http()
      .get('/v1/me/connected-apps')
      .set(...auth);
    expect(listed.status).toBe(403);
    expect(listed.body.error.code).toBe('OAUTH_ROUTE_NOT_ALLOWED');
    const [app] = (await list(bob)).body.items;
    const removed = await t
      .http()
      .delete(`/v1/me/connected-apps/${app.id}`)
      .set(...auth);
    expect(removed.status).toBe(403);
    expect((await list(bob)).body.items).toHaveLength(1);
  });

  it('desconectar revoga o refresh e o consentimento; o token em uso para na hora; idempotente', async () => {
    const carla = await signUp(t, 'carla.apps@exemplo.com', 'Carla');
    const token = await connect(t, carla);
    const [app] = (await list(carla)).body.items;

    // Conexão de outra pessoa: 204 sem efeito.
    expect(
      (await t.http().delete(`/v1/me/connected-apps/${app.id}`).set('cookie', ana.cookie)).status,
    ).toBe(204);
    expect((await list(carla)).body.items).toHaveLength(1);

    const removed = await t
      .http()
      .delete(`/v1/me/connected-apps/${app.id}`)
      .set('cookie', carla.cookie);
    expect(removed.status).toBe(204);
    expect((await list(carla)).body.items).toEqual([]);
    const consents = await t.db
      .select()
      .from(oauthConsents)
      .where(and(eq(oauthConsents.userId, carla.id), eq(oauthConsents.clientId, CLIENT_ID)));
    expect(consents).toEqual([]);

    const refreshed = await refresh(t, token.refresh_token as string);
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe('invalid_grant');

    const used = await t
      .http()
      .get('/v1/bookings')
      .set(...bearerOf(token.access_token));
    expect(used.status).toBe(401);
    expect(used.body.error.code).toBe('OAUTH_TOKEN_INVALID');

    // De novo: 204, nada muda.
    expect(
      (await t.http().delete(`/v1/me/connected-apps/${app.id}`).set('cookie', carla.cookie)).status,
    ).toBe(204);
    const logs = await t.db
      .select({ diff: auditLogs.diff })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, carla.id), eq(auditLogs.action, 'oauth_consent.revoke')));
    expect(logs).toEqual([{ diff: { oauthClientId: CLIENT_ID, resource: 'USER' } }]);

    // Conectar de novo passa pelo consentimento e funciona, mas não ressuscita o token de acesso
    // da conexão anterior, mesmo no mesmo segundo (BUG-MCP2-1): cada token leva o id do
    // consentimento em que foi emitido, e o novo consentimento tem outro id.
    const again = await connect(t, carla);
    const oldConsent = decodeJwt(token.access_token).payload.consent_id;
    const newConsent = decodeJwt(again.access_token).payload.consent_id;
    expect(oldConsent).toEqual(expect.any(String));
    expect(newConsent).toEqual(expect.any(String));
    expect(newConsent).not.toBe(oldConsent);
    const old = await t
      .http()
      .get('/v1/bookings')
      .set(...bearerOf(token.access_token));
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('OAUTH_TOKEN_INVALID');
    expect(
      (
        await t
          .http()
          .get('/v1/bookings')
          .set(...bearerOf(again.access_token))
      ).status,
    ).toBe(200);
  });

  it('id malformado: 400', async () => {
    const res = await t.http().delete('/v1/me/connected-apps/nao-e-uuid').set('cookie', ana.cookie);
    expect(res.status).toBe(400);
  });
});

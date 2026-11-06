import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, NIL_UUID, seedCatalog, superUser } from './fixtures.js';

// RN-AUTH-02: todo o /v1/super é exclusivo do papel SUPER.

const ID = NIL_UUID;
const ROUTES: [method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string][] = [
  ['get', '/v1/super/spaces'],
  ['post', '/v1/super/spaces'],
  ['get', `/v1/super/spaces/${ID}`],
  ['patch', `/v1/super/spaces/${ID}`],
  ['post', `/v1/super/spaces/${ID}/suspend`],
  ['post', `/v1/super/spaces/${ID}/reactivate`],
  ['post', `/v1/super/spaces/${ID}/close`],
  ['post', `/v1/super/spaces/${ID}/owner-invites`],
  ['put', `/v1/super/spaces/${ID}/amenities`],
  ['put', `/v1/super/spaces/${ID}/opening-hours`],
  ['get', `/v1/super/spaces/${ID}/settings`],
  ['patch', `/v1/super/spaces/${ID}/settings`],
  ['post', `/v1/super/spaces/${ID}/support-sessions`],
  ['get', '/v1/super/support-sessions'],
  ['get', `/v1/super/support-sessions/${ID}`],
  ['post', `/v1/super/support-sessions/${ID}/end`],
  ['get', '/v1/super/finance/summary'],
  ['get', '/v1/super/finance/payments.csv'],
  ['get', '/v1/super/catalog/sports'],
  ['post', '/v1/super/catalog/sports'],
  ['patch', `/v1/super/catalog/sports/${ID}`],
  ['delete', `/v1/super/catalog/sports/${ID}`],
  ['get', '/v1/super/catalog/amenities'],
  ['post', '/v1/super/catalog/amenities'],
  ['get', '/v1/super/catalog/cities'],
  ['post', '/v1/super/catalog/cities'],
  ['get', '/v1/super/catalog/levels'],
  ['get', '/v1/super/users'],
  ['get', `/v1/super/users/${ID}`],
  ['post', `/v1/super/users/${ID}/block`],
  ['post', `/v1/super/users/${ID}/unblock`],
  ['post', `/v1/super/users/${ID}/deletion-requests`],
  ['get', '/v1/super/deletion-requests'],
  ['post', `/v1/super/deletion-requests/${ID}/fulfill`],
  ['post', `/v1/super/deletion-requests/${ID}/reject`],
  ['get', '/v1/super/admins'],
  ['post', '/v1/super/admins'],
  ['delete', `/v1/super/admins/${ID}`],
  ['get', '/v1/super/metrics/spaces'],
  ['get', '/v1/super/audit-logs'],
  // Anúncios (RN-ADS-02).
  ['get', '/v1/super/ads/advertisers'],
  ['post', '/v1/super/ads/advertisers'],
  ['get', `/v1/super/ads/advertisers/${ID}`],
  ['patch', `/v1/super/ads/advertisers/${ID}`],
  ['get', '/v1/super/ads/campaigns'],
  ['post', '/v1/super/ads/campaigns'],
  ['get', `/v1/super/ads/campaigns/${ID}`],
  ['patch', `/v1/super/ads/campaigns/${ID}`],
  ['post', `/v1/super/ads/campaigns/${ID}/status`],
  ['post', `/v1/super/ads/campaigns/${ID}/duplicate`],
  ['post', '/v1/super/ads/creatives/uploads'],
  ['post', `/v1/super/ads/campaigns/${ID}/creatives`],
  ['patch', `/v1/super/ads/campaigns/${ID}/creatives/${ID}`],
  ['put', `/v1/super/ads/campaigns/${ID}/creatives/order`],
  ['get', `/v1/super/ads/campaigns/${ID}/report`],
  ['get', `/v1/super/ads/campaigns/${ID}/report.csv`],
];

describe('painel Super: acesso só para SUPER (RN-AUTH-02)', () => {
  let t: TestApp;
  let player: SignedUp;
  let owner: SignedUp;
  let admin: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    const catalog = await seedCatalog(t.db);
    const space = await createSpace(t.db, catalog);
    player = await signUp(t, 'jogador@exemplo.com');
    owner = await member(t, 'dono@exemplo.com', space.id, 'OWNER');
    admin = await superUser(t, 'super@exemplo.com');
  });
  afterAll(() => t.close());

  it.each(ROUTES)('%s %s: sem login → 401', async (method, path) => {
    const res = await t.http()[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(ROUTES)('%s %s: jogador e Dono de espaço → 403 SUPER_REQUIRED', async (method, path) => {
    for (const user of [player, owner]) {
      const res = await t
        .http()
        [method](path)
        .set(...bearer(user))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SUPER_REQUIRED');
    }
  });

  it('o Super passa pelo guard (a rota responde, não 401/403)', async () => {
    const res = await t
      .http()
      .get('/v1/super/spaces')
      .set(...bearer(admin));
    expect(res.status).toBe(200);
  });
});

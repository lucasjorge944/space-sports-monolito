import { utcToZoned } from '@space-sports/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advertiser, campaign, superAds } from '../ads/fixtures.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space } from '../bookings/fixtures.js';
import { teacherMemberId } from '../classes/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { insertGroup, openEightToMidnight, TZ } from './fixtures.js';

// BUG-MCP2-2 e a revisão da MCP2.9: todo `from`/`to` de query com data (e o `date` da
// disponibilidade e o `month` do relatório mensal) vai de 2000-01-01 a 2100-12-31. Fora disso, 400
// VALIDATION_ERROR, nunca 500 (`addDays` não passa de 9999-12-31) nem calendário errado.

describe('filtros de período: datas de 2000-01-01 a 2100-12-31', () => {
  let t: TestApp;
  let arena: Space;
  let owner: SignedUp;
  let player: SignedUp;
  let root: SignedUp;
  let groupId: string;
  let campaignId: string;
  const today = utcToZoned(new Date(), TZ).date;

  beforeAll(async () => {
    t = await createTestApp();
    arena = await createSpace(t.db, 'arena-periodos');
    await openEightToMidnight(t.db, arena.id);
    owner = await member(t, 'dono@periodos.com', arena.id, 'OWNER');
    const teacher = await member(t, 'prof@periodos.com', arena.id, 'TEACHER');
    player = await signUp(t, 'ana@periodos.com', 'Ana Jogadora', '+5531911110001');
    root = await superUser(t, 'super@periodos.com');
    const group = await insertGroup(t.db, arena, {
      name: 'Turma',
      courtId: arena.courtA,
      teacherMemberIds: [await teacherMemberId(t.db, teacher.id, arena.id)],
    });
    groupId = group.id;
    const ads = superAds(t, root);
    campaignId = (await campaign(ads, (await advertiser(ads)).id)).id;
  });
  afterAll(() => t?.close());

  const get = (user: SignedUp, path: string) =>
    t
      .http()
      .get(path)
      .set(...bearer(user));

  /** [quem, rota com o período fora da faixa, a mesma rota dentro dela (controle: 200)] */
  const cases = (): [string, () => SignedUp, string, string][] => [
    [
      'aulas da gestão (class-sessions.service.ts:408)',
      () => owner,
      `/v1/manage/spaces/${arena.id}/class-sessions?from=9999-12-25&to=9999-12-31`,
      `/v1/manage/spaces/${arena.id}/class-sessions?from=2100-12-25&to=2100-12-31`,
    ],
    [
      'presenças (attendance-reports.service.ts:175)',
      () => owner,
      `/v1/manage/spaces/${arena.id}/class-attendances?classGroupId=${groupId}&from=9999-06-01&to=9999-06-05`,
      `/v1/manage/spaces/${arena.id}/class-attendances?classGroupId=${groupId}&from=2000-01-01&to=2000-01-05`,
    ],
    [
      'frequência da turma',
      () => owner,
      `/v1/manage/spaces/${arena.id}/class-groups/${groupId}/frequency?from=0000-01-01&to=0000-01-05`,
      `/v1/manage/spaces/${arena.id}/class-groups/${groupId}/frequency?from=2000-01-01&to=2000-01-05`,
    ],
    [
      'minhas aulas',
      () => player,
      '/v1/me/class-sessions?from=9999-12-25&to=9999-12-31',
      '/v1/me/class-sessions?from=2100-12-25&to=2100-12-31',
    ],
    [
      'disponibilidade (`date`)',
      () => player,
      `/v1/spaces/${arena.id}/availability?date=9999-12-31&durationMin=60&sportId=${arena.sportId}`,
      `/v1/spaces/${arena.id}/availability?date=${today}&durationMin=60&sportId=${arena.sportId}`,
    ],
    [
      'métricas (analytics)',
      () => owner,
      `/v1/manage/spaces/${arena.id}/analytics/bookings?from=1999-12-31&to=2000-01-05`,
      `/v1/manage/spaces/${arena.id}/analytics/bookings?from=2000-01-01&to=2000-01-05`,
    ],
    [
      'financeiro do Super',
      () => root,
      '/v1/super/finance/summary?from=9999-12-25&to=9999-12-31',
      '/v1/super/finance/summary?from=2000-01-01&to=2000-01-31',
    ],
    [
      'métricas de uso por espaço do Super',
      () => root,
      '/v1/super/metrics/spaces?from=0001-01-01&to=0001-01-05',
      '/v1/super/metrics/spaces?from=2000-01-01&to=2000-01-05',
    ],
    [
      'auditoria do Super',
      () => root,
      '/v1/super/audit-logs?from=1999-12-31',
      '/v1/super/audit-logs?from=2000-01-01',
    ],
    [
      'receita da plataforma',
      () => root,
      '/v1/super/online-payments/revenue?from=2101-01-01&to=2101-01-05',
      '/v1/super/online-payments/revenue?from=2100-12-25&to=2100-12-31',
    ],
    [
      'relatório mensal de taxas (`month`)',
      () => root,
      '/v1/super/online-payments/reports/monthly?month=9999-12',
      `/v1/super/online-payments/reports/monthly?month=${today.slice(0, 7)}`,
    ],
    [
      'relatório de anúncio',
      () => root,
      `/v1/super/ads/campaigns/${campaignId}/report?from=9999-12-25&to=9999-12-31`,
      `/v1/super/ads/campaigns/${campaignId}/report?from=2000-01-01&to=2000-01-05`,
    ],
  ];

  it('fora da faixa: 400 VALIDATION_ERROR em toda rota com período; dentro dela, 200', async () => {
    for (const [label, user, bad, good] of cases()) {
      const refused = await get(user(), bad);
      expect([refused.status, refused.body?.error?.code], label).toEqual([400, 'VALIDATION_ERROR']);
      expect((await get(user(), good)).status, label).toBe(200);
    }
  });

  it('os extremos da faixa valem; um dia antes e um depois, não (aulas da gestão)', async () => {
    const path = `/v1/manage/spaces/${arena.id}/class-sessions`;
    expect((await get(owner, `${path}?from=2000-01-01&to=2000-01-07`)).status).toBe(200);
    expect((await get(owner, `${path}?from=2100-12-25&to=2100-12-31`)).status).toBe(200);
    expect((await get(owner, `${path}?from=1999-12-31&to=2000-01-07`)).status).toBe(400);
    expect((await get(owner, `${path}?from=2100-12-25&to=2101-01-01`)).status).toBe(400);
  });
});

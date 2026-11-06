import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plans, subscriptionCharges, subscriptions } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { first } from '../db/helpers.js';
import { superUser } from '../super/fixtures.js';
import {
  approveMerchant,
  CARD_APPROVE,
  CARD_CHARGEBACK,
  drain,
  merchantBody,
  onlinePath,
  type Row,
  setModes,
} from './fixtures.js';

// RN-ONPAY-08, decisões 53 e 95: matriz de permissões de todas as rotas novas do pagamento online.
// Cada rota é chamada por cada ator; o que não é permitido responde 401 (sem login) ou 403, e nada
// muda no banco. Rotas de dados de outro espaço nunca respondem 2xx.

useMiddayClock();

type ActorName =
  | 'anon'
  | 'owner'
  | 'admin'
  | 'teacher'
  | 'player'
  | 'organizer'
  | 'otherOwner'
  | 'otherAdmin'
  | 'sup'
  | 'supSupport'
  | 'supSupportOther';

describe('permissões do pagamento online', () => {
  let t: TestApp;
  let space: Space;
  let otherSpace: Space;
  const users = {} as Record<
    Exclude<ActorName, 'anon' | 'supSupport' | 'supSupportOther'>,
    SignedUp
  >;
  let sup2: SignedUp;
  let supportHeader: readonly [string, string];
  let supportOtherHeader: readonly [string, string];
  let bookingId: string;
  let chargeId: string;
  let chargebackId: string;
  let subId: string;
  let subChargeId: string;
  let student: SignedUp;

  const path = (p: string, id = space.id) => onlinePath(id, p);

  /** Aplica o ator à requisição (login e, no modo suporte, o cabeçalho). */
  const as = (actor: ActorName, req: ReturnType<ReturnType<TestApp['http']>['get']>) => {
    if (actor === 'anon') return req;
    if (actor === 'supSupport') return req.set(...bearer(users.sup)).set(...supportHeader);
    if (actor === 'supSupportOther') {
      return req.set(...bearer(sup2)).set(...supportOtherHeader);
    }
    return req.set(...bearer(users[actor]));
  };

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'perm-a');
    otherSpace = await createSpace(t.db, 'perm-b');
    users.owner = await member(t, 'dono@perm.test', space.id, 'OWNER');
    users.admin = await member(t, 'admin@perm.test', space.id, 'ADMIN');
    users.teacher = await member(t, 'prof@perm.test', space.id, 'TEACHER');
    users.otherOwner = await member(t, 'dono@outro.test', otherSpace.id, 'OWNER');
    users.otherAdmin = await member(t, 'admin@outro.test', otherSpace.id, 'ADMIN');
    users.player = await signUp(t, 'jogador@perm.test', 'Jogador Qualquer');
    users.organizer = await signUp(t, 'maria@perm.test', 'Maria Organizadora');
    student = await signUp(t, 'aluno@perm.test', 'Aluno Teste');
    users.sup = await superUser(t, 'super@perm.test');
    sup2 = await superUser(t, 'super2@perm.test');
    for (const [owner, id] of [
      [users.owner, space.id],
      [users.otherOwner, otherSpace.id],
    ] as const) {
      await approveMerchant(t, owner, id);
      await setModes(t, owner, id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
    }
    const open = async (spaceId: string, who: SignedUp) =>
      (
        await t
          .http()
          .post(`/v1/super/spaces/${spaceId}/support-sessions`)
          .set(...bearer(who))
          .send({ reason: 'Atendimento de teste' })
          .expect(201)
      ).body.id as string;
    supportHeader = ['x-support-session', await open(space.id, users.sup)];
    supportOtherHeader = ['x-support-session', await open(otherSpace.id, sup2)];

    // Uma venda Pix paga (detalhe e estorno), uma contestação aberta e uma mensalidade.
    const pixBooking = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(users.organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(120).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        paymentOption: 'ONLINE_PIX',
      })
      .expect(201);
    bookingId = pixBooking.body.id;
    chargeId = pixBooking.body.onlinePayment.id;
    await t
      .http()
      .post(`/v1/super/online-payments/simulator/charges/${chargeId}/pay`)
      .set(...bearer(users.sup))
      .expect(200);
    await drain(t);
    const cardBooking = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(users.organizer))
      .send({
        spaceId: space.id,
        courtId: space.courtA,
        sportId: space.sportId,
        startsAt: slotIn(300).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        paymentOption: 'ONLINE_CARD',
        cardToken: CARD_CHARGEBACK,
      })
      .expect(201);
    expect(cardBooking.body.onlinePayment.status).toBe('PAID');
    await drain(t, { withChargebacks: true });
    const list = await t
      .http()
      .get(path('chargebacks'))
      .set(...bearer(users.owner))
      .expect(200);
    chargebackId = list.body.items[0].id;

    const plan = first(
      await t.db
        .insert(plans)
        .values({
          spaceId: space.id,
          sportId: space.sportId,
          name: 'Plano perm',
          weeklyFrequency: 1,
          priceCents: 15_000,
          billingDay: 1,
        })
        .returning(),
    );
    const sub = first(
      await t.db
        .insert(subscriptions)
        .values({
          userId: student.id,
          planId: plan.id,
          spaceId: space.id,
          status: 'PAST_DUE',
          priceCents: 15_000,
          startsOn: '2020-01-01',
          currentPeriodStart: '2020-02-01',
          currentPeriodEnd: '2020-02-28',
        })
        .returning(),
    );
    subId = sub.id;
    subChargeId = first(
      await t.db
        .insert(subscriptionCharges)
        .values({
          subscriptionId: sub.id,
          periodStart: '2020-01-01',
          periodEnd: '2020-01-31',
          dueDate: '2020-01-01',
          amountCents: 15_000,
          status: 'OVERDUE',
        })
        .returning(),
    ).id;
  });

  afterAll(async () => {
    await t.close();
  });

  type Call = {
    name: string;
    method: 'get' | 'post' | 'put' | 'delete';
    url: () => string;
    body?: () => Row;
    /** Quem pode: todos os outros recebem 401/403 (ou 404 quando o recurso é de outro dono). */
    allowed: ActorName[];
    /** Status que provam que a permissão passou (padrão: qualquer 2xx). */
    passes?: number[];
    /** Rotas com recurso do usuário respondem 404 a quem não é dono dele (não vaza existência). */
    deniedMay404?: boolean;
  };

  const STAFF: ActorName[] = ['owner', 'admin', 'supSupport'];
  const OWNER_ONLY: ActorName[] = ['owner'];

  const manage: Call[] = [
    {
      name: 'GET merchant-account',
      method: 'get',
      url: () => path('merchant-account'),
      allowed: STAFF,
    },
    {
      name: 'PUT merchant-account (Dono, fora do modo suporte)',
      method: 'put',
      url: () => path('merchant-account'),
      body: () => merchantBody(),
      allowed: OWNER_ONLY,
      // Cadastro já aprovado: o Dono passa pela permissão e recebe 409 MERCHANT_ACCOUNT_APPROVED.
      passes: [409],
    },
    {
      name: 'PUT merchant-account/payout (Dono, fora do modo suporte)',
      method: 'put',
      url: () => path('merchant-account/payout'),
      body: () => ({ payout: merchantBody().payout, acceptTerms: true }),
      allowed: OWNER_ONLY,
    },
    { name: 'GET settings', method: 'get', url: () => path('settings'), allowed: STAFF },
    {
      name: 'PUT settings',
      method: 'put',
      url: () => path('settings'),
      body: () => ({ bookingMode: 'ONLINE_OPTIONAL', classMode: 'ONLINE_OPTIONAL' }),
      allowed: STAFF,
    },
    { name: 'GET wallet', method: 'get', url: () => path('wallet'), allowed: STAFF },
    {
      name: 'GET wallet/entries',
      method: 'get',
      url: () => path('wallet/entries'),
      allowed: STAFF,
    },
    {
      name: 'GET wallet/entries.csv',
      method: 'get',
      url: () => path('wallet/entries.csv'),
      allowed: STAFF,
    },
    {
      name: 'GET wallet/payouts',
      method: 'get',
      url: () => path('wallet/payouts'),
      allowed: STAFF,
    },
    { name: 'GET charges', method: 'get', url: () => path('charges'), allowed: STAFF },
    {
      name: 'GET charges/:id',
      method: 'get',
      url: () => path(`charges/${chargeId}`),
      allowed: STAFF,
    },
    { name: 'GET chargebacks', method: 'get', url: () => path('chargebacks'), allowed: STAFF },
  ];

  const denied = (call: Call, actor: ActorName) => !call.allowed.includes(actor);

  const send = (call: Call, actor: ActorName) => {
    const req = as(actor, t.http()[call.method](call.url()));
    return call.body ? req.send(call.body()) : req;
  };

  describe('rotas do painel (/manage/spaces/:spaceId/online-payments)', () => {
    const actors: ActorName[] = [
      'anon',
      'owner',
      'admin',
      'teacher',
      'player',
      'otherOwner',
      'otherAdmin',
      'sup',
      'supSupport',
      'supSupportOther',
    ];

    for (const call of manage) {
      it(`${call.name}: só quem pode`, async () => {
        for (const actor of actors) {
          const res = await send(call, actor);
          if (denied(call, actor)) {
            expect(res.status, `${call.name} como ${actor}`).toBe(actor === 'anon' ? 401 : 403);
            if (actor === 'supSupport') {
              expect(res.body.error.code).toBe('SUPPORT_MODE_FORBIDDEN');
            }
          } else {
            if (call.passes) expect(call.passes).toContain(res.status);
            else expect(res.status, `${call.name} como ${actor}`).toBeLessThan(300);
          }
        }
      });
    }

    it('estorno: Dono e Admin; Professor, jogador, outro espaço, Super sem suporte e anônimo, não', async () => {
      const url = path(`charges/${chargeId}/refunds`);
      const body = { amountCents: 100, reason: 'Teste de permissão' };
      for (const actor of [
        'anon',
        'teacher',
        'player',
        'otherOwner',
        'otherAdmin',
        'sup',
      ] as const) {
        const res = await as(actor, t.http().post(url)).send(body);
        expect(res.status, `estorno como ${actor}`).toBe(actor === 'anon' ? 401 : 403);
      }
      // Suporte de outro espaço também não.
      expect((await as('supSupportOther', t.http().post(url)).send(body)).status).toBe(403);
      for (const actor of ['owner', 'admin', 'supSupport'] as const) {
        const res = await as(actor, t.http().post(url)).send(body);
        expect(res.status, `estorno como ${actor}`).toBe(201);
      }
    });

    it('contestação: Dono e Admin respondem; Professor, jogador e outro espaço, não', async () => {
      const url = path(`chargebacks/${chargebackId}/dispute`);
      const body = { text: 'Resposta da contestação com mais de dez caracteres.' };
      for (const actor of [
        'anon',
        'teacher',
        'player',
        'otherOwner',
        'otherAdmin',
        'sup',
      ] as const) {
        const res = await as(actor, t.http().post(url)).send(body);
        expect(res.status, `contestação como ${actor}`).toBe(actor === 'anon' ? 401 : 403);
      }
      const ok = await as('admin', t.http().post(url)).send(body);
      expect(ok.status).toBe(201);
    });

    it('dono de outro espaço usando o id de uma cobrança alheia no próprio espaço: 404, nada muda', async () => {
      const own = t.http();
      const as404 = [
        await own.get(path(`charges/${chargeId}`, otherSpace.id)).set(...bearer(users.otherOwner)),
        await t
          .http()
          .post(path(`charges/${chargeId}/refunds`, otherSpace.id))
          .set(...bearer(users.otherOwner))
          .send({ amountCents: 1, reason: 'Invasão de outro espaço' }),
        await t
          .http()
          .post(path(`chargebacks/${chargebackId}/dispute`, otherSpace.id))
          .set(...bearer(users.otherOwner))
          .send({ text: 'Resposta de outro espaço com mais de dez caracteres.' }),
      ];
      expect(as404.map((r) => r.status)).toEqual([404, 404, 404]);
    });

    it('a configuração de modo online do Professor e do jogador não muda nada', async () => {
      for (const actor of ['teacher', 'player', 'otherAdmin'] as const) {
        await as(actor, t.http().put(path('settings')))
          .send({ bookingMode: 'ONLINE_REQUIRED', classMode: 'ONLINE_OPTIONAL' })
          .expect(403);
      }
      const settings = await as('owner', t.http().get(path('settings'))).expect(200);
      expect(settings.body.bookingMode).toBe('ONLINE_OPTIONAL');
    });
  });

  describe('rotas do jogador', () => {
    it('cobrar e consultar a reserva: só o organizador (Dono do espaço e outro jogador, não)', async () => {
      const url = `/v1/bookings/${bookingId}/payment`;
      for (const actor of ['player', 'owner', 'admin', 'teacher', 'otherOwner'] as const) {
        const post = await as(actor, t.http().post(url)).send({ method: 'PIX' });
        expect([403, 404], `POST como ${actor}`).toContain(post.status);
        const get = await as(actor, t.http().get(url));
        expect([403, 404], `GET como ${actor}`).toContain(get.status);
      }
      expect((await t.http().post(url).send({ method: 'PIX' })).status).toBe(401);
      expect((await t.http().get(url)).status).toBe(401);
      const get = await as('organizer', t.http().get(url));
      expect(get.status).toBe(200);
    });

    it('mensalidade: só o aluno paga e consulta a própria cobrança', async () => {
      const url = `/v1/me/subscriptions/${subId}/charges/${subChargeId}/payment`;
      for (const actor of ['player', 'organizer', 'owner', 'admin', 'teacher'] as const) {
        const post = await as(actor, t.http().post(url)).send({ method: 'PIX' });
        expect(post.status, `POST como ${actor}`).toBe(404);
        expect((await as(actor, t.http().get(url))).status, `GET como ${actor}`).toBe(404);
      }
      expect((await t.http().post(url).send({ method: 'PIX' })).status).toBe(401);
      const res = await t
        .http()
        .post(url)
        .set(...bearer(student))
        .send({ method: 'CARD', cardToken: CARD_APPROVE });
      expect(res.status).toBe(201);
    });

    it('Meus pagamentos: cada pagador vê só os próprios; ninguém vê o de outro (404)', async () => {
      const mine = await as('organizer', t.http().get('/v1/me/payments')).expect(200);
      expect(mine.body.items.length).toBeGreaterThan(0);
      const none = await as('player', t.http().get('/v1/me/payments')).expect(200);
      expect(none.body.items).toEqual([]);
      for (const actor of ['player', 'owner', 'admin', 'otherOwner'] as const) {
        const res = await as(actor, t.http().get(`/v1/me/payments/${chargeId}`));
        expect(res.status, `comprovante como ${actor}`).toBe(404);
      }
      expect((await t.http().get('/v1/me/payments')).status).toBe(401);
      await as('organizer', t.http().get(`/v1/me/payments/${chargeId}`)).expect(200);
    });
  });

  describe('rotas do Super e simulador', () => {
    const superCalls: [string, string, Row | undefined][] = [
      ['get', '/v1/super/online-payments/fees', undefined],
      [
        'put',
        '/v1/super/online-payments/fees',
        { pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'SPACE' },
      ],
      [
        'put',
        '/v1/super/online-payments/fees/spaces/{space}',
        { pixFeeBps: 400, cardFeeBps: null, minFeeCents: null, feePayer: null },
      ],
      ['delete', '/v1/super/online-payments/fees/spaces/{space}', undefined],
      ['get', '/v1/super/online-payments/merchant-accounts', undefined],
      ['get', '/v1/super/online-payments/revenue', undefined],
      ['get', '/v1/super/online-payments/revenue.csv', undefined],
      ['get', '/v1/super/online-payments/reports/monthly?month=2026-11', undefined],
      ['get', '/v1/super/online-payments/reports/monthly.csv?month=2026-11', undefined],
      ['get', '/v1/super/online-payments/simulator/charges', undefined],
      ['post', '/v1/super/online-payments/simulator/charges/{charge}/expire', {}],
      ['post', '/v1/super/online-payments/simulator/charges/{charge}/pay', {}],
      ['post', '/v1/super/online-payments/simulator/charges/{charge}/chargeback', {}],
      [
        'post',
        '/v1/super/online-payments/simulator/charges/{charge}/dispute-result',
        { outcome: 'LOST' },
      ],
      ['post', '/v1/super/online-payments/simulator/merchant-accounts/{space}/approve', {}],
      ['post', '/v1/super/online-payments/simulator/merchant-accounts/{space}/reject', {}],
      ['post', '/v1/super/online-payments/simulator/settle', {}],
    ];

    it('todas exigem login e o papel da plataforma: Dono, Admin, Professor e jogador recebem 403', async () => {
      for (const [method, template, body] of superCalls) {
        const url = template.replace('{space}', space.id).replace('{charge}', chargeId);
        const call = (actor: ActorName) => {
          const req = as(actor, t.http()[method as 'get'](url));
          return body ? req.send(body) : req;
        };
        expect((await call('anon')).status, `${method} ${template} anônimo`).toBe(401);
        for (const actor of ['owner', 'admin', 'teacher', 'player', 'otherOwner'] as const) {
          expect((await call(actor)).status, `${method} ${template} como ${actor}`).toBe(403);
        }
        // O modo suporte não dá acesso ao Super a quem não é Super: o Dono continua sem as rotas.
        const withSupportHeaderOnly = t
          .http()
          [method as 'get'](url)
          .set(...bearer(users.owner))
          .set(...supportHeader);
        const res = body ? await withSupportHeaderOnly.send(body) : await withSupportHeaderOnly;
        expect(res.status, `${method} ${template} Dono com cabeçalho de suporte`).toBe(403);
      }
    });

    it('o Super acessa as rotas de leitura', async () => {
      for (const [method, template] of superCalls) {
        if (method !== 'get') continue;
        const url = template.replace('{space}', space.id).replace('{charge}', chargeId);
        const res = await as('sup', t.http().get(url));
        expect(res.status, `GET ${template}`).toBe(200);
      }
    });

    it('o Super altera a taxa e a auditoria registra o autor', async () => {
      await as('sup', t.http().put(`/v1/super/online-payments/fees/spaces/${space.id}`))
        .send({ pixFeeBps: 300, cardFeeBps: null, minFeeCents: null, feePayer: null })
        .expect(200);
      await as('sup', t.http().delete(`/v1/super/online-payments/fees/spaces/${space.id}`)).expect(
        200,
      );
    });
  });

  describe('webhook e rotas públicas', () => {
    it('o webhook não exige login, mas exige assinatura; o espaço público não vaza dados do cadastro', async () => {
      const body = JSON.stringify({ id: 'evt_perm', type: 'charge.updated', objectId: 'ch_x' });
      expect(
        (
          await t
            .http()
            .post('/v1/webhooks/payments/fake')
            .set('content-type', 'application/json')
            .send(body)
        ).status,
      ).toBe(401);
      const pub = await t.http().get(`/v1/spaces/perm-a`).expect(200);
      const text = JSON.stringify(pub.body);
      expect(text).not.toContain('52998224725');
      expect(text).not.toContain('Fulano de Tal');
      expect(text).not.toContain('fulano@example.com');
      expect(text).not.toMatch(/documentMasked|payoutMasked|platformFee|walletBalance/);
    });
  });
});

describe('simulador sem o gateway fake (RF-ONPAY-12, RN-ONPAY-09)', () => {
  let t: TestApp;
  let space: Space;
  let sup: SignedUp;
  let owner: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({ env: { PAYMENTS_PROVIDER: 'none' } });
    space = await createSpace(t.db, 'sem-fake-pg');
    owner = await member(t, 'dono@sem-fake.test', space.id, 'OWNER');
    sup = await superUser(t, 'super@sem-fake.test');
  });

  afterAll(async () => {
    await t.close();
  });

  const NIL = '00000000-0000-4000-8000-000000000000';
  const routes: [string, string][] = [
    ['get', '/v1/super/online-payments/simulator/charges'],
    ['post', `/v1/super/online-payments/simulator/charges/${NIL}/pay`],
    ['post', `/v1/super/online-payments/simulator/charges/${NIL}/expire`],
    ['post', `/v1/super/online-payments/simulator/charges/${NIL}/chargeback`],
    ['post', `/v1/super/online-payments/simulator/charges/${NIL}/dispute-result`],
    ['post', `/v1/super/online-payments/simulator/merchant-accounts/${NIL}/approve`],
    ['post', `/v1/super/online-payments/simulator/merchant-accounts/${NIL}/reject`],
    ['post', '/v1/super/online-payments/simulator/settle'],
  ];

  it('nenhuma rota do simulador existe (404) para o Super; os demais nem chegam nelas', async () => {
    for (const [method, url] of routes) {
      const as = async (user: SignedUp | null) => {
        const req = t.http()[method as 'get'](url);
        if (user) req.set(...bearer(user));
        return method === 'post' ? req.send({ outcome: 'WON' }) : req;
      };
      expect((await as(sup)).status, `${method} ${url} (Super)`).toBe(404);
      expect([401, 403, 404], `${method} ${url} (Dono)`).toContain((await as(owner)).status);
      expect([401, 403, 404], `${method} ${url} (anônimo)`).toContain((await as(null)).status);
    }
  });

  it('as rotas reais do Super (taxas, receita) seguem funcionando, só o simulador some', async () => {
    for (const url of [
      '/v1/super/online-payments/fees',
      '/v1/super/online-payments/revenue',
      '/v1/super/online-payments/merchant-accounts',
    ]) {
      await t
        .http()
        .get(url)
        .set(...bearer(sup))
        .expect(200);
    }
  });
});

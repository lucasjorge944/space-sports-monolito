import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, merchantAccounts, notifications, spaces } from '../../src/db/schema/index.js';
import { createTestApp, type SignedUp, signUp, type TestApp } from '../auth/helpers.js';
import {
  bearer,
  createSpace,
  member,
  type Space,
  slotIn,
  useMiddayClock,
} from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { APPROVED_CPF, drain, merchantBody, onlinePath, REJECTED_CPF } from './fixtures.js';

// RF-ONPAY-01, 02 e 10; RN-ONPAY-01, 08, 09 e 10; decisões 90, 92 e 95: cadastro no gateway, modos,
// permissões, taxas do Super e o gateway desligado.

useMiddayClock();

describe('pagamento online: cadastro, modos e permissões', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let owner2: SignedUp;
  let admin: SignedUp;
  let teacher: SignedUp;
  let player: SignedUp;
  let sup: SignedUp;
  let other: Space;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'setup-pg');
    other = await createSpace(t.db, 'outro-pg');
    owner = await member(t, 'dono@pg.test', space.id, 'OWNER');
    owner2 = await member(t, 'dono2@pg.test', space.id, 'OWNER');
    admin = await member(t, 'admin@pg.test', space.id, 'ADMIN');
    teacher = await member(t, 'prof@pg.test', space.id, 'TEACHER');
    player = await signUp(t, 'jogador@pg.test');
    sup = await superUser(t, 'super@pg.test');
  });

  afterAll(async () => {
    await t.close();
  });

  const path = (p: string, spaceId = space.id) => onlinePath(spaceId, p);

  it('o cadastro nasce NOT_STARTED com o ambiente de teste e as dicas do fake (decisão 92)', async () => {
    const res = await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'NOT_STARTED', payoutsPaused: false });
    expect(res.body.paymentEnvironment.provider).toBe('fake');
    expect(res.body.paymentEnvironment.enabled).toBe(true);
    expect(
      res.body.paymentEnvironment.sandbox.testCards.map((c: { number: string }) => c.number),
    ).toEqual(['4111 1111 1111 1111', '4000 0000 0000 0002', '4000 0000 0000 0259']);
    expect(res.body.paymentEnvironment.sandbox.rejectedDocument.hint).toMatch(/0000/);
  });

  it('Professor e jogador não veem; Admin vê mas não envia (RN-ONPAY-08)', async () => {
    await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(teacher))
      .expect(403);
    await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(player))
      .expect(403);
    await t
      .http()
      .get(path('wallet'))
      .set(...bearer(teacher))
      .expect(403);
    await t
      .http()
      .put(path('merchant-account'))
      .set(...bearer(admin))
      .send(merchantBody())
      .expect(403);
    // Dono de outro espaço não enxerga este.
    const otherOwner = await member(t, 'outro-dono@pg.test', other.id, 'OWNER');
    await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(otherOwner))
      .expect(403);
  });

  it('modo online exige o cadastro aprovado (RF-ONPAY-02)', async () => {
    const res = await t
      .http()
      .put(path('settings'))
      .set(...bearer(owner))
      .send({ bookingMode: 'ONLINE_OPTIONAL', classMode: 'ON_SITE' })
      .expect(422);
    expect(res.body.error.code).toBe('MERCHANT_NOT_APPROVED');
  });

  it('o fake recusa o documento terminado em 0000; o Dono corrige e reenvia', async () => {
    await t
      .http()
      .put(path('merchant-account'))
      .set(...bearer(owner))
      .send(merchantBody(REJECTED_CPF))
      .expect(200);
    await drain(t);
    const rejected = await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(owner))
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBeTruthy();
    const notes = await t.db.select().from(notifications).where(eq(notifications.userId, admin.id));
    expect(notes.map((n) => n.type)).toContain('MERCHANT_ACCOUNT_REJECTED');

    const pending = await t
      .http()
      .put(path('merchant-account'))
      .set(...bearer(owner))
      .send(merchantBody())
      .expect(200);
    expect(pending.body.status).toBe('PENDING');
    // Em análise não reenvia.
    const again = await t
      .http()
      .put(path('merchant-account'))
      .set(...bearer(owner))
      .send(merchantBody())
      .expect(409);
    expect(again.body.error.code).toBe('MERCHANT_ACCOUNT_PENDING');
    await drain(t);
    const approved = await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(owner))
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('documento e conta só mascarados no painel; o completo fica para o relatório fiscal (RN-ONPAY-10)', async () => {
    const res = await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(owner))
      .expect(200);
    expect(res.body.documentMasked).toBe('***.982.247-**');
    expect(JSON.stringify(res.body)).not.toContain(APPROVED_CPF);
    expect(res.body.payoutMasked).toBe('Banco 341 · Ag. 1234 · Conta corrente ****567');
    expect(JSON.stringify(res.body)).not.toContain('1234567');
    const [row] = await t.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, space.id));
    // Decisão 97: o completo só cifrado (AES-256-GCM), nunca em texto.
    expect(row?.documentEncrypted).toMatch(/^v1\./);
    expect(row?.documentEncrypted).not.toContain(APPROVED_CPF);
    expect(JSON.stringify(row)).not.toContain(APPROVED_CPF);
  });

  it('Admin escolhe os modos; o Professor não (RN-ONPAY-08)', async () => {
    await t
      .http()
      .put(path('settings'))
      .set(...bearer(teacher))
      .send({ bookingMode: 'ONLINE_OPTIONAL', classMode: 'ON_SITE' })
      .expect(403);
    const res = await t
      .http()
      .put(path('settings'))
      .set(...bearer(admin))
      .send({ bookingMode: 'ONLINE_REQUIRED', classMode: 'ONLINE_OPTIONAL' })
      .expect(200);
    expect(res.body).toMatchObject({
      bookingMode: 'ONLINE_REQUIRED',
      effectiveBookingMode: 'ONLINE_REQUIRED',
      effectiveClassMode: 'ONLINE_OPTIONAL',
      merchantAccountStatus: 'APPROVED',
      fee: { pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'SPACE', custom: false },
    });
    const audits = await t.db.select().from(auditLogs).where(eq(auditLogs.spaceId, space.id));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'merchant_account.submit',
        'merchant_account.resubmit',
        'payment_settings.update',
      ]),
    );
  });

  it('espaço público informa os meios por serviço e o ambiente de teste (RF-ONPAY-03)', async () => {
    const res = await t.http().get('/v1/spaces/setup-pg').expect(200);
    expect(res.body.onlinePayments).toEqual({
      rental: { mode: 'ONLINE_REQUIRED', options: ['ONLINE_PIX', 'ONLINE_CARD'] },
      classes: { mode: 'ONLINE_OPTIONAL', options: ['ON_SITE', 'ONLINE_PIX', 'ONLINE_CARD'] },
    });
    expect(res.body.paymentEnvironment.sandbox.label).toBe('Ambiente de teste');
    const plain = await t.http().get('/v1/spaces/outro-pg').expect(200);
    expect(plain.body.onlinePayments.rental).toEqual({ mode: 'ON_SITE', options: ['ON_SITE'] });
  });

  it('modo suporte: vale como Dono para ler, mas não envia o cadastro nem troca a conta (decisão 95)', async () => {
    const session = await t
      .http()
      .post(`/v1/super/spaces/${space.id}/support-sessions`)
      .set(...bearer(sup))
      .send({ reason: 'Atendimento de teste' })
      .expect(201);
    const header = ['x-support-session', session.body.id] as const;
    await t
      .http()
      .get(path('wallet'))
      .set(...bearer(sup))
      .set(...header)
      .expect(200);
    const blocked = await t
      .http()
      .put(path('merchant-account/payout'))
      .set(...bearer(sup))
      .set(...header)
      .send({ payout: merchantBody().payout, acceptTerms: true })
      .expect(403);
    expect(blocked.body.error.code).toBe('SUPPORT_MODE_FORBIDDEN');
    // Sem a sessão de suporte, o Super não acessa o painel do espaço.
    await t
      .http()
      .get(path('wallet'))
      .set(...bearer(sup))
      .expect(403);
  });

  it('trocar a conta: só o Dono, volta à análise, pausa os repasses e avisa todos os Donos (decisão 95)', async () => {
    await t
      .http()
      .put(path('merchant-account/payout'))
      .set(...bearer(admin))
      .send({ payout: merchantBody().payout, acceptTerms: true })
      .expect(403);
    const res = await t
      .http()
      .put(path('merchant-account/payout'))
      .set(...bearer(owner))
      .send({
        payout: { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'financeiro@example.com' },
        acceptTerms: true,
      })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'PENDING', payoutsPaused: true });
    expect(res.body.payoutMasked).toBe('Chave Pix (e-mail) f***@example.com');
    // As cobranças continuam com a troca em análise.
    const settings = await t
      .http()
      .get(path('settings'))
      .set(...bearer(owner))
      .expect(200);
    expect(settings.body.effectiveBookingMode).toBe('ONLINE_REQUIRED');
    const wallet = await t
      .http()
      .get(path('wallet'))
      .set(...bearer(owner))
      .expect(200);
    expect(wallet.body.payoutsPaused).toBe(true);
    for (const user of [owner, owner2]) {
      const notes = await t.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id));
      expect(notes.map((n) => n.type)).toContain('MERCHANT_PAYOUT_ACCOUNT_CHANGED');
    }
    const adminNotes = await t.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(adminNotes.map((n) => n.type)).not.toContain('MERCHANT_PAYOUT_ACCOUNT_CHANGED');
    expect(
      t.mailer.sent.filter((m) => m.subject.startsWith('Conta de recebimento alterada')),
    ).toHaveLength(2);
    await drain(t);
    const approved = await t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(owner))
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', payoutsPaused: false });
  });

  it('Super: taxa padrão e por espaço, só o papel da plataforma, PLAYER recusado (RF-ONPAY-10)', async () => {
    await t
      .http()
      .get('/v1/super/online-payments/fees')
      .set(...bearer(owner))
      .expect(403);
    const before = await t
      .http()
      .get('/v1/super/online-payments/fees')
      .set(...bearer(sup))
      .expect(200);
    expect(before.body.defaults).toMatchObject({
      pixFeeBps: 400,
      cardFeeBps: 600,
      minFeeCents: 100,
      feePayer: 'SPACE',
      updatedByName: null,
    });
    const player = await t
      .http()
      .put('/v1/super/online-payments/fees')
      .set(...bearer(sup))
      .send({ pixFeeBps: 400, cardFeeBps: 600, minFeeCents: 100, feePayer: 'PLAYER' })
      .expect(422);
    expect(player.body.error.code).toBe('FEE_PAYER_NOT_ALLOWED');
    const updated = await t
      .http()
      .put(`/v1/super/online-payments/fees/spaces/${space.id}`)
      .set(...bearer(sup))
      .send({ pixFeeBps: 250, cardFeeBps: null, minFeeCents: 50, feePayer: null })
      .expect(200);
    expect(updated.body.spaces).toEqual([
      expect.objectContaining({
        spaceId: space.id,
        pixFeeBps: 250,
        cardFeeBps: null,
        effective: { pixFeeBps: 250, cardFeeBps: 600, minFeeCents: 50, feePayer: 'SPACE' },
      }),
    ]);
    const settings = await t
      .http()
      .get(path('settings'))
      .set(...bearer(owner))
      .expect(200);
    expect(settings.body.fee).toEqual({
      pixFeeBps: 250,
      cardFeeBps: 600,
      minFeeCents: 50,
      feePayer: 'SPACE',
      custom: true,
    });
    const removed = await t
      .http()
      .delete(`/v1/super/online-payments/fees/spaces/${space.id}`)
      .set(...bearer(sup))
      .expect(200);
    expect(removed.body.spaces).toEqual([]);
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'super.payment_fee.update_space'));
    expect(audits).toHaveLength(2);
    expect(audits[0]?.actingAsSuper).toBe(true);
  });

  it('Super lista os cadastros por status, mascarados', async () => {
    const res = await t
      .http()
      .get('/v1/super/online-payments/merchant-accounts?status=APPROVED')
      .set(...bearer(sup))
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      spaceId: space.id,
      documentMasked: '***.982.247-**',
    });
    expect(JSON.stringify(res.body)).not.toContain(APPROVED_CPF);
  });

  it('espaço suspenso: os modos voltam a ON_SITE na leitura (RN-ONPAY-09)', async () => {
    await t.db.update(spaces).set({ status: 'SUSPENDED' }).where(eq(spaces.id, space.id));
    const res = await t
      .http()
      .get(path('settings'))
      .set(...bearer(owner))
      .expect(200);
    expect(res.body).toMatchObject({
      bookingMode: 'ONLINE_REQUIRED',
      effectiveBookingMode: 'ON_SITE',
    });
    await t.db.update(spaces).set({ status: 'ACTIVE' }).where(eq(spaces.id, space.id));
  });

  it('webhook: assinatura inválida 401, provedor desconhecido 404', async () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'charge.updated', objectId: 'ch_x' });
    const bad = await t
      .http()
      .post('/v1/webhooks/payments/fake')
      .set('content-type', 'application/json')
      .set('x-fake-signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`)
      .send(body)
      .expect(401);
    expect(bad.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await t.http().post('/v1/webhooks/payments/fake').send(body).expect(401);
    const unknown = await t.http().post('/v1/webhooks/payments/asaas').send(body).expect(404);
    expect(unknown.body.error.code).toBe('WEBHOOK_PROVIDER_NOT_FOUND');
  });

  it('simulador: só o Super', async () => {
    await t
      .http()
      .get('/v1/super/online-payments/simulator/charges')
      .set(...bearer(owner))
      .expect(403);
    await t
      .http()
      .get('/v1/super/online-payments/simulator/charges')
      .set(...bearer(sup))
      .expect(200);
  });

  it('cobrança no espaço sem modo online: 422 ONLINE_PAYMENT_UNAVAILABLE', async () => {
    const otherPlayer = await signUp(t, 'jogador2@pg.test');
    const booking = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(otherPlayer))
      .send({
        spaceId: other.id,
        courtId: other.courtA,
        sportId: other.sportId,
        startsAt: slotIn(120).toISOString(),
        durationMin: 60,
        peopleCount: 2,
        paymentOption: 'ONLINE_PIX',
      })
      .expect(422);
    expect(booking.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
  });
});

describe('pagamento online com PAYMENTS_PROVIDER=none (RN-ONPAY-09)', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let sup: SignedUp;
  let player: SignedUp;

  beforeAll(async () => {
    t = await createTestApp({ env: { PAYMENTS_PROVIDER: 'none' } });
    space = await createSpace(t.db, 'none-pg');
    owner = await member(t, 'dono@none.test', space.id, 'OWNER');
    sup = await superUser(t, 'super@none.test');
    player = await signUp(t, 'jogador@none.test');
  });

  afterAll(async () => {
    await t.close();
  });

  it('o simulador não existe (404) e o cadastro é recusado', async () => {
    await t
      .http()
      .get('/v1/super/online-payments/simulator/charges')
      .set(...bearer(sup))
      .expect(404);
    const res = await t
      .http()
      .put(onlinePath(space.id, 'merchant-account'))
      .set(...bearer(owner))
      .send(merchantBody())
      .expect(422);
    expect(res.body.error.code).toBe('ONLINE_PAYMENTS_DISABLED');
  });

  it('tudo em ON_SITE na leitura; reserva no local segue normal; online recusado', async () => {
    const settings = await t
      .http()
      .get(onlinePath(space.id, 'settings'))
      .set(...bearer(owner))
      .expect(200);
    expect(settings.body.paymentEnvironment).toEqual({
      provider: 'none',
      enabled: false,
      sandbox: null,
    });
    expect(settings.body.effectiveBookingMode).toBe('ON_SITE');
    const pub = await t.http().get('/v1/spaces/none-pg').expect(200);
    expect(pub.body.paymentEnvironment.enabled).toBe(false);
    const body = {
      spaceId: space.id,
      courtId: space.courtA,
      sportId: space.sportId,
      startsAt: slotIn(120).toISOString(),
      durationMin: 60,
      peopleCount: 2,
    };
    const online = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(player))
      .send({ ...body, paymentOption: 'ONLINE_PIX' })
      .expect(422);
    expect(online.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    const booking = await t
      .http()
      .post('/v1/bookings')
      .set(...bearer(player))
      .send(body)
      .expect(201);
    expect(booking.body.status).toBe('CONFIRMED');
    const pay = await t
      .http()
      .post(`/v1/bookings/${booking.body.id}/payment`)
      .set(...bearer(player))
      .send({ method: 'PIX' })
      .expect(422);
    expect(pay.body.error.code).toBe('ONLINE_PAYMENTS_DISABLED');
    // O webhook de qualquer provedor não existe.
    await t.http().post('/v1/webhooks/payments/fake').send({}).expect(404);
  });
});

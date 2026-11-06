import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, merchantAccounts, notifications, payouts } from '../../src/db/schema/index.js';
import { type DataCipher, PAYMENTS_DATA_CIPHER } from '../../src/payments/data-cipher.js';
import { PAYMENT_GATEWAY } from '../../src/payments/gateway/gateway.registry.js';
import type { FakePaymentGateway } from '../../src/payments/gateways/fake/fake-gateway.js';
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
import {
  APPROVED_CPF,
  approveMerchant,
  CARD_APPROVE,
  drain,
  merchantBody,
  onlinePath,
  setModes,
} from './fixtures.js';

// PG.2b (ajustes do contrato pedidos pelo web e pelo app): CPF do responsável no cadastro com CNPJ
// (só mascarado), cadastro que não se refaz depois de aprovado e troca de conta recusada que volta
// para a conta anterior (decisão 98), e `onlineReady` nas configurações (RF-ONPAY-01 e 02).

useMiddayClock();

const CNPJ = '11222333000181';
const BANK_MASKED = 'Banco 341 · Ag. 1234 · Conta corrente ****567';
const PIX_EMAIL = { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'financeiro@example.com' };
const PIX_EMAIL_MASKED = 'Chave Pix (e-mail) f***@example.com';

describe('cadastro no gateway: CPF do responsável e troca de conta recusada', () => {
  let t: TestApp;
  let space: Space;
  let owner: SignedUp;
  let admin: SignedUp;
  let player: SignedUp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    space = await createSpace(t.db, 'troca-pg');
    owner = await member(t, 'dono@troca.test', space.id, 'OWNER');
    admin = await member(t, 'admin@troca.test', space.id, 'ADMIN');
    player = await signUp(t, 'jogador@troca.test', 'Joana Jogadora');
    sup = await superUser(t, 'super@troca.test');
  });

  afterAll(async () => {
    await t.close();
  });

  const path = (p: string, spaceId = space.id) => onlinePath(spaceId, p);
  const merchant = (user = owner) =>
    t
      .http()
      .get(path('merchant-account'))
      .set(...bearer(user))
      .expect(200);
  const settings = () =>
    t
      .http()
      .get(path('settings'))
      .set(...bearer(admin))
      .expect(200);
  const changePayout = (payout: Record<string, unknown>) =>
    t
      .http()
      .put(path('merchant-account/payout'))
      .set(...bearer(owner))
      .send({ payout, acceptTerms: true });
  const typesOf = async (user: SignedUp) =>
    (await t.db.select().from(notifications).where(eq(notifications.userId, user.id))).map(
      (n) => n.type,
    );

  describe('CPF do responsável (obrigatório com CNPJ)', () => {
    const cnpjBody = (extra: Record<string, unknown> = {}) => ({
      ...merchantBody(),
      documentType: 'CNPJ',
      document: '11.222.333/0001-81',
      legalName: 'Arena Teste Ltda',
      ...extra,
    });
    const submit = (body: Record<string, unknown>, spaceId = space.id) =>
      t
        .http()
        .put(path('merchant-account', spaceId))
        .set(...bearer(owner))
        .send(body);

    it('CNPJ sem o CPF do responsável, CPF com ele ou CPF inválido: 400', async () => {
      for (const body of [
        cnpjBody(),
        { ...merchantBody(), responsibleCpf: APPROVED_CPF },
        cnpjBody({ responsibleCpf: '529.982.247-24' }),
      ]) {
        const res = await submit(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect((await merchant()).body.status).toBe('NOT_STARTED');
    });

    it('vai ao gateway e fica só mascarado (minimização, LGPD); o documento segue cifrado', async () => {
      const gateway = t.app.get<FakePaymentGateway>(PAYMENT_GATEWAY);
      const spy = vi.spyOn(gateway, 'createAccount');
      const res = await submit(cnpjBody({ responsibleCpf: '529.982.247-25' })).expect(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ documentType: 'CNPJ', responsibleCpf: APPROVED_CPF }),
      );
      spy.mockRestore();
      expect(res.body).toMatchObject({
        status: 'PENDING',
        documentType: 'CNPJ',
        documentMasked: '11.222.***/****-**',
        responsibleCpfMasked: '***.982.247-**',
      });
      expect(JSON.stringify(res.body)).not.toContain(APPROVED_CPF);
      const [row] = await t.db
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, space.id));
      expect(row?.responsibleCpfMasked).toBe('***.982.247-**');
      // Nem em texto nem cifrado: a API nunca usa o CPF do responsável depois do envio.
      expect(Object.keys(row ?? {})).not.toContain('responsibleCpfEncrypted');
      expect(JSON.stringify(row)).not.toContain(APPROVED_CPF);
      const cipher = t.app.get<DataCipher>(PAYMENTS_DATA_CIPHER);
      expect(cipher.decrypt(row?.documentEncrypted ?? '', space.id)).toBe(CNPJ);
      const audit = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.spaceId, space.id), eq(auditLogs.action, 'merchant_account.submit')),
        );
      expect(JSON.stringify(audit)).not.toContain(APPROVED_CPF);
      await drain(t);
      // O Super também só vê o mascarado.
      const list = await t
        .http()
        .get('/v1/super/online-payments/merchant-accounts')
        .set(...bearer(sup))
        .expect(200);
      const item = list.body.items.find((i: { spaceId: string }) => i.spaceId === space.id);
      expect(item).toMatchObject({ status: 'APPROVED', responsibleCpfMasked: '***.982.247-**' });
    });
  });

  describe('decisão 98: aprovado não refaz o cadastro; troca recusada volta para a conta anterior', () => {
    let other: Space;
    let otherOwner: SignedUp;
    let otherOwner2: SignedUp;
    let otherAdmin: SignedUp;
    const otherPath = (p: string) => path(p, other.id);

    beforeAll(async () => {
      other = await createSpace(t.db, 'troca2-pg');
      otherOwner = await member(t, 'dono@troca2.test', other.id, 'OWNER');
      otherOwner2 = await member(t, 'dono2@troca2.test', other.id, 'OWNER');
      otherAdmin = await member(t, 'admin@troca2.test', other.id, 'ADMIN');
    });

    const get = (p: string, user = otherOwner) =>
      t
        .http()
        .get(otherPath(p))
        .set(...bearer(user))
        .expect(200);
    const change = (payout: Record<string, unknown>) =>
      t
        .http()
        .put(otherPath('merchant-account/payout'))
        .set(...bearer(otherOwner))
        .send({ payout, acceptTerms: true });
    const resubmit = () =>
      t
        .http()
        .put(otherPath('merchant-account'))
        .set(...bearer(otherOwner))
        .send(merchantBody());

    it('onlineReady acompanha a regra da cobrança: falso sem cadastro, verdadeiro aprovado', async () => {
      expect((await get('settings')).body).toMatchObject({
        onlineReady: false,
        effectiveBookingMode: 'ON_SITE',
      });
      await approveMerchant(t, otherOwner, other.id);
      await setModes(t, otherOwner, other.id, 'ONLINE_OPTIONAL', 'ONLINE_OPTIONAL');
      expect((await get('settings', otherAdmin)).body).toMatchObject({
        onlineReady: true,
        effectiveBookingMode: 'ONLINE_OPTIONAL',
        merchantAccountStatus: 'APPROVED',
      });
    });

    it('cadastro aprovado: o reenvio responde 409 MERCHANT_ACCOUNT_APPROVED', async () => {
      const res = await resubmit().expect(409);
      expect(res.body.error.code).toBe('MERCHANT_ACCOUNT_APPROVED');
    });

    it('troca em análise: repasses pausados, cobranças seguem e o reenvio continua recusado', async () => {
      const res = await change(PIX_EMAIL).expect(200);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        payoutsPaused: true,
        payoutMasked: PIX_EMAIL_MASKED,
        lastRejectedPayoutChange: null,
      });
      expect((await get('settings')).body).toMatchObject({
        onlineReady: true,
        effectiveBookingMode: 'ONLINE_OPTIONAL',
      });
      const again = await resubmit().expect(409);
      expect(again.body.error.code).toBe('MERCHANT_ACCOUNT_APPROVED');
    });

    it('recusada: volta a conta aprovada, repasses retomam, o online segue e os Donos são avisados', async () => {
      await t
        .http()
        .post(`/v1/super/online-payments/simulator/merchant-accounts/${other.id}/reject`)
        .set(...bearer(sup))
        .send({ reason: 'A chave Pix é de outro titular.' })
        .expect(200);
      await drain(t);
      const res = await get('merchant-account', otherAdmin);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        payoutsPaused: false,
        payoutKind: 'BANK_ACCOUNT',
        payoutMasked: BANK_MASKED,
        rejectionReason: null,
        lastRejectedPayoutChange: {
          payoutMasked: PIX_EMAIL_MASKED,
          reason: 'A chave Pix é de outro titular.',
        },
      });
      expect(res.body.lastRejectedPayoutChange.rejectedAt).toBeTruthy();
      expect((await get('settings')).body).toMatchObject({
        onlineReady: true,
        merchantAccountStatus: 'APPROVED',
        effectiveBookingMode: 'ONLINE_OPTIONAL',
        effectiveClassMode: 'ONLINE_OPTIONAL',
      });
      expect((await get('wallet')).body).toMatchObject({
        merchantAccountStatus: 'APPROVED',
        payoutsPaused: false,
      });
      // Todos os Donos (notificação e e-mail), não o Admin; nada de "cadastro recusado".
      for (const user of [otherOwner, otherOwner2]) {
        expect(await typesOf(user)).toContain('MERCHANT_PAYOUT_CHANGE_REJECTED');
      }
      const note = (
        await t.db.select().from(notifications).where(eq(notifications.userId, otherOwner.id))
      ).find((n) => n.type === 'MERCHANT_PAYOUT_CHANGE_REJECTED');
      expect(note?.body).toContain('A chave Pix é de outro titular.');
      expect(note?.data).toMatchObject({ spaceId: other.id, section: 'SETTINGS' });
      const adminTypes = await typesOf(otherAdmin);
      expect(adminTypes).not.toContain('MERCHANT_PAYOUT_CHANGE_REJECTED');
      expect(adminTypes).not.toContain('MERCHANT_ACCOUNT_REJECTED');
      expect(
        t.mailer.sent.filter((m) => m.subject === 'Troca de conta recusada em Espaço troca2-pg'),
      ).toHaveLength(2);
      const audits = await t.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.spaceId, other.id),
            eq(auditLogs.action, 'merchant_account.payout_change_rejected'),
          ),
        );
      expect(audits).toHaveLength(1);
      // O espaço segue recebendo online e os repasses voltam a sair.
      const booking = await t
        .http()
        .post('/v1/bookings')
        .set(...bearer(player))
        .send({
          spaceId: other.id,
          courtId: other.courtA,
          sportId: other.sportId,
          startsAt: slotIn(180).toISOString(),
          durationMin: 60,
          peopleCount: 2,
          paymentOption: 'ONLINE_CARD',
          cardToken: CARD_APPROVE,
        })
        .expect(201);
      expect(booking.body.onlinePayment.status).toBe('PAID');
      await drain(t);
      await t
        .http()
        .post('/v1/super/online-payments/simulator/settle')
        .set(...bearer(sup))
        .send({ spaceId: other.id })
        .expect(200);
      await drain(t);
      const paid = await t.db
        .select()
        .from(payouts)
        .where(and(eq(payouts.spaceId, other.id), eq(payouts.status, 'PAID')));
      expect(paid).toHaveLength(1);
    });

    it('a próxima troca apaga o aviso da recusada e, aprovada, passa a valer', async () => {
      const res = await change({
        kind: 'PIX_KEY',
        keyType: 'RANDOM',
        key: 'abcd-1234-efgh-5678',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'PENDING', lastRejectedPayoutChange: null });
      await drain(t);
      const approved = await get('merchant-account');
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        payoutsPaused: false,
        payoutMasked: 'Chave Pix (aleatória) ***************5678',
        lastRejectedPayoutChange: null,
      });
      const [row] = await t.db
        .select()
        .from(merchantAccounts)
        .where(eq(merchantAccounts.spaceId, other.id));
      expect(row).toMatchObject({ previousPayoutKind: null, previousPayoutMasked: null });
    });
  });

  it('troca aprovada no cadastro com CNPJ mantém o CPF do responsável e o onlineReady', async () => {
    const res = await changePayout(PIX_EMAIL).expect(200);
    expect(res.body).toMatchObject({ status: 'PENDING', responsibleCpfMasked: '***.982.247-**' });
    await drain(t);
    expect((await merchant()).body).toMatchObject({
      status: 'APPROVED',
      payoutMasked: PIX_EMAIL_MASKED,
    });
    expect((await settings()).body.onlineReady).toBe(true);
  });
});

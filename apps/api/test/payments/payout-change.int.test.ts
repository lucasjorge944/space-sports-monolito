import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  fakeGatewayObjects,
  merchantAccounts,
  notifications,
} from '../../src/db/schema/index.js';
import { PAYMENT_GATEWAY } from '../../src/payments/gateway/gateway.registry.js';
import type { FakePaymentGateway } from '../../src/payments/gateways/fake/fake-gateway.js';
import {
  MERCHANT_RESYNC_AFTER_MIN,
  MerchantAccountsService,
  PAYOUT_CHANGE_NOT_CONFIRMED_REASON,
} from '../../src/payments/merchant-accounts.service.js';
import { createTestApp, type SignedUp, type TestApp } from '../auth/helpers.js';
import { bearer, createSpace, member, type Space, useMiddayClock } from '../bookings/fixtures.js';
import { superUser } from '../super/fixtures.js';
import { approveMerchant, drain, jobsOf, onlinePath, queueOf } from './fixtures.js';

// Revisão da PG.2b, decisão 98: a troca de conta grava a intenção antes do gateway, a decisão só
// vale para a troca com o mesmo id, a reconciliação ressincroniza os cadastros pendentes, a troca
// antiga (sem id nem conta guardada) tem fallback e o simulador não derruba o espaço aprovado.

useMiddayClock();

const BANK_MASKED = 'Banco 341 · Ag. 1234 · Conta corrente ****567';
const PIX_EMAIL = { kind: 'PIX_KEY', keyType: 'EMAIL', key: 'financeiro@example.com' };
const PIX_EMAIL_MASKED = 'Chave Pix (e-mail) f***@example.com';
const PIX_RANDOM = { kind: 'PIX_KEY', keyType: 'RANDOM', key: 'abcd-1234-efgh-5678' };
const PIX_RANDOM_MASKED = 'Chave Pix (aleatória) ***************5678';
const MINUTE = 60_000;

interface Ctx {
  space: Space;
  owner: SignedUp;
  owner2: SignedUp;
  providerAccountId: string;
}

describe('troca da conta de recebimento (revisão da PG.2b, decisão 98)', () => {
  let t: TestApp;
  let sup: SignedUp;

  beforeAll(async () => {
    t = await createTestApp();
    sup = await superUser(t, 'super@troca-rev.test');
  });

  afterAll(async () => {
    await t.close();
  });

  const gateway = () => t.app.get<FakePaymentGateway>(PAYMENT_GATEWAY);
  const merchants = () => t.app.get(MerchantAccountsService);

  async function approvedSpace(slug: string): Promise<Ctx> {
    const space = await createSpace(t.db, slug);
    const owner = await member(t, `dono@${slug}.test`, space.id, 'OWNER');
    const owner2 = await member(t, `dono2@${slug}.test`, space.id, 'OWNER');
    await approveMerchant(t, owner, space.id);
    const row = await accountRow(space.id);
    return { space, owner, owner2, providerAccountId: row.providerAccountId as string };
  }

  async function accountRow(spaceId: string) {
    const [row] = await t.db
      .select()
      .from(merchantAccounts)
      .where(eq(merchantAccounts.spaceId, spaceId));
    if (!row) throw new Error('Cadastro não encontrado.');
    return row;
  }

  const change = (ctx: Ctx, payout: Record<string, unknown>) =>
    t
      .http()
      .put(onlinePath(ctx.space.id, 'merchant-account/payout'))
      .set(...bearer(ctx.owner))
      .send({ payout, acceptTerms: true });

  const account = async (ctx: Ctx) =>
    (
      await t
        .http()
        .get(onlinePath(ctx.space.id, 'merchant-account'))
        .set(...bearer(ctx.owner))
        .expect(200)
    ).body;

  const reject = (ctx: Ctx, reason: string) =>
    t
      .http()
      .post(`/v1/super/online-payments/simulator/merchant-accounts/${ctx.space.id}/reject`)
      .set(...bearer(sup))
      .send({ reason })
      .expect(200);

  const notesOf = async (user: SignedUp, type: string) =>
    (
      await t.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), eq(notifications.type, type)))
    ).length;

  const auditsOf = async (ctx: Ctx, action: string) =>
    t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.spaceId, ctx.space.id), eq(auditLogs.action, action)));

  it('a intenção é gravada antes do gateway: a decisão que chega antes do fim da troca vale', async () => {
    for (const [slug, approve] of [
      ['antes-recusa-pg', false],
      ['antes-aprova-pg', true],
    ] as const) {
      const ctx = await approvedSpace(slug);
      const original = gateway().updateAccountPayout.bind(gateway());
      const seen: { status?: string; changeId?: string | null; key?: string } = {};
      const spy = vi
        .spyOn(gateway(), 'updateAccountPayout')
        .mockImplementationOnce(async (input) => {
          const row = await accountRow(ctx.space.id);
          Object.assign(seen, {
            status: row.status,
            changeId: row.payoutChangeId,
            key: input.idempotencyKey,
          });
          const result = await original(input);
          // O gateway decide e o webhook é processado antes de a troca terminar na API.
          await gateway().decideAccount(input.providerAccountId, {
            approve,
            reason: 'Conta de outro titular.',
          });
          await drain(t);
          return result;
        });
      const res = await change(ctx, PIX_EMAIL).expect(200);
      spy.mockRestore();
      expect(seen).toMatchObject({ status: 'PENDING', changeId: seen.key });
      expect(res.body).toMatchObject(
        approve
          ? { status: 'APPROVED', payoutMasked: PIX_EMAIL_MASKED, lastRejectedPayoutChange: null }
          : {
              status: 'APPROVED',
              payoutMasked: BANK_MASKED,
              lastRejectedPayoutChange: {
                payoutMasked: PIX_EMAIL_MASKED,
                reason: 'Conta de outro titular.',
              },
            },
      );
      expect(res.body.payoutsPaused).toBe(false);
      // O job de decisão do fake chega depois e não muda nada.
      await drain(t);
      expect(await account(ctx)).toMatchObject({
        status: 'APPROVED',
        payoutMasked: approve ? PIX_EMAIL_MASKED : BANK_MASKED,
      });
    }
  });

  it('a decisão de uma troca anterior não fecha a troca nova (compara o id da troca)', async () => {
    const ctx = await approvedSpace('id-troca-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    const original = gateway().updateAccountPayout.bind(gateway());
    const spy = vi.spyOn(gateway(), 'updateAccountPayout').mockImplementationOnce(async (input) => {
      // A recusa da primeira troca chega com a segunda já gravada, antes de ela ir ao gateway.
      await gateway().decideAccount(input.providerAccountId, {
        approve: false,
        reason: 'Recusa da primeira troca.',
      });
      await drain(t);
      return original(input);
    });
    await change(ctx, PIX_RANDOM).expect(200);
    spy.mockRestore();
    expect(await account(ctx)).toMatchObject({
      status: 'PENDING',
      payoutsPaused: true,
      payoutMasked: PIX_RANDOM_MASKED,
      lastRejectedPayoutChange: null,
    });
    expect(await auditsOf(ctx, 'merchant_account.payout_change_rejected')).toHaveLength(0);
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(0);
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutMasked: PIX_RANDOM_MASKED,
      lastRejectedPayoutChange: null,
    });
  });

  it('duas trocas seguidas antes da decisão: a recusa volta para a conta aprovada', async () => {
    const ctx = await approvedSpace('duas-recusa-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    await change(ctx, PIX_RANDOM).expect(200);
    const row = await accountRow(ctx.space.id);
    // A conta guardada continua a aprovada, não a da primeira troca.
    expect(row).toMatchObject({
      status: 'PENDING',
      payoutMasked: PIX_RANDOM_MASKED,
      previousPayoutKind: 'BANK_ACCOUNT',
      previousPayoutMasked: BANK_MASKED,
    });
    await reject(ctx, 'Chave aleatória recusada.');
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutsPaused: false,
      payoutKind: 'BANK_ACCOUNT',
      payoutMasked: BANK_MASKED,
      lastRejectedPayoutChange: {
        payoutMasked: PIX_RANDOM_MASKED,
        reason: 'Chave aleatória recusada.',
      },
    });
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_ACCOUNT_CHANGED')).toBe(2);
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(1);
  });

  it('duas trocas seguidas aprovadas: vale a última', async () => {
    const ctx = await approvedSpace('duas-aprova-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    await change(ctx, PIX_RANDOM).expect(200);
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutsPaused: false,
      payoutMasked: PIX_RANDOM_MASKED,
      lastRejectedPayoutChange: null,
    });
    expect(await accountRow(ctx.space.id)).toMatchObject({
      previousPayoutKind: null,
      previousPayoutMasked: null,
    });
  });

  it('dois account.updated da recusa em paralelo: uma volta, um aviso, uma auditoria', async () => {
    const ctx = await approvedSpace('paralelo-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    // O gateway recusa; o webhook fica na fila e dois processamentos correm juntos.
    await reject(ctx, 'Recusada em paralelo.');
    await Promise.all([
      merchants().sync(ctx.providerAccountId),
      merchants().sync(ctx.providerAccountId),
    ]);
    // O webhook enfileirado também chega: sem efeito.
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutMasked: BANK_MASKED,
      lastRejectedPayoutChange: { payoutMasked: PIX_EMAIL_MASKED },
    });
    for (const owner of [ctx.owner, ctx.owner2]) {
      expect(await notesOf(owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(1);
    }
    expect(await auditsOf(ctx, 'merchant_account.payout_change_rejected')).toHaveLength(1);
    expect(
      t.mailer.sent.filter((m) => m.subject === 'Troca de conta recusada em Espaço paralelo-pg'),
    ).toHaveLength(2);
  });

  it('gateway fora do ar desfaz a intenção (502); com a troca registrada pela chave, ela vale', async () => {
    const ctx = await approvedSpace('falha-pg');
    const original = gateway().updateAccountPayout.bind(gateway());
    const spy = vi
      .spyOn(gateway(), 'updateAccountPayout')
      .mockRejectedValueOnce(new Error('Gateway fora do ar.'));
    const failed = await change(ctx, PIX_EMAIL).expect(502);
    expect(failed.body.error.code).toBe('PAYMENT_GATEWAY_UNAVAILABLE');
    expect(await accountRow(ctx.space.id)).toMatchObject({
      status: 'APPROVED',
      payoutMasked: BANK_MASKED,
      payoutChangeId: null,
      previousPayoutMasked: null,
    });
    expect(await auditsOf(ctx, 'merchant_account.change_payout')).toHaveLength(0);
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_ACCOUNT_CHANGED')).toBe(0);
    // Timeout depois de o gateway registrar a troca: a consulta pela chave confirma, e ela vale.
    spy.mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error('Timeout.');
    });
    const ok = await change(ctx, PIX_EMAIL).expect(200);
    spy.mockRestore();
    expect(ok.body).toMatchObject({
      status: 'PENDING',
      payoutsPaused: true,
      payoutMasked: PIX_EMAIL_MASKED,
    });
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutMasked: PIX_EMAIL_MASKED,
    });
  });

  it(`reconciliação: o webhook perdido é recuperado depois de ${MERCHANT_RESYNC_AFTER_MIN} minutos`, async () => {
    const ctx = await approvedSpace('perdido-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    await reject(ctx, 'Recusada sem aviso.');
    // O webhook e o job de decisão do fake se perdem.
    queueOf(t).clear();
    const now = Date.now();
    await jobsOf(t).reconcile(new Date(now + (MERCHANT_RESYNC_AFTER_MIN - 1) * MINUTE));
    expect((await account(ctx)).status).toBe('PENDING');
    const result = await jobsOf(t).reconcile(
      new Date(now + (MERCHANT_RESYNC_AFTER_MIN + 1) * MINUTE),
    );
    expect(result.accounts).toBeGreaterThanOrEqual(1);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutsPaused: false,
      payoutMasked: BANK_MASKED,
      lastRejectedPayoutChange: { reason: 'Recusada sem aviso.' },
    });
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(1);
  });

  it('reconciliação: a troca gravada que não chegou ao gateway é desfeita como não confirmada', async () => {
    const ctx = await approvedSpace('queda-pg');
    // Queda entre a intenção e a chamada ao gateway: a troca só existe na API.
    await t.db
      .update(merchantAccounts)
      .set({
        status: 'PENDING',
        payoutChangeId: randomUUID(),
        payoutKind: 'PIX_KEY',
        payoutMasked: PIX_EMAIL_MASKED,
        previousPayoutKind: 'BANK_ACCOUNT',
        previousPayoutMasked: BANK_MASKED,
        submittedAt: new Date(),
      })
      .where(eq(merchantAccounts.spaceId, ctx.space.id));
    const now = Date.now();
    await jobsOf(t).reconcile(new Date(now + 5 * MINUTE));
    expect((await account(ctx)).status).toBe('PENDING');
    await jobsOf(t).reconcile(new Date(now + (MERCHANT_RESYNC_AFTER_MIN + 1) * MINUTE));
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutMasked: BANK_MASKED,
      lastRejectedPayoutChange: {
        payoutMasked: PIX_EMAIL_MASKED,
        reason: PAYOUT_CHANGE_NOT_CONFIRMED_REASON,
      },
    });
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(1);
  });

  it('troca antiga (sem id nem conta guardada): a recusa mantém APPROVED com a conta atual e avisa', async () => {
    const ctx = await approvedSpace('antiga-pg');
    await change(ctx, PIX_EMAIL).expect(200);
    // Como uma troca de antes da PG.2b: sem id e sem a conta aprovada guardada, e o fake sem a
    // troca registrada.
    await t.db
      .update(merchantAccounts)
      .set({ payoutChangeId: null, previousPayoutKind: null, previousPayoutMasked: null })
      .where(eq(merchantAccounts.spaceId, ctx.space.id));
    await t.db
      .update(fakeGatewayObjects)
      .set({ data: sql`${fakeGatewayObjects.data} - 'payoutChange'` })
      .where(eq(fakeGatewayObjects.id, ctx.providerAccountId));
    await reject(ctx, 'Recusada (troca antiga).');
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      payoutsPaused: false,
      payoutMasked: PIX_EMAIL_MASKED,
      lastRejectedPayoutChange: {
        payoutMasked: PIX_EMAIL_MASKED,
        reason: 'Recusada (troca antiga).',
      },
    });
    const [audit] = await auditsOf(ctx, 'merchant_account.payout_change_rejected');
    expect(audit?.diff).toMatchObject({ previousUnknown: true });
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(1);
    const settings = await t
      .http()
      .get(onlinePath(ctx.space.id, 'settings'))
      .set(...bearer(ctx.owner))
      .expect(200);
    expect(settings.body.onlineReady).toBe(true);
  });

  it('simulador: recusar um espaço aprovado sem troca em análise não tem efeito', async () => {
    const ctx = await approvedSpace('simulador-pg');
    const res = await reject(ctx, 'Recusa sem troca.');
    expect(res.body).toEqual({ events: 0 });
    await drain(t);
    expect(await account(ctx)).toMatchObject({
      status: 'APPROVED',
      rejectionReason: null,
      lastRejectedPayoutChange: null,
    });
    expect(await notesOf(ctx.owner, 'MERCHANT_ACCOUNT_REJECTED')).toBe(0);
    expect(await notesOf(ctx.owner, 'MERCHANT_PAYOUT_CHANGE_REJECTED')).toBe(0);
    const [fake] = await t.db
      .select()
      .from(fakeGatewayObjects)
      .where(eq(fakeGatewayObjects.id, ctx.providerAccountId));
    expect(fake?.data).toMatchObject({ status: 'APPROVED' });
  });
});

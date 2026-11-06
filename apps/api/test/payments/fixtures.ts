import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import {
  bookings,
  onlineCharges,
  paymentRecords,
  spaceLedgerEntries,
} from '../../src/db/schema/index.js';
import { PaymentJobs } from '../../src/payments/payment-jobs.js';
import { type MemoryPaymentsQueue, PaymentsQueue } from '../../src/payments/payments-queue.js';
import type { SignedUp, TestApp } from '../auth/helpers.js';
import { bearer } from '../bookings/fixtures.js';

// Helpers dos testes do pagamento online (gateway fake, fila em memória).

export type Row = Record<string, unknown>;

/** CPF de teste válido que o fake aprova; o terminado em 0000 o fake recusa. */
export const APPROVED_CPF = '52998224725';
export const REJECTED_CPF = '10000550000';

export const CARD_APPROVE = 'tok_fake_approve_visa_1111';
export const CARD_DECLINE = 'tok_fake_decline_visa_0002';
export const CARD_CHARGEBACK = 'tok_fake_chargeback_visa_0259';

export const queueOf = (t: TestApp) => t.app.get(PaymentsQueue) as MemoryPaymentsQueue;
export const jobsOf = (t: TestApp) => t.app.get(PaymentJobs);

/**
 * Executa a fila (webhooks do fake e o processamento). Sem `withChargebacks`, o chargeback
 * atrasado do cartão de teste fica na fila.
 */
export const drain = (t: TestApp, { withChargebacks = false } = {}) =>
  queueOf(t).drain((job) => withChargebacks || job.name !== 'fake.chargeback');

export const merchantBody = (document = APPROVED_CPF) => ({
  documentType: 'CPF',
  document,
  legalName: 'Fulano de Tal',
  responsibleName: 'Fulano de Tal',
  email: 'fulano@example.com',
  phone: '+5531999990000',
  address: {
    postalCode: '30110000',
    street: 'Rua A',
    number: '10',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
  },
  payout: {
    kind: 'BANK_ACCOUNT',
    bankCode: '341',
    agency: '1234',
    account: '123456',
    accountDigit: '7',
    accountType: 'CHECKING',
  },
  acceptTerms: true,
});

const manage = (spaceId: string, path: string) =>
  `/v1/manage/spaces/${spaceId}/online-payments/${path}`;

export { manage as onlinePath };

/** Cadastro aprovado pelo fake (envio + aprovação automática pela fila). */
export async function approveMerchant(t: TestApp, owner: SignedUp, spaceId: string) {
  await t
    .http()
    .put(manage(spaceId, 'merchant-account'))
    .set(...bearer(owner))
    .send(merchantBody())
    .expect(200);
  await drain(t);
  const res = await t
    .http()
    .get(manage(spaceId, 'merchant-account'))
    .set(...bearer(owner))
    .expect(200);
  expect(res.body.status).toBe('APPROVED');
}

export async function setModes(
  t: TestApp,
  owner: SignedUp,
  spaceId: string,
  bookingMode: string,
  classMode = 'ON_SITE',
) {
  await t
    .http()
    .put(manage(spaceId, 'settings'))
    .set(...bearer(owner))
    .send({ bookingMode, classMode })
    .expect(200);
}

/** Paga o Pix pelo simulador (Super) e entrega os webhooks. */
export async function payPix(t: TestApp, superUser: SignedUp, chargeId: string) {
  await t
    .http()
    .post(`/v1/super/online-payments/simulator/charges/${chargeId}/pay`)
    .set(...bearer(superUser))
    .expect(200);
  await drain(t);
}

export async function chargeRow(t: TestApp, id: string) {
  const [row] = await t.db.select().from(onlineCharges).where(eq(onlineCharges.id, id));
  if (!row) throw new Error('Cobrança não encontrada.');
  return row;
}

export async function bookingRow(t: TestApp, id: string) {
  const [row] = await t.db.select().from(bookings).where(eq(bookings.id, id));
  if (!row) throw new Error('Reserva não encontrada.');
  return row;
}

export const recordsOf = (t: TestApp, chargeId: string) =>
  t.db.select().from(paymentRecords).where(eq(paymentRecords.onlineChargeId, chargeId));

export const ledgerOf = (t: TestApp, spaceId: string, chargeId?: string) =>
  t.db
    .select()
    .from(spaceLedgerEntries)
    .where(
      and(
        eq(spaceLedgerEntries.spaceId, spaceId),
        chargeId ? eq(spaceLedgerEntries.chargeId, chargeId) : undefined,
      ),
    );

/** Soma do livro-razão do espaço (saldo da subconta). */
export async function ledgerTotal(t: TestApp, spaceId: string) {
  const rows = await ledgerOf(t, spaceId);
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

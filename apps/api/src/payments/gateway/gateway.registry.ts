import type { PaymentEnvironment } from '@space-sports/shared';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { FakePaymentGateway } from '../gateways/fake/fake-gateway.js';
import type { PaymentsQueue } from '../payments-queue.js';
import type { PaymentGateway } from './payment-gateway.js';

/** Token do gateway em uso; `null` com `PAYMENTS_PROVIDER=none` (pagamento online desligado). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Registro dos adaptadores por `PAYMENTS_PROVIDER` (decisão 80). Provedor real: novo `case`. */
export function createPaymentGateway(
  env: Env,
  db: Database,
  queue: PaymentsQueue,
): PaymentGateway | null {
  switch (env.PAYMENTS_PROVIDER) {
    case 'fake':
      return new FakePaymentGateway(db, queue, {
        webhookSecret: env.PAYMENTS_FAKE_WEBHOOK_SECRET,
        webhookUrl: env.PAYMENTS_FAKE_WEBHOOK_URL,
        approvalDelayMs: env.PAYMENTS_FAKE_APPROVAL_DELAY_MS,
        chargebackDelayMs: env.PAYMENTS_FAKE_CHARGEBACK_DELAY_MS,
        pixReleaseDays: env.PAYMENTS_FAKE_PIX_RELEASE_DAYS,
        cardReleaseDays: env.PAYMENTS_FAKE_CARD_RELEASE_DAYS,
        pixCostBps: env.PAYMENTS_FAKE_PIX_COST_BPS,
        cardCostBps: env.PAYMENTS_FAKE_CARD_COST_BPS,
        cardCostFixedCents: env.PAYMENTS_FAKE_CARD_COST_FIXED_CENTS,
      });
    case 'none':
      return null;
  }
}

/** Ambiente de pagamento nas respostas (decisão 92): provedor e, com o fake, as dicas de teste. */
export function paymentEnvironmentOf(gateway: PaymentGateway | null): PaymentEnvironment {
  return {
    provider: gateway?.provider ?? 'none',
    enabled: gateway !== null,
    sandbox: gateway?.sandbox ?? null,
  };
}

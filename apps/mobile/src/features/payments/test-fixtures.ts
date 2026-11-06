import type {
  MyPaymentDetail,
  MyPaymentPageItemsItem,
  PlayerOnlineCharge,
} from '@space-sports/api-client';

export const SANDBOX_ENV = {
  provider: 'fake',
  enabled: true,
  sandbox: {
    label: 'Ambiente de teste',
    testCards: [
      {
        label: 'Aprova',
        number: '4111111111111111',
        outcome: 'APPROVED',
        holderName: 'Maria S Oliveira',
        expiry: '08/29',
        cvc: '123',
        description: 'Aprovado na hora',
      },
      {
        label: 'Recusa',
        number: '4000000000000002',
        outcome: 'DECLINED',
        holderName: 'Maria S Oliveira',
        expiry: '08/29',
        cvc: '123',
        description: 'Recusado pelo banco',
      },
    ],
    rejectedDocument: { suffix: '0000', examples: [] },
    notes: [],
  },
} as unknown as PlayerOnlineCharge['paymentEnvironment'];

export const NONE_ENV = {
  provider: 'none',
  enabled: false,
  sandbox: null,
} as PlayerOnlineCharge['paymentEnvironment'];

/** Pix de R$ 120,00 da reserva b1, criado às 18:32 e válido até 18:47 (São Paulo). */
export function pixCharge(extra: Partial<PlayerOnlineCharge> = {}): PlayerOnlineCharge {
  return {
    id: 'oc1',
    payableType: 'BOOKING',
    payableId: 'b1',
    method: 'PIX',
    status: 'PENDING',
    amountCents: 12_000,
    refundedCents: 0,
    pix: {
      copyPaste: '00020126580014br.gov.bcb.pix0136fake-pix-code5204000053039865406120.00',
      qrSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="currentColor"/></svg>',
      expiresAt: '2026-11-08T21:47:00.000Z',
    },
    cardBrand: null,
    cardLast4: null,
    expiresAt: '2026-11-08T21:47:00.000Z',
    paidAt: null,
    failureCode: null,
    failureReason: null,
    paymentEnvironment: SANDBOX_ENV,
    serverTime: '2026-11-08T21:32:00.000Z',
    createdAt: '2026-11-08T21:32:00.000Z',
    ...extra,
  };
}

export function cardCharge(extra: Partial<PlayerOnlineCharge> = {}): PlayerOnlineCharge {
  return pixCharge({
    id: 'oc2',
    method: 'CARD',
    pix: null,
    expiresAt: null,
    cardBrand: 'visa',
    cardLast4: '1111',
    status: 'PAID',
    paidAt: '2026-11-08T21:42:00.000Z',
    ...extra,
  });
}

export function myPayment(extra: Partial<MyPaymentPageItemsItem> = {}): MyPaymentPageItemsItem {
  return {
    id: 'oc1',
    status: 'PAID',
    method: 'PIX',
    amountCents: 12_000,
    refundedCents: 0,
    space: { id: 's1', name: 'Arena Beira-Mar', slug: 'arena-beira-mar' },
    item: {
      type: 'BOOKING',
      id: 'b1',
      title: 'Quadra 1 · Beach Tennis',
      startsAt: '2026-11-08T21:00:00.000Z',
      periodStart: null,
      subscriptionId: null,
    },
    cardBrand: null,
    cardLast4: null,
    paidAt: '2026-11-08T21:42:00.000Z',
    createdAt: '2026-11-08T21:32:00.000Z',
    refunds: [],
    ...extra,
  };
}

export function myPaymentDetail(extra: Partial<MyPaymentDetail> = {}): MyPaymentDetail {
  return {
    ...myPayment(),
    transactionId: 'a8f3c0d1e2f3a4b591c2',
    pix: null,
    expiresAt: '2026-11-08T21:47:00.000Z',
    failureCode: null,
    failureReason: null,
    paymentEnvironment: SANDBOX_ENV,
    serverTime: '2026-11-09T12:00:00.000Z',
    payerName: 'Maria Oliveira',
    refunds: [],
    ...extra,
  } as MyPaymentDetail;
}

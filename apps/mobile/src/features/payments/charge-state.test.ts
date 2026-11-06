import {
  type BookingContext,
  bookingPayableKind,
  type ChargeViewInput,
  deriveChargeView,
  needsNewPix,
} from './charge-state';
import { cardCharge, pixCharge } from './test-fixtures';

const pendingBooking: BookingContext = {
  status: 'PENDING_PAYMENT',
  cancelReason: null,
  paymentDueAt: '2026-11-08T21:47:00.000Z',
  fullyPaid: false,
};

const input = (extra: Partial<ChargeViewInput> = {}): ChargeViewInput => ({
  mode: 'pix',
  kind: 'required',
  charge: pixCharge(),
  booking: pendingBooking,
  remainingMs: 10 * 60_000,
  creating: false,
  createError: null,
  submittedCardIds: [],
  ...extra,
});

describe('tipo do item (RN-ONPAY-02)', () => {
  it('aguardando pagamento ou cancelada pelo prazo = obrigatória; confirmada = opcional', () => {
    expect(
      bookingPayableKind({ status: 'PENDING_PAYMENT', cancelReason: null, paymentDueAt: 'x' }),
    ).toBe('required');
    expect(
      bookingPayableKind({
        status: 'CANCELLED',
        cancelReason: 'PAYMENT_EXPIRED',
        paymentDueAt: null,
      }),
    ).toBe('required');
    expect(
      bookingPayableKind({ status: 'CONFIRMED', cancelReason: null, paymentDueAt: null }),
    ).toBe('optional');
  });
});

describe('retomar a cobrança aberta (docs/05, "Sair e voltar")', () => {
  it('Pix pendente no prazo: a mesma tela, com o mesmo código, sem gerar outro', () => {
    const view = deriveChargeView(input());
    expect(view).toEqual({ screen: 'pix', charge: pixCharge(), checking: false });
    expect(needsNewPix(input())).toBe(false);
  });

  it('pendente de verificação (sem o QR ainda): espera, não cria outra', () => {
    const verifying = input({ charge: pixCharge({ pix: null }) });
    expect(deriveChargeView(verifying).screen).toBe('generating');
    expect(needsNewPix(verifying)).toBe(false);
  });

  it('sem cobrança (ou a última recusada/cancelada): a tela do Pix gera uma', () => {
    expect(needsNewPix(input({ charge: null }))).toBe(true);
    expect(needsNewPix(input({ charge: cardCharge({ status: 'FAILED', paidAt: null }) }))).toBe(
      true,
    );
    expect(needsNewPix(input({ charge: pixCharge({ status: 'CANCELLED' }) }))).toBe(true);
  });

  it('carregando a cobrança: nem tela nem criação', () => {
    expect(deriveChargeView(input({ charge: undefined })).screen).toBe('loading');
    expect(needsNewPix(input({ charge: undefined }))).toBe(false);
  });

  it('erro ao gerar: estado de erro e nada de criar sozinho de novo', () => {
    const failed = input({ charge: null, createError: 'Confira a internet e tente de novo.' });
    expect(deriveChargeView(failed)).toEqual({
      screen: 'error',
      message: 'Confira a internet e tente de novo.',
    });
    expect(needsNewPix(failed)).toBe(false);
  });
});

describe('contagem e vencimento do Pix', () => {
  it('contagem em zero mostra "Conferindo…" antes de dizer que venceu', () => {
    expect(deriveChargeView(input({ remainingMs: 0 }))).toMatchObject({
      screen: 'pix',
      checking: true,
    });
  });

  it('obrigatória cancelada pelo prazo: "O prazo para pagar acabou"', () => {
    const view = deriveChargeView(
      input({
        charge: pixCharge({ status: 'EXPIRED' }),
        booking: { ...pendingBooking, status: 'CANCELLED', cancelReason: 'PAYMENT_EXPIRED' },
        remainingMs: 0,
      }),
    );
    expect(view.screen).toBe('hold-expired');
  });

  it('obrigatória com o hold zerado e o Pix já vencido: prazo acabou', () => {
    expect(
      deriveChargeView(input({ charge: pixCharge({ status: 'EXPIRED' }), remainingMs: 0 })).screen,
    ).toBe('hold-expired');
  });

  it('opcional e mensalidade: "Este Pix venceu", com gerar outro', () => {
    const optional = input({
      kind: 'optional',
      charge: pixCharge({ status: 'EXPIRED' }),
      booking: { ...pendingBooking, status: 'CONFIRMED', paymentDueAt: null },
      remainingMs: null,
    });
    expect(deriveChargeView(optional).screen).toBe('pix-expired');
    expect(needsNewPix(optional)).toBe(false);
    expect(deriveChargeView({ ...optional, kind: 'subscription', booking: null }).screen).toBe(
      'pix-expired',
    );
  });

  it('pago: confirmado (vale também para o cartão)', () => {
    expect(
      deriveChargeView(input({ charge: pixCharge({ status: 'PAID', paidAt: 'x' }) })).screen,
    ).toBe('paid');
    expect(deriveChargeView(input({ mode: 'card', charge: cardCharge() })).screen).toBe('paid');
  });

  it('pago depois do prazo: o motivo vem do reasonCode do estorno (decisão 96)', () => {
    const late = deriveChargeView(
      input({
        charge: pixCharge({ status: 'EXPIRED', paidAt: '2026-11-08T21:48:00.000Z' }),
        booking: { ...pendingBooking, status: 'CANCELLED', cancelReason: 'PAYMENT_EXPIRED' },
        refunds: [{ reasonCode: 'PAID_AFTER_DEADLINE' }],
      }),
    );
    expect(late).toMatchObject({
      screen: 'late-refund',
      reason: 'PAID_AFTER_DEADLINE',
      bookingCancelled: true,
    });
    const replaced = deriveChargeView(
      input({
        kind: 'optional',
        charge: pixCharge({ status: 'CANCELLED', paidAt: '2026-11-08T21:40:00.000Z' }),
        booking: { ...pendingBooking, status: 'CONFIRMED', paymentDueAt: null },
        refunds: [{ reasonCode: 'PAID_AFTER_METHOD_CHANGE' }],
      }),
    );
    expect(replaced).toMatchObject({ screen: 'late-refund', reason: 'PAID_AFTER_METHOD_CHANGE' });
  });

  it('estornada com motivo automático (cobrança que chegou a PAID): também é o estornado sozinho', () => {
    expect(
      deriveChargeView(
        input({
          kind: 'optional',
          charge: pixCharge({ status: 'REFUNDED', paidAt: 'x', refundedCents: 12_000 }),
          booking: { ...pendingBooking, status: 'CONFIRMED', paymentDueAt: null },
          refunds: [{ reasonCode: 'ITEM_ALREADY_PAID' }],
        }),
      ),
    ).toMatchObject({ screen: 'late-refund', reason: 'ITEM_ALREADY_PAID' });
  });

  it('estornada pelo cancelamento (motivo não automático): estornado, não "chegou atrasado"', () => {
    expect(
      deriveChargeView(
        input({
          charge: pixCharge({ status: 'REFUNDED', paidAt: 'x', refundedCents: 12_000 }),
          booking: { ...pendingBooking, status: 'CANCELLED', cancelReason: 'PAYMENT_EXPIRED' },
          refunds: [{ reasonCode: 'BOOKING_CANCELLED_BY_PLAYER' }],
        }),
      ).screen,
    ).toBe('refunded');
  });

  it('paga e fechada: espera os estornos antes de decidir; sem estorno ainda, avisa que volta', () => {
    const closed = input({
      charge: pixCharge({ status: 'EXPIRED', paidAt: 'x' }),
      refunds: undefined,
    });
    expect(deriveChargeView(closed).screen).toBe('loading');
    expect(deriveChargeView({ ...closed, refunds: [] })).toMatchObject({
      screen: 'late-refund',
      reason: null,
    });
  });

  it('quitada no local: nada a pagar', () => {
    expect(
      deriveChargeView(
        input({
          kind: 'optional',
          charge: null,
          booking: { ...pendingBooking, status: 'CONFIRMED', fullyPaid: true },
        }),
      ).screen,
    ).toBe('nothing-due');
  });
});

describe('cartão', () => {
  it('formulário sem recusa quando não há tentativa nesta tela', () => {
    const failed = cardCharge({ status: 'FAILED', paidAt: null, failureReason: 'Saldo' });
    expect(deriveChargeView(input({ mode: 'card', charge: failed }))).toEqual({
      screen: 'card-form',
      declined: null,
    });
  });

  it('recusado na tentativa desta tela: alerta e nova tentativa dentro do prazo', () => {
    const failed = cardCharge({ status: 'FAILED', paidAt: null });
    expect(
      deriveChargeView(input({ mode: 'card', charge: failed, submittedCardIds: ['oc2'] })),
    ).toEqual({ screen: 'card-form', declined: failed });
  });

  it('em processamento: espera a resposta', () => {
    const pending = cardCharge({ status: 'PENDING', paidAt: null });
    expect(deriveChargeView(input({ mode: 'card', charge: pending })).screen).toBe('processing');
  });

  it('com Pix aberto, escolher cartão mostra o formulário (a troca cancela o Pix na API)', () => {
    expect(deriveChargeView(input({ mode: 'card' })).screen).toBe('card-form');
  });

  it('recusado com o hold vencido: prazo acabou', () => {
    const failed = cardCharge({ status: 'FAILED', paidAt: null });
    expect(
      deriveChargeView(
        input({ mode: 'card', charge: failed, remainingMs: 0, submittedCardIds: ['oc2'] }),
      ).screen,
    ).toBe('hold-expired');
  });
});

describe('sempre um estado final (revisão da PG.4)', () => {
  it('mensalidade quitada, dispensada ou sem saldo: nada a pagar, sem gerar Pix', () => {
    const paidSubscription = input({
      kind: 'subscription',
      booking: null,
      charge: null,
      settled: true,
    });
    expect(deriveChargeView(paidSubscription).screen).toBe('nothing-due');
    expect(needsNewPix(paidSubscription)).toBe(false);
    expect(deriveChargeView({ ...paidSubscription, mode: 'card' }).screen).toBe('nothing-due');
  });

  it('a cobrança paga vence o "nada a pagar" (mostra o confirmado)', () => {
    expect(
      deriveChargeView(input({ charge: pixCharge({ status: 'PAID', paidAt: 'x' }), settled: true }))
        .screen,
    ).toBe('paid');
  });

  it('Pix cancelado depois da geração automática: estado final, não "Gerando…"', () => {
    const closed = input({
      kind: 'optional',
      booking: { ...pendingBooking, status: 'CONFIRMED', paymentDueAt: null },
      charge: pixCharge({ status: 'CANCELLED' }),
      autoCreateUsed: true,
      remainingMs: null,
    });
    expect(deriveChargeView(closed).screen).toBe('pix-closed');
    expect(needsNewPix(closed)).toBe(false);
  });

  it('cartão enviado e cancelado sem cobrar: o formulário avisa que não concluiu', () => {
    const cancelled = cardCharge({ status: 'CANCELLED', paidAt: null });
    expect(
      deriveChargeView(input({ mode: 'card', charge: cancelled, submittedCardIds: ['oc2'] })),
    ).toEqual({ screen: 'card-form', declined: null, interrupted: true });
  });
});

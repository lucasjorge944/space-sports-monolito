import {
  automaticRefundNote,
  filterStatuses,
  groupByMonth,
  monthTitle,
  paymentSubtitle,
  paymentTitle,
} from './my-payments';
import { myPayment } from './test-fixtures';

describe('Meus pagamentos (RF-ONPAY-06)', () => {
  it('os filtros vão para a API como status', () => {
    expect(filterStatuses('all')).toBeUndefined();
    expect(filterStatuses('paid')).toEqual(['PAID', 'PARTIALLY_REFUNDED']);
    expect(filterStatuses('refunds')).toEqual(['PARTIALLY_REFUNDED', 'REFUNDED']);
    expect(filterStatuses('pending')).toEqual(['PENDING']);
  });

  it('título e linha: reserva com o dia do jogo; mensalidade com o mês e o dia do pagamento', () => {
    const reserva = myPayment();
    expect(paymentTitle(reserva)).toBe('Reserva · Arena Beira-Mar');
    expect(paymentSubtitle(reserva)).toBe('Dom, 08/11 · Pix');
    const mensalidade = myPayment({
      method: 'CARD',
      cardLast4: '1111',
      paidAt: '2026-11-05T13:00:00.000Z',
      item: {
        type: 'SUBSCRIPTION_CHARGE',
        id: 'c1',
        title: 'Plano 2x',
        startsAt: null,
        periodStart: '2026-11-01',
        subscriptionId: 's1',
      },
    });
    expect(paymentTitle(mensalidade)).toBe('Mensalidade nov · Arena Beira-Mar');
    expect(paymentSubtitle(mensalidade)).toBe('05/11 · Cartão');
  });

  it('agrupa por mês (em São Paulo), marcando o primeiro e o último de cada grupo', () => {
    // 00:30 UTC de 01/11 ainda é outubro em São Paulo.
    expect(monthTitle('2026-11-01T00:30:00.000Z')).toBe('Outubro de 2026');
    const rows = groupByMonth([
      myPayment({ id: 'a', createdAt: '2026-11-08T21:32:00.000Z' }),
      myPayment({ id: 'b', createdAt: '2026-11-05T12:00:00.000Z' }),
      myPayment({ id: 'c', createdAt: '2026-10-20T12:00:00.000Z' }),
    ]);
    expect(
      rows.map((r) => (r.kind === 'header' ? r.title : `${r.key}:${r.first}:${r.last}`)),
    ).toEqual([
      'Novembro de 2026',
      'a:true:false',
      'b:false:true',
      'Outubro de 2026',
      'c:true:true',
    ]);
  });

  it('a lista mostra o motivo dos estornos automáticos (reasonCode), não o manual', () => {
    const refund = (reasonCode: string, reason: string | null = null) =>
      ({
        id: reasonCode,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        amountCents: 12_000,
        reason,
        reasonCode,
        createdAt: '2026-11-09T12:00:00.000Z',
      }) as never;
    expect(automaticRefundNote(myPayment({ refunds: [refund('PAID_AFTER_DEADLINE')] }))).toBe(
      'Estorno automático: o pagamento chegou depois do prazo',
    );
    expect(automaticRefundNote(myPayment({ refunds: [refund('MANUAL', 'Chuva')] }))).toBeNull();
    expect(automaticRefundNote(myPayment())).toBeNull();
  });
});

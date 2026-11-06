import { pushTarget } from './push-route';

const id = '0192f0a0-0000-7000-8000-000000000001';

describe('pushTarget', () => {
  it('abre a reserva', () => {
    expect(pushTarget({ bookingId: id, spaceId: 'x' })).toEqual({
      pathname: '/reserva/[id]',
      params: { id },
    });
  });
  it('abre a reserva vinculada à conta nova (BOOKING_LINKED)', () => {
    expect(pushTarget({ bookingId: id, spaceId: 'x' })?.pathname).toBe('/reserva/[id]');
  });
  it('convite pendente abre o convite, não a reserva que a pessoa ainda não vê', () => {
    expect(pushTarget({ bookingId: id, spaceId: 'x', inviteToken: 'tok12345678' })).toEqual({
      pathname: '/convite/[token]',
      params: { token: 'tok12345678' },
    });
  });
  it('token de convite suspeito cai na reserva', () => {
    expect(pushTarget({ bookingId: id, inviteToken: '../../admin/x1' })?.pathname).toBe(
      '/reserva/[id]',
    );
  });
  it('abre o mensalista', () => {
    expect(pushTarget({ recurringBookingId: id })).toEqual({
      pathname: '/mensalistas/[id]',
      params: { id },
    });
  });
  it('abre a aula da notificação de lista aberta, promoção ou cancelamento', () => {
    expect(pushTarget({ classSessionId: id, spaceId: 'x' })).toEqual({
      pathname: '/aulas/[id]',
      params: { id },
    });
  });
  it('abre o plano da notificação de assinatura ou mensalidade', () => {
    expect(pushTarget({ subscriptionId: id, spaceId: 'x', chargeId: 'c' })).toEqual({
      pathname: '/planos/[id]',
      params: { id },
    });
  });
  it('ignora dados desconhecidos ou suspeitos', () => {
    expect(pushTarget(null)).toBeNull();
    expect(pushTarget({})).toBeNull();
    expect(pushTarget({ bookingId: '../../etc' })).toBeNull();
    expect(pushTarget({ bookingId: 42 })).toBeNull();
    expect(pushTarget({ classSessionId: '../x' })).toBeNull();
    expect(pushTarget({ subscriptionId: 7 })).toBeNull();
  });
  it('estorno abre o comprovante em Meus pagamentos (PAYMENT_REFUNDED)', () => {
    expect(pushTarget({ onlineChargeId: id, refundId: 'r1', bookingId: id, spaceId: 'x' })).toEqual(
      {
        pathname: '/meus-pagamentos/[id]',
        params: { id },
      },
    );
  });
  it('pagamento confirmado abre a reserva ou o plano', () => {
    expect(pushTarget({ onlineChargeId: id, bookingId: id })?.pathname).toBe('/reserva/[id]');
    expect(pushTarget({ onlineChargeId: id, subscriptionId: id, chargeId: id })?.pathname).toBe(
      '/planos/[id]',
    );
  });

  it('pedido de avaliação abre a tela de avaliar do espaço (REVIEW_REQUEST)', () => {
    expect(
      pushTarget({ spaceId: id, slug: 'arena-sol', source: 'BOOKING', sourceId: id, promptId: id }),
    ).toEqual({ pathname: '/espaco/[slug]/avaliar', params: { slug: 'arena-sol' } });
  });
  it('resposta do espaço abre a avaliação na lista (REVIEW_REPLIED)', () => {
    expect(pushTarget({ spaceId: id, slug: 'arena-sol', reviewId: id })).toEqual({
      pathname: '/espaco/[slug]/avaliacoes',
      params: { slug: 'arena-sol', avaliacao: id },
    });
  });
  it('avaliação nova da gestão (REVIEW_CREATED) e slug suspeito não navegam', () => {
    expect(pushTarget({ spaceId: id, reviewId: id })).toBeNull();
    expect(pushTarget({ slug: '../admin', promptId: id })).toBeNull();
  });
});

import { isValidInviteToken } from '@/features/invites/pending-invite';
import { isValidSpaceSlug } from '@/features/space/pending-space';

/** Rota a abrir quando a pessoa toca numa notificação (dados enviados pela API em `data`). */
export type PushTarget =
  | { pathname: '/convite/[token]'; params: { token: string } }
  | { pathname: '/reserva/[id]'; params: { id: string } }
  | { pathname: '/mensalistas/[id]'; params: { id: string } }
  | { pathname: '/aulas/[id]'; params: { id: string } }
  | { pathname: '/planos/[id]'; params: { id: string } }
  | { pathname: '/meus-pagamentos/[id]'; params: { id: string } }
  | { pathname: '/espaco/[slug]/avaliar'; params: { slug: string } }
  | { pathname: '/espaco/[slug]/avaliacoes'; params: { slug: string; avaliacao: string } };

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function pushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const {
    inviteToken,
    bookingId,
    recurringBookingId,
    classSessionId,
    subscriptionId,
    onlineChargeId,
    refundId,
    slug,
    promptId,
    reviewId,
  } = data as Record<string, unknown>;
  // Avaliações (docs/05, "Notificações e textos"): o pedido (`REVIEW_REQUEST`, com `promptId`)
  // abre a tela de avaliar; a resposta do espaço (`REVIEW_REPLIED`, com `slug` e `reviewId`) abre a
  // avaliação na lista do espaço. `REVIEW_CREATED` (gestão, sem `slug`) só fica na central.
  if (typeof slug === 'string' && isValidSpaceSlug(slug)) {
    if (typeof promptId === 'string') {
      return { pathname: '/espaco/[slug]/avaliar', params: { slug } };
    }
    if (typeof reviewId === 'string' && ID_PATTERN.test(reviewId)) {
      return { pathname: '/espaco/[slug]/avaliacoes', params: { slug, avaliacao: reviewId } };
    }
  }
  // `BOOKING_INVITE` traz também o `bookingId`, mas quem não aceitou ainda não vê a reserva.
  if (typeof inviteToken === 'string' && isValidInviteToken(inviteToken)) {
    return { pathname: '/convite/[token]', params: { token: inviteToken } };
  }
  // Estorno (PAYMENT_REFUNDED, docs/05 "App — notificações"): abre o comprovante.
  if (
    typeof refundId === 'string' &&
    typeof onlineChargeId === 'string' &&
    ID_PATTERN.test(onlineChargeId)
  ) {
    return { pathname: '/meus-pagamentos/[id]', params: { id: onlineChargeId } };
  }
  if (typeof bookingId === 'string' && ID_PATTERN.test(bookingId)) {
    return { pathname: '/reserva/[id]', params: { id: bookingId } };
  }
  if (typeof recurringBookingId === 'string' && ID_PATTERN.test(recurringBookingId)) {
    return { pathname: '/mensalistas/[id]', params: { id: recurringBookingId } };
  }
  // Aula (lista aberta, promovido da espera, cancelada) e assinatura (aprovada, recusada, mensalidade).
  if (typeof classSessionId === 'string' && ID_PATTERN.test(classSessionId)) {
    return { pathname: '/aulas/[id]', params: { id: classSessionId } };
  }
  if (typeof subscriptionId === 'string' && ID_PATTERN.test(subscriptionId)) {
    return { pathname: '/planos/[id]', params: { id: subscriptionId } };
  }
  return null;
}

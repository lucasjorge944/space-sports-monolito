import type { PaymentOption, PublicSpace } from '@space-sports/api-client';
import { canTokenizeCard } from './card-form';

/** Ordem da tela (docs/05, princípio 3): Pix primeiro, depois cartão, "No local" por último. */
const ORDER: PaymentOption[] = ['ONLINE_PIX', 'ONLINE_CARD', 'ON_SITE'];

export type OnlineOption = Exclude<PaymentOption, 'ON_SITE'>;

type SpacePayments = Partial<Pick<PublicSpace, 'onlinePayments' | 'paymentEnvironment'>>;

/** Formas online oferecidas, menos o cartão quando o app não consegue gerar o token. */
function usable(options: readonly string[], space: SpacePayments): OnlineOption[] {
  return ORDER.filter(
    (o): o is OnlineOption =>
      o !== 'ON_SITE' &&
      options.includes(o) &&
      (o !== 'ONLINE_CARD' || canTokenizeCard(space.paymentEnvironment)),
  );
}

export interface BookingPaymentChoices {
  /** Modo do espaço para reservas, como a API informa (já `ON_SITE` com o online desligado). */
  mode: 'ON_SITE' | 'ONLINE_OPTIONAL' | 'ONLINE_REQUIRED';
  /** Opções da etapa, na ordem da tela. */
  options: PaymentOption[];
  /** A etapa "Como você quer pagar?" aparece (há alguma forma online). */
  online: boolean;
}

/**
 * Formas da etapa de pagamento da reserva (RF-ONPAY-03): o que o espaço oferece no aluguel. Reserva
 * gratuita não tem o que pagar online (a API grava `ON_SITE`).
 */
export function bookingPaymentChoices(
  space: SpacePayments,
  priceCents: number,
): BookingPaymentChoices {
  const rental = space.onlinePayments?.rental;
  const mode = rental?.mode ?? 'ON_SITE';
  const offered = new Set<PaymentOption>(rental?.options ?? ['ON_SITE']);
  // Cartão só com o tokenizador do ambiente: sem ele, nada de deixar digitar para depois recusar.
  if (!canTokenizeCard(space.paymentEnvironment)) offered.delete('ONLINE_CARD');
  if (mode === 'ON_SITE' || priceCents === 0) {
    return { mode: 'ON_SITE', options: ['ON_SITE'], online: false };
  }
  // No obrigatório não existe "No local" (RN-ONPAY-02), mesmo se a API o listasse.
  if (mode === 'ONLINE_REQUIRED') offered.delete('ON_SITE');
  const options = ORDER.filter((option) => offered.has(option));
  return { mode, options, online: options.some((o) => o !== 'ON_SITE') };
}

/** Pré-seleção: Pix (ou o único meio, se só houver um). */
export function defaultPaymentOption(options: PaymentOption[]): PaymentOption | null {
  if (options.includes('ONLINE_PIX')) return 'ONLINE_PIX';
  return options[0] ?? null;
}

/** Formas online das mensalidades (RF-ONPAY-05): só no modo `ONLINE_OPTIONAL`. */
export function classOnlineOptions(space: SpacePayments | undefined): OnlineOption[] {
  const classes = space?.onlinePayments?.classes;
  if (!space || classes?.mode !== 'ONLINE_OPTIONAL') return [];
  return usable(classes.options, space);
}

/** Formas online da reserva já criada (a folha "Pagar"): sem "No local". */
export function bookingOnlineOptions(space: SpacePayments | undefined): OnlineOption[] {
  const rental = space?.onlinePayments?.rental;
  if (!space || !rental || rental.mode === 'ON_SITE') return [];
  return usable(rental.options, space);
}

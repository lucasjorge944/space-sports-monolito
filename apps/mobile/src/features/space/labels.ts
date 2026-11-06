import type { PaymentMethod } from '@space-sports/api-client';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
  OTHER: 'Outra forma',
};

export const SERVICE_TAB_LABELS = {
  RENTAL: 'Alugar',
  CLASSES: 'Aulas',
  TOURNAMENTS: 'Torneios',
} as const;

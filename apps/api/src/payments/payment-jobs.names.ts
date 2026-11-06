/** Nomes dos jobs da fila `payments` (os do adaptador vêm dele, ex.: `fake.*`). */
export const PAYMENT_JOBS = {
  /** Processa um webhook gravado em `gateway_events`. */
  processEvent: 'payments.process-event',
  /** A cada minuto: vence reservas `PENDING_PAYMENT` e cobranças Pix (RN-ONPAY-02). */
  expire: 'payments.expire',
  /** A cada 10 minutos: reconciliação com o gateway (RN-ONPAY-07), inclusive dos cadastros. */
  reconcile: 'payments.reconcile',
} as const;

export const PAYMENTS_QUEUE = 'payments';

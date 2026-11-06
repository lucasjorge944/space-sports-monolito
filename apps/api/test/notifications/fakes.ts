import {
  MemoryNotificationQueue,
  NotificationQueue,
} from '../../src/notifications/notification-queue.js';
import { PushDeliveryService } from '../../src/notifications/push-delivery.service.js';
import {
  type PushMessage,
  type PushReceipt,
  PushSender,
  type PushTicket,
} from '../../src/notifications/push-sender.js';
import { createTestApp, type TestApp } from '../auth/helpers.js';

/** Expo falso: registra o que foi enviado e responde `ok`, salvo tokens configurados. */
export class FakePushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  /** Tokens que o Expo recusa no ticket (token → erro). */
  readonly ticketErrors = new Map<string, string>();
  /** Tokens cujo recibo vem com erro (token → erro). */
  readonly receiptErrors = new Map<string, string>();
  /** Liga uma falha de transporte (rede/5xx) no próximo envio. */
  failTransport = false;
  private readonly tokenByTicket = new Map<string, string>();

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failTransport) throw new Error('Expo Push respondeu 503.');
    this.sent.push(...messages);
    return messages.map((message, i): PushTicket => {
      const error = this.ticketErrors.get(message.to);
      if (error) return { status: 'error', error };
      const id = `ticket-${this.sent.length}-${i}`;
      this.tokenByTicket.set(id, message.to);
      return { status: 'ok', id };
    });
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const result: Record<string, PushReceipt> = {};
    for (const id of ticketIds) {
      const token = this.tokenByTicket.get(id);
      const error = token ? this.receiptErrors.get(token) : undefined;
      result[id] = error ? { status: 'error', error } : { status: 'ok' };
    }
    return result;
  }
}

export type NotificationsTestApp = TestApp & {
  push: FakePushSender;
  queue: MemoryNotificationQueue;
  /** Executa os pushes enfileirados (o que o worker do BullMQ faria). */
  flush: () => Promise<void>;
};

export async function createNotificationsApp(
  env: Record<string, string> = {},
): Promise<NotificationsTestApp> {
  const push = new FakePushSender();
  const t = await createTestApp({ env, providers: [{ provide: PushSender, useValue: push }] });
  const queue = t.app.get(NotificationQueue) as MemoryNotificationQueue;
  const delivery = t.app.get(PushDeliveryService);
  return {
    ...t,
    push,
    queue,
    flush: async () => {
      for (let job = queue.pushes.shift(); job; job = queue.pushes.shift()) {
        await delivery.deliver(job);
      }
    },
  };
}

import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Resultado do envio de uma mensagem. `DeviceNotRegistered` = o token não vale mais. */
export type PushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; error: string; message?: string };

/** Resultado da entrega final (consultado minutos depois do envio). */
export type PushReceipt = { status: 'ok' } | { status: 'error'; error: string; message?: string };

export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/**
 * Envio de push. Classe abstrata para servir de token de injeção (e de fake nos testes).
 * Falha de transporte (rede, 5xx, 429) lança; o job do BullMQ tenta de novo. Erros por token
 * voltam nos tickets/recibos.
 */
export abstract class PushSender {
  /** Um ticket por mensagem, na mesma ordem. */
  abstract send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Recibos dos tickets `ok`; ids ainda sem recibo ficam de fora. */
  abstract receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>>;
}

const EXPO_API = 'https://exp.host/--/api/v2/push';
/** Limite do Expo por requisição. */
const BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushSender extends PushSender {
  private readonly logger = new Logger(ExpoPushSender.name);

  constructor(private readonly env: Pick<Env, 'EXPO_ACCESS_TOKEN'>) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const batch of chunks(messages, BATCH)) {
      const data = await this.post<ExpoTicket[]>(
        'send',
        batch.map((m) => ({ ...m, sound: 'default' })),
      );
      if (!Array.isArray(data) || data.length !== batch.length) {
        throw new Error('Resposta do Expo Push fora do formato esperado.');
      }
      tickets.push(...data.map(toTicket));
    }
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const result: Record<string, PushReceipt> = {};
    for (const batch of chunks(ticketIds, BATCH)) {
      const data = await this.post<Record<string, ExpoTicket>>('getReceipts', { ids: batch });
      for (const [id, receipt] of Object.entries(data ?? {})) {
        result[id] = toReceipt(receipt);
      }
    }
    return result;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${EXPO_API}/${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(this.env.EXPO_ACCESS_TOKEN
          ? { authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      this.logger.warn({ status: res.status, path }, 'Expo Push respondeu com erro');
      throw new Error(`Expo Push respondeu ${res.status}.`);
    }
    return ((await res.json()) as { data: T }).data;
  }
}

function toTicket(ticket: ExpoTicket): PushTicket {
  if (ticket.status === 'ok' && ticket.id) return { status: 'ok', id: ticket.id };
  return {
    status: 'error',
    error: ticket.details?.error ?? 'Unknown',
    ...(ticket.message ? { message: ticket.message } : {}),
  };
}

function toReceipt(receipt: ExpoTicket): PushReceipt {
  if (receipt.status === 'ok') return { status: 'ok' };
  return {
    status: 'error',
    error: receipt.details?.error ?? 'Unknown',
    ...(receipt.message ? { message: receipt.message } : {}),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

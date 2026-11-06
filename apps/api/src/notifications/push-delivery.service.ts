import { Inject, Injectable, Logger } from '@nestjs/common';
import { addMinutes } from '@space-sports/shared';
import { eq, inArray, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { devices, pushDeliveries } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { NotificationQueue, type PushJob, type ReceiptsJob } from './notification-queue.js';
import { DEVICE_NOT_REGISTERED, PushSender, type PushTicket } from './push-sender.js';

/** O Expo recomenda consultar os recibos ~15 min depois do envio. */
export const RECEIPTS_DELAY_MS = 15 * 60_000;

/**
 * Por quanto tempo a chave de idempotência do push é guardada. As tentativas do job acabam em
 * minutos; um dia cobre com folga um Redis fora do ar devolvendo o job à fila mais tarde.
 */
export const PUSH_DELIVERY_RETENTION_MIN = 24 * 60;

/**
 * Executa os jobs de push: envia para todos os aparelhos do usuário e apaga os tokens que o
 * Expo declara inválidos (`DeviceNotRegistered`), no ticket ou no recibo. Falha de transporte
 * lança, para o BullMQ repetir o job.
 *
 * Sem push duplicado: antes de enviar, grava a chave do job em `push_deliveries`; se ela já
 * existe, o push já saiu (o job rodou de novo depois de uma falha do Redis, por exemplo) e nada
 * é enviado. Se o envio falha, a chave é apagada para o retry enviar. Depois do envio nada mais
 * lança: limpar tokens e agendar os recibos são complementos, e uma falha deles não pode fazer o
 * BullMQ repetir um push que já foi entregue.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sender: PushSender,
    private readonly queue: NotificationQueue,
  ) {}

  async deliver(job: PushJob): Promise<void> {
    const rows = await this.db
      .select({ token: devices.expoPushToken })
      .from(devices)
      .where(eq(devices.userId, job.userId));
    if (!rows.length) return;
    if (job.id && !(await this.claim(job.id, job.userId))) {
      this.logger.log({ pushId: job.id }, 'Push já enviado; job repetido ignorado');
      return;
    }

    let tickets: PushTicket[];
    try {
      tickets = await this.sender.send(
        rows.map(({ token }) => ({
          to: token,
          title: job.title,
          body: job.body,
          ...(job.data ? { data: job.data } : {}),
        })),
      );
    } catch (err) {
      if (job.id) await this.release(job.id);
      throw err;
    }

    try {
      await this.afterSend(rows, tickets);
    } catch (err) {
      this.logger.error({ err, pushId: job.id }, 'Push enviado; falha ao tratar os tickets');
    }
  }

  private async afterSend(rows: { token: string }[], tickets: PushTicket[]): Promise<void> {
    const invalid: string[] = [];
    const pending: ReceiptsJob['tickets'] = [];
    tickets.forEach((ticket, i) => {
      const token = rows[i]?.token;
      if (!token) return;
      if (ticket.status === 'ok') {
        pending.push({ id: ticket.id, token });
      } else if (ticket.error === DEVICE_NOT_REGISTERED) {
        invalid.push(token);
      } else {
        this.logger.warn({ error: ticket.error, message: ticket.message }, 'Push recusado');
      }
    });
    await this.removeTokens(invalid);
    if (pending.length) {
      await this.queue.enqueueReceipts({ tickets: pending }, RECEIPTS_DELAY_MS);
    }
  }

  /** Grava a chave do push; `false` se ela já existia (push já enviado). */
  private async claim(id: string, userId: string): Promise<boolean> {
    const claimed = await this.db
      .insert(pushDeliveries)
      .values({ id, userId })
      .onConflictDoNothing()
      .returning({ id: pushDeliveries.id });
    return claimed.length > 0;
  }

  /** O envio falhou: libera a chave para a próxima tentativa. Se nem isso der, o push se perde. */
  private async release(id: string): Promise<void> {
    try {
      await this.db.delete(pushDeliveries).where(eq(pushDeliveries.id, id));
    } catch (err) {
      this.logger.error({ err, pushId: id }, 'Falha ao liberar a chave do push');
    }
  }

  /** Apaga as chaves de idempotência antigas (job de manutenção). Devolve quantas. */
  async prune(now: Date = new Date()): Promise<number> {
    const deleted = await this.db
      .delete(pushDeliveries)
      .where(lt(pushDeliveries.createdAt, addMinutes(now, -PUSH_DELIVERY_RETENTION_MIN)))
      .returning({ id: pushDeliveries.id });
    return deleted.length;
  }

  /** Recibos: o `DeviceNotRegistered` costuma aparecer só aqui (o aparelho desinstalou o app). */
  async checkReceipts(job: ReceiptsJob): Promise<void> {
    const receipts = await this.sender.receipts(job.tickets.map((t) => t.id));
    const invalid: string[] = [];
    for (const { id, token } of job.tickets) {
      const receipt = receipts[id];
      if (receipt?.status !== 'error') continue;
      if (receipt.error === DEVICE_NOT_REGISTERED) invalid.push(token);
      else
        this.logger.warn({ error: receipt.error, message: receipt.message }, 'Push não entregue');
    }
    await this.removeTokens(invalid);
  }

  private async removeTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.db.delete(devices).where(inArray(devices.expoPushToken, tokens));
    this.logger.log({ count: tokens.length }, 'Tokens de push inválidos removidos');
  }
}

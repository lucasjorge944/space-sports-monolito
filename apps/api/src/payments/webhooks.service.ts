import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../bookings/db-utils.js';
import type { Database } from '../db/client.js';
import { gatewayEvents } from '../db/schema/index.js';
import { DB } from '../infra/database.module.js';
import { PAYMENT_GATEWAY } from './gateway/gateway.registry.js';
import {
  InvalidWebhookPayload,
  InvalidWebhookSignature,
  type PaymentGateway,
  type WebhookRequest,
} from './gateway/payment-gateway.js';
import { MerchantAccountsService } from './merchant-accounts.service.js';
import { OnlineChargesService } from './online-charges.service.js';
import { PAYMENT_JOBS } from './payment-jobs.names.js';
import {
  webhookPayloadInvalid,
  webhookProviderNotFound,
  webhookSignatureInvalid,
} from './payments.errors.js';
import { PaymentsQueue } from './payments-queue.js';
import { WalletService } from './wallet.service.js';

/** Eventos parados há mais que isso voltam à fila na reconciliação (até 10 tentativas). */
const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 10;

/**
 * Webhooks do gateway (RN-ONPAY-07): assinatura verificada pelo adaptador, evento gravado uma vez
 * (único por provedor e id) e processado na fila. O processamento só pede uma sincronização do
 * objeto no gateway, então duplicados e eventos fora de ordem não mudam o resultado.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly queue: PaymentsQueue,
    private readonly charges: OnlineChargesService,
    private readonly merchants: MerchantAccountsService,
    private readonly wallet: WalletService,
  ) {}

  /** Recebe o webhook; devolve quantos eventos novos entraram na fila. */
  async receive(provider: string, request: WebhookRequest): Promise<{ received: number }> {
    const gateway = this.gateway;
    if (!gateway || gateway.provider !== provider) throw webhookProviderNotFound();
    let events: ReturnType<PaymentGateway['parseWebhook']>;
    try {
      events = gateway.parseWebhook(request);
    } catch (err) {
      if (err instanceof InvalidWebhookSignature) throw webhookSignatureInvalid();
      if (err instanceof InvalidWebhookPayload) throw webhookPayloadInvalid();
      throw err;
    }
    let received = 0;
    for (const event of events) {
      let id: string | undefined;
      try {
        [{ id } = { id: undefined }] = await this.db
          .insert(gatewayEvents)
          .values({
            provider,
            eventId: event.eventId,
            type: event.type,
            payload: { ...event.payload, objectId: event.objectId },
          })
          .onConflictDoNothing({ target: [gatewayEvents.provider, gatewayEvents.eventId] })
          .returning({ id: gatewayEvents.id });
      } catch (err) {
        if (!isUniqueViolation(err, 'gateway_events_provider_event_unique')) throw err;
      }
      if (!id) continue;
      await this.queue.enqueue({
        name: PAYMENT_JOBS.processEvent,
        data: { id },
        jobId: `gateway-event-${id}`,
      });
      received++;
    }
    return { received };
  }

  /** Processa um evento gravado (job da fila). Repetir é inofensivo. */
  async process(id: string): Promise<void> {
    const [event] = await this.db.select().from(gatewayEvents).where(eq(gatewayEvents.id, id));
    if (!event || event.processedAt) return;
    const objectId = String(event.payload.objectId ?? '');
    try {
      let found = true;
      switch (event.type) {
        case 'charge.updated':
          found =
            (await this.charges.syncByProviderId(event.provider, objectId)) ||
            (await this.charges.adoptByProviderId(event.provider, objectId));
          break;
        case 'account.updated':
          found = await this.merchants.sync(objectId);
          break;
        case 'payout.updated':
          found = await this.wallet.syncPayout(objectId);
          break;
        default:
          this.logger.warn({ type: event.type }, 'Evento de gateway ignorado');
      }
      // Objeto ainda sem registro aqui (a criação não terminou): tenta de novo mais tarde.
      if (!found) throw new Error(`Objeto ${objectId} do evento ${event.eventId} não encontrado.`);
      await this.db
        .update(gatewayEvents)
        .set({ processedAt: new Date(), error: null, attempts: sql`${gatewayEvents.attempts} + 1` })
        .where(eq(gatewayEvents.id, id));
    } catch (err) {
      await this.db
        .update(gatewayEvents)
        .set({
          attempts: sql`${gatewayEvents.attempts} + 1`,
          error: err instanceof Error ? err.message.slice(0, 500) : 'Erro desconhecido',
        })
        .where(eq(gatewayEvents.id, id));
      throw err;
    }
  }

  /** Reconciliação: eventos que ficaram para trás voltam para a fila. */
  async retryStale(now: Date = new Date()): Promise<number> {
    const stale = await this.db
      .select({ id: gatewayEvents.id })
      .from(gatewayEvents)
      .where(
        and(
          isNull(gatewayEvents.processedAt),
          lt(gatewayEvents.receivedAt, new Date(now.getTime() - STALE_MS)),
          lt(gatewayEvents.attempts, MAX_ATTEMPTS),
        ),
      )
      .limit(200);
    for (const { id } of stale) {
      await this.queue.enqueue({ name: PAYMENT_JOBS.processEvent, data: { id } });
    }
    return stale.length;
  }
}

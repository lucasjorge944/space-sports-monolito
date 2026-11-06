import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.js';
import { BullPaymentsQueue, type PaymentSchedule } from './bull-payments-queue.js';
import { PAYMENT_GATEWAY } from './gateway/gateway.registry.js';
import type { PaymentGateway, WebhookDelivery } from './gateway/payment-gateway.js';
import { MerchantAccountsService } from './merchant-accounts.service.js';
import { OnlineChargesService } from './online-charges.service.js';
import { PAYMENT_JOBS } from './payment-jobs.names.js';
import { type PaymentJob, PaymentsQueue } from './payments-queue.js';
import { WebhooksService } from './webhooks.service.js';

type Handler = (data: Record<string, unknown>) => Promise<unknown>;

const SCHEDULES: PaymentSchedule[] = [
  { id: 'payments-expire', name: PAYMENT_JOBS.expire, everyMs: 60_000 },
  { id: 'payments-reconcile', name: PAYMENT_JOBS.reconcile, everyMs: 10 * 60_000 },
];

/**
 * Executor da fila de pagamentos (RN-ONPAY-02, RN-ONPAY-07): processa webhooks, vence holds e Pix,
 * reconcilia e roda os jobs do adaptador (no fake: entrega de webhooks, aprovação automática,
 * chargeback do cartão de teste e repasse diário). Também cancela as cobranças abertas do espaço
 * suspenso (RN-ONPAY-09).
 */
@Injectable()
export class PaymentJobs implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentJobs.name);
  private handlers: Record<string, Handler> = {};
  private schedules: PaymentSchedule[] = [];

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly queue: PaymentsQueue,
    private readonly charges: OnlineChargesService,
    private readonly webhooks: WebhooksService,
    private readonly merchants: MerchantAccountsService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    const gatewayJobs = this.gateway?.jobs?.((delivery) => this.deliver(delivery));
    this.handlers = {
      [PAYMENT_JOBS.processEvent]: (data) => this.webhooks.process(String(data.id)),
      [PAYMENT_JOBS.expire]: () => this.expire(),
      [PAYMENT_JOBS.reconcile]: () => this.reconcile(),
      ...gatewayJobs?.handlers,
    };
    this.schedules = this.gateway
      ? [...SCHEDULES, ...(gatewayJobs?.schedules ?? []).map((s) => ({ ...s, pattern: s.pattern }))]
      : [];
    this.queue.setHandler((job) => this.run(job));
    this.events.subscribe('space.deactivated', async (event) => {
      await this.charges.cancelOpenChargesOfSpace(event.spaceId);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.queue instanceof BullPaymentsQueue) {
      await this.queue.start(this.schedules);
      this.logger.log('Fila de pagamentos ligada');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.queue instanceof BullPaymentsQueue) await this.queue.close();
  }

  async run(job: PaymentJob): Promise<unknown> {
    const handler = this.handlers[job.name];
    if (!handler) throw new Error(`Job de pagamentos desconhecido: ${job.name}`);
    return handler(job.data);
  }

  async expire(now: Date = new Date()): Promise<{ holds: number; charges: number }> {
    const holds = await this.charges.expireHolds(now);
    const charges = await this.charges.expireCharges(now);
    return { holds, charges };
  }

  /**
   * RN-ONPAY-07: cobranças e estornos pendentes, eventos parados e os cadastros `PENDING` há mais
   * de `MERCHANT_RESYNC_AFTER_MIN` minutos (decisão 98).
   */
  async reconcile(now: Date = new Date()) {
    const result = await this.charges.reconcile(now);
    const events = await this.webhooks.retryStale(now);
    const accounts = await this.merchants.resyncPending(now);
    return { ...result, events, accounts };
  }

  /**
   * Entrega de webhook do adaptador: com a fila no Redis, por HTTP para a URL configurada (a própria
   * API); com a fila em memória (testes), direto no recebimento, com a mesma assinatura.
   */
  private async deliver(delivery: WebhookDelivery): Promise<void> {
    if (!(this.queue instanceof BullPaymentsQueue)) {
      await this.webhooks.receive(delivery.provider, {
        headers: delivery.headers,
        rawBody: Buffer.from(delivery.body),
      });
      return;
    }
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers: delivery.headers,
      body: delivery.body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Webhook recusado (${response.status}) em ${delivery.url}`);
    }
  }
}

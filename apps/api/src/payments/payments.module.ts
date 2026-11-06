import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/database.module.js';
import { BullPaymentsQueue } from './bull-payments-queue.js';
import { DataCipher, PAYMENTS_DATA_CIPHER } from './data-cipher.js';
import { createPaymentGateway, PAYMENT_GATEWAY } from './gateway/gateway.registry.js';
import { FakeSimulatorController } from './gateways/fake/fake-simulator.controller.js';
import { ItemLocks } from './item-locks.js';
import { ManageOnlinePaymentsController } from './manage-online-payments.controller.js';
import { MerchantAccountsService } from './merchant-accounts.service.js';
import { MyPaymentsService } from './my-payments.service.js';
import { OnlineChargesService } from './online-charges.service.js';
import { PaymentJobs } from './payment-jobs.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { MemoryPaymentsQueue, PaymentsQueue } from './payments-queue.js';
import { PlayerPaymentsController } from './player-payments.controller.js';
import { SuperOnlinePaymentsController } from './super-online-payments.controller.js';
import { SuperPaymentsService } from './super-payments.service.js';
import { WalletService } from './wallet.service.js';
import { PaymentWebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

const providers: Provider[] = [
  {
    provide: PaymentsQueue,
    inject: [ENV],
    useFactory: (env: Env) =>
      env.JOBS_ENABLED ? new BullPaymentsQueue(env) : new MemoryPaymentsQueue(),
  },
  {
    provide: PAYMENT_GATEWAY,
    inject: [ENV, DB, PaymentsQueue],
    useFactory: (env: Env, db: Database, queue: PaymentsQueue) =>
      createPaymentGateway(env, db, queue),
  },
  {
    provide: PAYMENTS_DATA_CIPHER,
    inject: [ENV],
    useFactory: (env: Env) => new DataCipher(env.PAYMENTS_DATA_KEY),
  },
  PaymentSettingsService,
  ItemLocks,
  OnlineChargesService,
  MerchantAccountsService,
  WalletService,
  WebhooksService,
  MyPaymentsService,
  SuperPaymentsService,
  PaymentJobs,
];

/**
 * Pagamento online (decisões 80 a 96; RF-ONPAY, RN-ONPAY; docs/13-pagamentos-online.md): gateway
 * desacoplado (`PAYMENTS_PROVIDER`), cobranças, webhooks, carteira, Super e, só com o gateway fake,
 * o simulador. Os módulos de reserva, aulas e espaços usam os serviços exportados.
 */
@Module({})
export class PaymentsModule {
  static register(env: Env): DynamicModule {
    return {
      module: PaymentsModule,
      global: true,
      controllers: [
        ManageOnlinePaymentsController,
        PlayerPaymentsController,
        PaymentWebhooksController,
        SuperOnlinePaymentsController,
        // RF-ONPAY-12: sem o fake, as rotas do simulador não existem (404).
        ...(env.PAYMENTS_PROVIDER === 'fake' ? [FakeSimulatorController] : []),
      ],
      providers,
      exports: [
        PAYMENT_GATEWAY,
        PaymentsQueue,
        PaymentSettingsService,
        OnlineChargesService,
        PaymentJobs,
      ],
    };
  }
}
